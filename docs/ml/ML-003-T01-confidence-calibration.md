# ML-003-T01 — Confidence calibration on grouped validation data

**Status: Done, with a load-bearing caveat.** `ml-service/training/calibrate_confidence.py`
loads the currently-served legacy bundle (`model.pkl`/`vectorizer.pkl`/`labelEncoder.pkl` —
the exact files `predictor_manager.py` falls back to at startup) and scores it against a
grouped, leakage-free held-out split of `usedDatasets/merged_expenses.csv`, using the same
`grouped_split.py` methodology ML-001-T03 established for real training runs. Output:
`ml-service/training/calibration_report.json` (full per-class curves) plus this summary.

## What it found

Run 2026-09-17, `--random-state 42`, `stratified_group` split, 97,056 usable rows,
10,348-row validation fold:

| Metric | Value |
|---|---|
| Accuracy | 0.9991 |
| Macro-F1 | 0.9982 |
| Expected Calibration Error | 0.0046 |

Per-class raw precision was ≥0.975 for all 15 categories, and every one hit every
precision target (p80/p90/p95) at the *lowest* threshold on the grid (0.30).

## Why these numbers should not be trusted as production thresholds

10,215 of 10,348 validation rows (98.7%) landed in the [0.9, 1.0] confidence bin, at
99.98% accuracy. That distribution — almost the entire held-out set at near-certain
confidence and near-perfect accuracy — is the signature of a model scored on data it has
effectively already seen, not of genuine generalization to unfamiliar input. Two
compounding reasons, both real:

1. **No recorded training manifest for the legacy bundle.** `model_bundle.py`'s own
   comment states the legacy artifacts predate the versioned-bundle system, so there is
   no `metadata.json` recording what it was actually trained on. This script's grouped
   split guarantees *my* validation fold's groups don't appear in *my* training fold —
   it cannot guarantee those groups were absent from whatever produced `model.pkl`
   originally. If the legacy model trained on all of `merged_expenses.csv` (plausible,
   given the filename), this evaluation is largely measuring memorization.
2. **The dataset itself is templated/synthetic-heavy.** `50k_clean_synthetic.csv` and
   `merchant_dataset_generated.csv` make up roughly 85% of `merged_expenses.csv`'s rows,
   and ML-001-T02 already found 77% exact-duplicate rows dataset-wide. Even a truly
   disjoint split can still look easy when the vocabulary is formulaic (e.g. every
   "Mobile Recharge"-style string reliably maps to one category everywhere in the
   corpus) — that's a property of the data, not a bug in the split.

**Conclusion: this script and its methodology are sound and reusable, but the specific
thresholds in `calibration_report.json` are an optimistic ceiling, not a number to wire
into T02/T03 as-is.** The honest fix is to re-run this exact script against the next
model trained through the versioned pipeline (which now records a real manifest via
`model_bundle.write_bundle`), and — ideally — against real user-correction data from
`db/feedback_repository.py` once there's enough of it, since that's the one dataset this
model has definitely never trained on.

## What ML-003-T02 should actually do with this

Not: adopt threshold 0.30 as the abstain cutoff. Instead: treat this report's *shape*
(bin distribution, per-class curve mechanics) as validated, re-run it against a properly
manifested training run, and only then pick real per-class thresholds from that output.

## Scope note

This is T01 only — a read-only analysis script. It does not touch `predictor.py`,
`backend/Routes/ml.router.js`, or any served behavior. T02 (thresholds), T03 (API
contract), T04–T07 (UI, outcome tracking, merchant-rule shortcut, tests) are unstarted.
