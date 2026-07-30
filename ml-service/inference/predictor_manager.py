"""
Runtime predictor manager (Phase E).

Owns exactly one thing: the currently-live inference snapshot (model +
vectorizer + label encoder + their version identity), as a single immutable
object, and the machinery to safely replace that object -- whether because
this process just published a brand-new candidate itself, or because it
noticed (via the shared active-model manifest) that ANOTHER process
already published one.

Lifecycle terminology used throughout this module and Phase E's final
report (do not blur these):

  Candidate  -- a versioned bundle exists on disk (training/models/model-<runId>/).
  Validated  -- the candidate passed Phase D's 9 gates.
  Published  -- training/models/active.json atomically points at the candidate.
  Activated  -- THIS process successfully loaded and accepted the candidate
                as its RuntimeSnapshot.
  Live       -- predictions in THIS process are now using that snapshot.

A model can be Published without being Activated in every process yet --
that is exactly what the lazy manifest-generation check below exists to
close, on a best-effort, eventually-consistent basis, across every FastAPI
worker/replica that shares the same artifact filesystem.

Concurrency model
------------------
`RuntimeSnapshot` is a plain, immutable (by convention -- nothing in this
module ever mutates a field after construction) container. Swapping models
is "replace the one attribute pointing at the current snapshot with a
different, fully-formed snapshot" -- in CPython, a single attribute
assignment of an object reference is atomic with respect to the GIL, so a
concurrent reader can only ever observe either the complete old snapshot or
the complete new one, never a half-built mix of e.g. a new vectorizer with
an old model. `self._write_lock` is still used around the swap anyway --
not because the assignment itself needs it, but to (a) make the
read-manifest-decide-reload-swap sequence a single logical unit against
OTHER concurrent callers attempting the same reload, and (b) keep the
intent explicit for anyone reading this code later, per the task's own
guidance to prefer clarity here even where the language technically
already guarantees safety.

Expensive work (reading a bundle off disk, deserializing three joblib
artifacts, running the runtime validation checks) is always done OUTSIDE
any lock, against a local variable, before the lock is ever acquired. The
lock's critical section is just "point self._snapshot at the new object
and update local bookkeeping" -- a handful of attribute assignments.

Throttled multi-worker detection
---------------------------------
Every FastAPI worker process in this deployment has its OWN
PredictorManager instance and its OWN in-memory RuntimeSnapshot -- there is
no shared memory between separate OS processes. Publishing active.json
only updates the ONE process that performed the publish; every other
worker/replica is still serving predictions from whatever snapshot it
loaded at its own startup (or its own last reload) until it notices the
manifest has moved on.

`get_snapshot()` is the read path every prediction goes through. On each
call it cheaply checks whether ML_MANIFEST_CHECK_INTERVAL_SECONDS have
elapsed since the last manifest check for THIS process; if not, it returns
the current snapshot immediately with no disk I/O at all. If the interval
has elapsed, it does one cheap read of active.json's `generation` field; if
that generation matches what this process already has loaded, nothing
further happens. Only when the generation differs does this process
attempt a full reload -- OUTSIDE the prediction path's own timing, using
the same load-validate-then-swap sequence activation itself uses.

This requires every worker/replica to share the SAME artifact filesystem
(training/models/) -- there is no network coordination of any kind (no
Redis pub/sub, no message queue). If replicas do NOT share a filesystem,
this mechanism cannot make them consistent, and that must be treated as an
explicit deployment requirement, not something this module can paper over.

A `threading.Lock.acquire(blocking=False)` guards the reload attempt itself
so that if many prediction requests arrive in the same process at the
moment a reload becomes due, only one of them actually performs the reload
(loads from disk, validates, swaps); the rest simply see the lock is busy
and fall through to using the (still valid) current snapshot for that one
prediction, picking up the new snapshot on their next call once the reload
has finished.

A reload failure (bad manifest, incomplete bundle, failed gate) NEVER
touches `self._snapshot` -- the old snapshot remains live, predictions
continue succeeding against it, and the failure is logged (model version +
sanitized reason only -- never a raw stack trace to a prediction caller).
"""

