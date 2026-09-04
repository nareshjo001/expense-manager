# ML-001-T06: Manual promotion gates and rollback criteria

Closes a gap in `ml-service`'s retraining lifecycle: today, a validated
candidate activates on this genuinely live production inference service
with **zero human checkpoint** — see `app.py:1002-1006`'s unconditional
call from `background_retrain` into `_attempt_activation` the instant
`run_retraining()` reports `success: true`. This task adds an opt-in
manual promotion gate, two operator-facing endpoints to act on it, and a
standalone rollback tool for a live model that only later turns out to be
regressing in some way the automated gates did not catch. It is entirely
additive and **default-OFF** — see [§4](#4-this-does-not-change-production-by-itself) below.

## 1. What changed and why

**Before:** `queued → running → evaluating → activating → activated` runs
end-to-end in one background thread, with no point at which a human could
look at a candidate before it goes live. The 9 automated gates in
`training/model_validation.py` (completeness, loadability, feature
compatibility, encoder/model compatibility, dataset-metadata consistency,
metric validity, regression threshold, smoke predictions, category-set
comparison) are real and useful, but they are necessarily fixed, narrow
checks — they cannot substitute for a human looking at what actually
changed, especially the first several times a genuinely new failure mode
shows up in production.

**After:** a new config flag, `ML_REQUIRE_MANUAL_APPROVAL` (see
`config.py`), lets an operator require exactly one additional step
between "validated" and "live": a human calls `POST
/training-runs/{runId}/approve` or `/reject`. Everything upstream of that
point — dataset assembly, training, all 9 validation gates — is completely
unchanged; this task only gates what happens *after* they already passed.

```
                                validation succeeds
                                        │
                     ML_REQUIRE_MANUAL_APPROVAL?
                    ┌───────── no (default) ─────────┐
                    │                                  │
                    ▼                                  ▼
        awaiting_approval                    activating → activated
        (human calls /approve                  (today's fully-automatic
         or /reject)                            path, unchanged)
              │
     ┌────────┴────────┐
     ▼                  ▼
 activated           rejected
 (same activation    (terminal; candidate
  workflow as the      bundle left on disk,
  automatic path)       untouched)
```

## 2. What a human should review before calling `/approve`

Approving a candidate means it goes through the exact same activation
workflow (`_attempt_activation` in `app.py`) the automatic path already
uses — preload + validate in-process, publish the manifest, swap the
runtime snapshot, run a post-swap smoke test, with the same automatic
same-request rollback on failure. The gates have already passed by the
time a run reaches `awaiting_approval`; the human review below is about
everything the gates *don't* check — trends, tradeoffs, and context a
fixed pass/fail threshold cannot capture.

Everything needed lives on the run document already (`GET
/training-runs/{runId}`, or the `metrics` field persisted by
`persist_model_candidate` — see `db/training_run_repository.py`). Nothing
new needs to be computed to review a pending approval:

1. **The 9 automated gates already passed — necessary, not sufficient.**
   `GET /training-runs/{runId}` → `validation.gates` lists all 9 by name
   with `passed`/`skipped`/`reason`. A pass here only means "nothing
   structurally broken and no measured accuracy regression beyond
   `ML_MAX_ACCURACY_REGRESSION`" — it says nothing about whether the
   *kind* of change is one you actually want live.

2. **Baseline comparison (ML-001-T04).** `metrics.baselines` holds
   majority/keyword/linear-model baseline `accuracy`/`macroF1` computed
   against the same split (see `training/baselines.py`,
   `training/trainer.py`'s `metrics["baselines"]` assignment). A candidate
   that barely beats the keyword baseline is a materially weaker signal
   than one that clears it by a wide margin, even if it passed gate 7's
   regression check against the *previous model* — the previous model
   could itself have been mediocre.

3. **Macro-F1 / per-class / confusion / calibration breakdown
   (ML-001-T05).** `metrics.macroF1`, `metrics.perClass` (per-category
   precision/recall/F1/support), `metrics.confusion` (the confusion
   matrix), and `metrics.calibration` (`expectedCalibrationError` +
   per-bin reliability, from `training/metrics.py`) are all persisted on
   the run. Overall accuracy can hide a lot: a candidate can raise
   accuracy while quietly collapsing recall on a low-support category, or
   becoming systematically overconfident (poor calibration) even while
   its point predictions look fine. `perClass` and `confusion` are the
   fields that surface exactly that; gate 7 (regression threshold) only
   ever looks at aggregate `accuracy`.

4. **What actually changed.** `run.encoderClasses` vs. the previously
   active run's (see `GET /training-runs?status=activated&limit=1` or
   `/ml-status`) shows whether the category set itself moved — gate 9
   (category-set comparison) flags this too, but reading it directly is
   worth doing before promoting a candidate that adds/removes categories.

There is no scoring formula here by design — this is a judgment call an
automated gate cannot make, which is the entire reason this task exists.

## 3. `training/rollback_model.py`: when the model is already live and something is wrong

The gates above (including this task's own manual review) only ever
check what they check. A model can pass every gate and still regress in
production in a way that only shows up under real traffic — a category
that behaves unexpectedly on inputs the validation split didn't happen to
cover, a calibration issue that only bites at certain confidence
thresholds a downstream consumer relies on, etc. For that case —
**a live model regressing in a way the gates did not catch** —
`training/rollback_model.py` lets an operator explicitly reactivate an
older, still-on-disk bundle:

```bash
cd ml-service/training
python3 rollback_model.py --list
python3 rollback_model.py --model-version model-<runId> --reason "..."
```

- `--list` — every complete, on-disk bundle, newest first, as JSON.
  Read-only.
- `--model-version <v> [--reason "..."]` — publishes a new manifest
  generation pointing at `<v>`, after confirming it (a) is not already
  active, (b) is a complete bundle, and (c) actually loads (the same
  Gate-2 loadability check the forward activation path already relies
  on). Every live worker converges on the change independently within
  `ML_MANIFEST_CHECK_INTERVAL_SECONDS` (default 5s), via the exact same
  polling mechanism (`inference/predictor_manager.py`'s `get_snapshot()`)
  every worker already uses to notice a normal forward activation it did
  not itself perform — no new notification mechanism was introduced.

It is deliberately a script, not an HTTP endpoint — see the module's own
docstring, and `RUNBOOK.md` §5.1, for why: reverting a live production
model is a rare, high-stakes action, and gating it behind "whoever has
shell/deploy access to this host" is a meaningfully higher bar than
gating it behind one shared HTTP header value that already unlocks
several other mutating endpoints.

Retention note: `training/model_cleanup.py` only ever protects the
*immediately-previous* bundle from deletion (`ROLLBACK_PROTECTED`, keyed
off the active manifest's own `previousModelVersion`). Older bundles may
already have been deleted under `ML_MODEL_RETENTION_COUNT` (default 5) —
`--list` is the way to check what is actually still available before
deciding a rollback target.

## 4. This does not change production by itself

`ML_REQUIRE_MANUAL_APPROVAL` defaults to unset, which `config.py` parses
as `False` — off. With it unset (or explicitly `false`), `app.py`'s
`background_retrain` takes the exact same code path it takes today: a
validated candidate activates automatically, with no behavior difference
whatsoever from before this task. This was verified directly: the
existing `tests/unit/test_lifecycle_mocked.py` suite (which asserts a
single `background_retrain()` call leaves a run `"activated"` and
`model_bundle.read_manifest()` pointing at it) passes completely
unmodified against this task's changes.

**Turning `ML_REQUIRE_MANUAL_APPROVAL` on in a real deployed environment
is a deliberate operational decision for whoever owns this service to
make — not something this task decides or does.** This task makes manual
promotion *possible* (the flag, the two endpoints, the rollback tool, the
review guidance above); actually flipping the flag on the live service
changes an operational tradeoff (every retrain now needs a human
`/approve` before it can go live, or it sits at `awaiting_approval`
indefinitely) that is outside what a code change alone can or should
decide, and outside what this session is in a position to verify against
this project's actual on-call/staffing reality. Enable it deliberately,
with whoever is on the hook for reviewing pending approvals aware that
retraining no longer self-activates once it's on.
