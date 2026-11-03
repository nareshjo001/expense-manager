"""Runtime predictor manager (Phase E)."""

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
    """Read fresh from the environment on every call (not cached at import time) so tests and operators can change it without reimporting this module."""
    try:
        return float(os.getenv(
            "ML_MANIFEST_CHECK_INTERVAL_SECONDS",
            str(DEFAULT_MANIFEST_CHECK_INTERVAL_SECONDS),
        ))
    except (TypeError, ValueError):
        return DEFAULT_MANIFEST_CHECK_INTERVAL_SECONDS


class RuntimeSnapshot:
    """One complete, immutable-by-convention set of everything a prediction needs, plus the identity metadata needed to know exactly which candidate this is."""

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
    """Raised by any of this module's load/validate helpers when a candidate (versioned or legacy) cannot be safely activated."""
    pass


class PredictorManager:
    """Process-local singleton (see the module-level `predictor_manager` instance below) owning the one live RuntimeSnapshot for this process."""

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
        """Updates both the monotonic clock value used for throttling (_last_manifest_check_at) and its human-readable wall-clock counterpart used only for diagnostics reporting (_last_manifest_check_wall_at)."""
        self._last_manifest_check_at = time.monotonic()
        with self._diagnostics_lock:
            self._last_manifest_check_wall_at = _isonow()

    def _record_reload_attempt(self):
        with self._diagnostics_lock:
            self._last_reload_attempt_at = _isonow()

    def _record_reload_success(self, model_version):
        """A successful reload clears the CURRENT error field (there is no active problem anymore) but deliberately does NOT reset reload_failure_count -- that counter is a cumulative, ever- increasing measure of "how many reload attempts have failed over this process's lifetime", useful for spotting a flapping bundle even after it eventually recovers."""
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
        """Thread-safe snapshot of the bounded reload diagnostics, suitable for direct inclusion in /ml-status."""
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
        """Model_validation's own gate functions rather than re-implementing an entire second copy of the same checks inside this module."""
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
        """LEGACY_VERSION ("legacy-fixed") rather than any real model_version string, so it can never be confused with, or accidentally treated as, an activated versioned candidate."""
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
        """Load_bundle and runs the runtime validation checks against it (see _validate_pipeline)."""
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
        """Py's FastAPI startup handler). Determines the very first snapshot for this process: 1."""
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
        """_snapshot -- the "load and validate candidate outside lock" step of the recommended activation ordering."""
        return self._load_candidate(
            model_version, expected_run_id=run_id, manifest_generation=manifest_generation
        )

    def current_snapshot(self):
        """Returns the raw, currently-live RuntimeSnapshot object (or None before initialize() has ever run)."""
        return self._snapshot

    def swap_in(self, snapshot):
        """Atomically replaces the live snapshot with an already-loaded-and- validated one (normally the return value of preload_candidate)."""
        with self._write_lock:
            self._snapshot = snapshot
        self._touch_manifest_check()

    def smoke_test(self):
        """E. called AFTER swap_in, as the activation workflow's post-swap confirmation step)."""
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
        """The read path every prediction goes through."""
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
        """G. a future status endpoint, or optional non-sensitive prediction response fields)."""
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