import os
import sys
import time
import datetime
import threading

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(CURRENT_DIR)
TRAINING_DIR = os.path.join(BASE_DIR, "training")

# model_validation.py's bare sibling imports only auto-resolve as a subprocess; add training/ explicitly.
if TRAINING_DIR not in sys.path:
    sys.path.insert(0, TRAINING_DIR)

from training import model_bundle
from training.model_validation import (
    gate_feature_compatibility,
    gate_encoder_model_compatibility,
    gate_smoke_predictions,
)

# observability.py is reachable via the ml-service root, already on sys.path from app.py's own process.
from observability import log_event, sanitize_reason

LEGACY_MODEL_PATH = os.path.join(BASE_DIR, "training", "model.pkl")
LEGACY_VECTORIZER_PATH = os.path.join(BASE_DIR, "training", "vectorizer.pkl")
LEGACY_ENCODER_PATH = os.path.join(BASE_DIR, "training", "labelEncoder.pkl")

DEFAULT_MANIFEST_CHECK_INTERVAL_SECONDS = 5.0


def _isonow():
    return datetime.datetime.utcnow().isoformat() + "Z"


def _manifest_check_interval():
    """
    Read fresh from the environment on every call (not cached at import
    time) so tests and operators can change it without reimporting this
    module. Never hardcoded -- always configurable via
    ML_MANIFEST_CHECK_INTERVAL_SECONDS, with a documented default.
    """
    try:
        return float(os.getenv(
            "ML_MANIFEST_CHECK_INTERVAL_SECONDS",
            str(DEFAULT_MANIFEST_CHECK_INTERVAL_SECONDS),
        ))
    except (TypeError, ValueError):
        return DEFAULT_MANIFEST_CHECK_INTERVAL_SECONDS


class RuntimeSnapshot:
    """
    One complete, immutable-by-convention set of everything a prediction
    needs, plus the identity metadata needed to know exactly which
    candidate this is. Never mutate a snapshot's attributes after
    construction -- build a brand-new RuntimeSnapshot and swap it in
    instead, so a reader can never observe a half-updated object.
    """

    __slots__ = (
        "model", "vectorizer", "labelEncoder",
        "modelVersion", "runId", "datasetHash",
        "manifestGeneration", "loadedAt",
    )

    def __init__(self, model, vectorizer, labelEncoder, modelVersion,
                 runId, datasetHash, manifestGeneration, loadedAt=None):
        self.model = model
        self.vectorizer = vectorizer
        self.labelEncoder = labelEncoder
        self.modelVersion = modelVersion
        self.runId = runId
        self.datasetHash = datasetHash
        self.manifestGeneration = manifestGeneration
        self.loadedAt = loadedAt or (datetime.datetime.utcnow().isoformat() + "Z")


class ActivationError(Exception):
    """
    Raised by any of this module's load/validate helpers when a candidate
    (versioned or legacy) cannot be safely activated. Always carries a
    human-readable, sanitized reason (no raw file-system paths or stack
    traces beyond what is useful for an operator log line) -- callers
    (app.py's activation workflow, this module's own reload path) catch
    this specifically rather than a bare Exception, so an unrelated bug
    elsewhere is never silently reinterpreted as "the candidate was bad".
    """
    pass


class PredictorManager:
    """
    Process-local singleton (see the module-level `predictor_manager`
    instance below) owning the one live RuntimeSnapshot for this process.
    """

    def __init__(self):
        self._snapshot = None
        self._write_lock = threading.Lock()
        self._reload_attempt_lock = threading.Lock()
        self._last_manifest_check_at = 0.0

        # Bounded reload diagnostics, guarded separately so a reader is never blocked behind a bundle load.
        self._diagnostics_lock = threading.Lock()
        self._last_manifest_check_wall_at = None
        self._last_reload_attempt_at = None
        self._last_reload_success_at = None
        self._last_reload_error = None
        self._last_reload_error_at = None
        self._reload_failure_count = 0

    def _touch_manifest_check(self):
        """
        Updates both the monotonic clock value used for throttling
        (_last_manifest_check_at) and its human-readable wall-clock
        counterpart used only for diagnostics reporting
        (_last_manifest_check_wall_at). Kept as one helper so the two can
        never drift out of sync with each other.
        """
        self._last_manifest_check_at = time.monotonic()
        with self._diagnostics_lock:
            self._last_manifest_check_wall_at = _isonow()

    def _record_reload_attempt(self):
        with self._diagnostics_lock:
            self._last_reload_attempt_at = _isonow()

    def _record_reload_success(self, model_version):
        """
        A successful reload clears the CURRENT error field (there is no
        active problem anymore) but deliberately does NOT reset
        reload_failure_count -- that counter is a cumulative, ever-
        increasing measure of "how many reload attempts have failed over
        this process's lifetime", useful for spotting a flapping bundle
        even after it eventually recovers.
        """
        with self._diagnostics_lock:
            self._last_reload_success_at = _isonow()
            self._last_reload_error = None
            self._last_reload_error_at = None
        log_event("runtime_reload_succeeded", modelVersion=model_version)

    def _record_reload_failure(self, reason):
        sanitized = sanitize_reason(reason, max_length=300)
        with self._diagnostics_lock:
            self._last_reload_error = sanitized
            self._last_reload_error_at = _isonow()
            self._reload_failure_count += 1
        log_event("runtime_reload_failed", level=40, failureType=sanitized)

    def diagnostics(self):
        """
        Thread-safe snapshot of the bounded reload diagnostics, suitable
        for direct inclusion in /ml-status. Never includes filesystem
        paths or raw exception objects -- `_last_reload_error` is already
        sanitized at write time (see _record_reload_failure).
        """
        with self._diagnostics_lock:
            return {
                "lastManifestCheckAt": self._last_manifest_check_wall_at,
                "lastReloadAttemptAt": self._last_reload_attempt_at,
                "lastReloadSuccessAt": self._last_reload_success_at,
                "lastReloadError": self._last_reload_error,
                "lastReloadErrorAt": self._last_reload_error_at,
                "reloadFailureCount": self._reload_failure_count,
            }

    # -- construction helpers (no locking; pure loading/validation) --------

    def _validate_pipeline(self, model, vectorizer, encoder, context):
        """
        Runs the subset of Phase D's gates that make sense to re-check at
        RUNTIME load time (feature/encoder compatibility, end-to-end smoke
        predictions) -- deliberately reusing training.model_validation's
        own gate functions rather than re-implementing an entire second
        copy of the same checks inside this module. Completeness and
        loadability are implicitly covered by the fact that
        model_bundle.load_bundle already succeeded (or the legacy loader
        already succeeded) before this is even called. Dataset/metric/
        regression/category-set gates are training-time-only concerns and
        are NOT re-run here -- they already happened once, in Phase D, and
        re-litigating them at load time would require a training-run
        baseline this module has no business fetching (that stays app.py's
        job, via db access it alone has).

        Raises ActivationError with a specific, named gate on the first
        failure. Never raises a raw exception from the underlying gate
        helpers -- those already return a structured pass/fail result
        rather than raising, so this just translates a "failed" result
        into ActivationError.
        """
        feature_gate = gate_feature_compatibility(vectorizer, model)
        if not feature_gate["passed"]:
            raise ActivationError(
                f"{context}: feature_compatibility failed: {feature_gate['reason']}"
            )

        encoder_gate = gate_encoder_model_compatibility(encoder, model)
        if not encoder_gate["passed"]:
            raise ActivationError(
                f"{context}: encoder_model_compatibility failed: {encoder_gate['reason']}"
            )

        smoke_gate = gate_smoke_predictions(model, vectorizer, encoder)
        if not smoke_gate["passed"]:
            raise ActivationError(
                f"{context}: smoke_predictions failed: {smoke_gate['reason']}"
            )

    def _load_legacy(self, manifest_generation=0):
        """
        Loads the pre-Phase-E fixed artifacts (training/model.pkl etc.) as
        an emergency/bootstrap RuntimeSnapshot, versioned as
        model_bundle.LEGACY_VERSION ("legacy-fixed") rather than any real
        model_version string, so it can never be confused with, or
        accidentally treated as, an activated versioned candidate.
        Deliberately does NOT read or write any manifest, and does NOT
        touch the fixed files in any way -- purely a read-only bootstrap
        loader for files Phase D and earlier already guaranteed are never
        modified by anything in this codebase.
        """
        for path in (LEGACY_MODEL_PATH, LEGACY_VECTORIZER_PATH, LEGACY_ENCODER_PATH):
            if not os.path.isfile(path):
                raise ActivationError(f"legacy artifact missing: {path}")

        try:
            model = model_bundle.joblib.load(LEGACY_MODEL_PATH)
            vectorizer = model_bundle.joblib.load(LEGACY_VECTORIZER_PATH)
            encoder = model_bundle.joblib.load(LEGACY_ENCODER_PATH)
        except Exception as exc:
            raise ActivationError(f"legacy artifacts failed to load: {exc}") from exc

        self._validate_pipeline(model, vectorizer, encoder, context="legacy bootstrap")

        return RuntimeSnapshot(
            model=model, vectorizer=vectorizer, labelEncoder=encoder,
            modelVersion=model_bundle.LEGACY_VERSION, runId=None,
            datasetHash=None, manifestGeneration=manifest_generation,
        )

    def _load_candidate(self, model_version, expected_run_id=None, manifest_generation=0):
        """
        Loads a versioned candidate bundle via model_bundle.load_bundle and
        runs the runtime validation checks against it (see
        _validate_pipeline). If `expected_run_id` is given, also confirms
        the bundle's own metadata.json agrees about which run produced it
        -- catching, e.g., a manifest that was hand-edited or corrupted to
        point at a mismatched runId/modelVersion pair.

        Raises ActivationError on ANY failure (missing bundle, incomplete
        bundle, load failure, gate failure, run-id mismatch) -- never
        raises a raw exception type a caller might mistake for something
        else.
        """
        if not model_bundle.is_bundle_complete(model_version):
            raise ActivationError(
                f"candidate bundle incomplete or missing for {model_version}"
            )

        try:
            metadata = model_bundle.read_metadata(model_version)
        except Exception as exc:
            raise ActivationError(
                f"candidate metadata unreadable for {model_version}: {exc}"
            ) from exc

        if expected_run_id is not None and str(metadata.get("runId")) != str(expected_run_id):
            raise ActivationError(
                f"candidate metadata runId {metadata.get('runId')!r} does not match "
                f"expected {expected_run_id!r} for {model_version}"
            )

        try:
            model, vectorizer, encoder = model_bundle.load_bundle(model_version)
        except Exception as exc:
            raise ActivationError(
                f"candidate bundle failed to load for {model_version}: {exc}"
            ) from exc

        self._validate_pipeline(model, vectorizer, encoder, context=f"candidate {model_version}")

        return RuntimeSnapshot(
            model=model, vectorizer=vectorizer, labelEncoder=encoder,
            modelVersion=model_version, runId=metadata.get("runId"),
            datasetHash=metadata.get("datasetHash"), manifestGeneration=manifest_generation,
        )

    # -- public: startup ----------------------------------------------------

    def initialize(self):
        """
        Startup entry point (called once, from app.py's FastAPI startup
        handler). Determines the very first snapshot for this process:

          1. If training/models/active.json exists and is valid, and its
             referenced bundle loads and passes runtime validation ->
             activate it.
          2. Otherwise (no manifest at all -- the normal pre-Phase-E
             state) -> load the legacy fixed artifacts.
          3. If the manifest exists but is corrupt/invalid, or its bundle
             fails to load/validate -> log a clear, controlled error and
             fall back to the legacy artifacts as an emergency measure
             (this policy choice, and why it is safe, is documented in the
             Phase E final report: the legacy files are never modified by
             anything in this codebase, so falling back to them can never
             make things worse than they already were before Phase E
             existed). The manifest itself is NEVER auto-overwritten or
             "repaired" here -- a human should look at why it was
             corrupted; a fresh, correctly-published manifest will
             naturally replace it the next time a run successfully
             activates.

        Raises ActivationError ONLY if NEITHER a manifest-based model NOR
        the legacy artifacts can be loaded -- i.e. the service genuinely
        has nothing to serve predictions with. app.py's startup handler is
        expected to let this propagate and fail startup in that case (this
        is the one situation where failing loudly is strictly better than
        starting with no usable model at all). This function itself never
        calls sys.exit() -- module import and initialization must remain a
        normal, catchable Python control flow.
        """
        try:
            manifest = model_bundle.read_manifest()
        except model_bundle.ManifestError as exc:
            print(f"[predictor_manager] warning: active.json is invalid, ignoring it: {exc}")
            manifest = "invalid"

        if manifest and manifest != "invalid":
            try:
                snapshot = self._load_candidate(
                    manifest["modelVersion"],
                    expected_run_id=manifest.get("runId"),
                    manifest_generation=manifest.get("generation", 0),
                )
                with self._write_lock:
                    self._snapshot = snapshot
                self._touch_manifest_check()
                self._record_reload_success(snapshot.modelVersion)
                print(
                    f"[predictor_manager] startup: activated manifest model "
                    f"{snapshot.modelVersion} (generation {snapshot.manifestGeneration})"
                )
                return
            except ActivationError as exc:
                self._record_reload_failure(str(exc))
                print(
                    f"[predictor_manager] warning: manifest-referenced candidate "
                    f"{manifest.get('modelVersion')} failed to activate at startup "
                    f"({exc}); falling back to legacy artifacts"
                )

        # No manifest, or manifest present but unusable -- legacy bootstrap.
        snapshot = self._load_legacy(manifest_generation=(manifest or {}).get("generation", 0)
                                      if isinstance(manifest, dict) else 0)
        with self._write_lock:
            self._snapshot = snapshot
        self._touch_manifest_check()
        self._record_reload_success(snapshot.modelVersion)
        print(f"[predictor_manager] startup: activated legacy bootstrap model "
              f"({model_bundle.LEGACY_VERSION})")

    # -- public: activation workflow (called by app.py's background_retrain) -

    def preload_candidate(self, model_version, run_id, manifest_generation):
        """
        Loads and validates a candidate WITHOUT touching self._snapshot --
        the "load and validate candidate outside lock" step of the
        recommended activation ordering. Callers (app.py) are expected to
        publish the manifest FIRST using the snapshot this returns
        (specifically, using its own already-verified identity), and only
        then call `swap_in(...)` with the same snapshot to make it live in
        this process. Splitting these two steps out (rather than one
        combined "preload and swap" call) is what lets app.py enforce the
        Phase E safety property that the manifest must never be published
        pointing at something this process could not itself load -- the
        load/validate happens, and only on ITS success does app.py move on
        to publishing.

        Raises ActivationError on any failure; self._snapshot is
        completely untouched either way.
        """
        return self._load_candidate(
            model_version, expected_run_id=run_id, manifest_generation=manifest_generation
        )

    def current_snapshot(self):
        """
        Returns the raw, currently-live RuntimeSnapshot object (or None
        before initialize() has ever run). Used by app.py's activation
        workflow specifically to capture "the exact previous snapshot"
        BEFORE calling swap_in with a new candidate, so that if activation
        fails after the swap (e.g. the post-swap smoke test), the exact
        same previous snapshot object can be restored via another swap_in
        call -- no need to re-load anything from disk to roll back the
        in-memory state.
        """
        return self._snapshot

    def swap_in(self, snapshot):
        """
        Atomically replaces the live snapshot with an already-loaded-and-
        validated one (normally the return value of preload_candidate).
        This is the ONLY place self._snapshot is ever written for a
        deliberate activation (as opposed to the lazy multi-worker reload
        path, which also calls this after its own preload+validate).

        Held only for the duration of the attribute assignments -- never
        during any disk I/O.
        """
        with self._write_lock:
            self._snapshot = snapshot
        self._touch_manifest_check()

    def smoke_test(self):
        """
        Runs one end-to-end smoke prediction against whatever snapshot is
        CURRENTLY live (i.e. called AFTER swap_in, as the activation
        workflow's post-swap confirmation step). Returns (True, None) on
        success or (False, reason) on failure -- never raises, since the
        caller needs to distinguish "smoke failed, now roll back" from an
        unrelated crash.
        """
        snapshot = self._snapshot
        if snapshot is None:
            return False, "no snapshot loaded"
        try:
            result = gate_smoke_predictions(snapshot.model, snapshot.vectorizer, snapshot.labelEncoder)
            if not result["passed"]:
                return False, result["reason"]
            return True, None
        except Exception as exc:
            return False, f"smoke test raised: {exc}"

    # -- public: prediction read path (multi-worker lazy reload) ------------

    def get_snapshot(self):
        """
        The read path every prediction goes through. Cheap in the common
        case (interval not yet elapsed, or elapsed but generation
        unchanged): no disk I/O, just a monotonic-clock comparison and an
        attribute read.

        Only when the manifest's generation has genuinely moved past what
        this process has loaded does a reload attempt happen -- and even
        then, `self._reload_attempt_lock.acquire(blocking=False)` ensures
        at most one thread in this process performs it; every other
        concurrent caller in the same moment just falls through to
        returning the current (still valid) snapshot for its own
        prediction, and will pick up the new one on a later call.

        A reload failure is caught, logged (model version + sanitized
        reason, never a raw traceback), and never touches self._snapshot
        -- the old snapshot keeps serving predictions.
        """
        current = self._snapshot
        if current is None:
            return None

        now = time.monotonic()
        if (now - self._last_manifest_check_at) < _manifest_check_interval():
            return current

        acquired = self._reload_attempt_lock.acquire(blocking=False)
        if not acquired:
            # Someone else in this process is already checking/reloading -- don't duplicate the work.
            return current

        try:
            # Re-read now that we hold the reload lock, in case another thread already refreshed both.
            current = self._snapshot
            now = time.monotonic()
            if (now - self._last_manifest_check_at) < _manifest_check_interval():
                return current

            self._last_manifest_check_at = now
            with self._diagnostics_lock:
                self._last_manifest_check_wall_at = _isonow()

            try:
                manifest = model_bundle.read_manifest()
            except model_bundle.ManifestError as exc:
                print(f"[predictor_manager] warning: active.json invalid during reload check: {exc}")
                return current

            if manifest is None:
                # No manifest published yet -- nothing to reload toward.
                return current

            if manifest.get("generation") == current.manifestGeneration:
                return current  # already up to date

            self._record_reload_attempt()

            try:
                new_snapshot = self._load_candidate(
                    manifest["modelVersion"],
                    expected_run_id=manifest.get("runId"),
                    manifest_generation=manifest.get("generation"),
                )
            except ActivationError as exc:
                self._record_reload_failure(str(exc))
                print(
                    f"[predictor_manager] warning: reload of manifest generation "
                    f"{manifest.get('generation')} ({manifest.get('modelVersion')}) "
                    f"failed, keeping current model {current.modelVersion} live: {exc}"
                )
                return current

            with self._write_lock:
                self._snapshot = new_snapshot
            self._record_reload_success(new_snapshot.modelVersion)
            print(
                f"[predictor_manager] reloaded to {new_snapshot.modelVersion} "
                f"(generation {new_snapshot.manifestGeneration})"
            )
            return new_snapshot
        finally:
            self._reload_attempt_lock.release()

    def current_snapshot_metadata(self):
        """
        Non-breaking metadata for internal use (e.g. a future status
        endpoint, or optional non-sensitive prediction response fields).
        Deliberately excludes anything filesystem-path- or dataset-hash-
        shaped from what would ever be handed to an ordinary prediction
        client -- callers deciding what to expose to /predict-category must
        pick fields explicitly rather than dumping this whole dict.
        """
        snapshot = self._snapshot
        if snapshot is None:
            return None
        return {
            "modelVersion": snapshot.modelVersion,
            "runId": snapshot.runId,
            "datasetHash": snapshot.datasetHash,
            "manifestGeneration": snapshot.manifestGeneration,
            "loadedAt": snapshot.loadedAt,
        }


# Process-local singleton; each worker process gets its own, sharing only the on-disk manifest/bundle.
predictor_manager = PredictorManager()
