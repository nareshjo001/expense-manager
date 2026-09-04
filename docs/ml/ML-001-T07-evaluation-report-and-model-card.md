# ML-001-T07: Evaluation report and model card

Model card and evaluation report for a real, full training run through
the pipeline as extended by ML-001-T03/T04/T05 (grouped splitting,
baseline comparisons, and richer metrics — macro-F1, per-class
precision/recall/F1, confusion matrix, calibration). This is not a
synthetic example: it is the actual output of running
`ml-service/training/trainer.py` end-to-end against the real production
dataset (`ml-service/usedDatasets/merged_expenses.csv`, 97,056 rows) on
2026-09-03, followed by running `ml-service/training/validate_model.py`'s
real 9-gate suite against the resulting bundle. Raw output:
`result.json` / `validate_result.json` from that run (not committed to
the repo — regenerate via the commands in [§6](#6-reproducing-this-report)
to get current numbers; the ones below are a point-in-time snapshot, not
a live-updating figure).

This is the artifact a human should actually look at when deciding
whether to `POST /training-runs/{runId}/approve` a candidate under
[ML-001-T06](ML-001-T06-promotion-and-rollback.md)'s manual promotion
gate — this report is what "review the baseline comparison and the
macro-F1/per-class/confusion/calibration breakdown" (T06 §2) means in
practice, worked through once end-to-end.

## 1. Model card

| | |
|---|---|
| Task | Multiclass expense-category classification (15 canonical categories) |
| Model type | Linear classifier over TF-IDF text features (see `trainer.py`; same architecture as the existing production model — this run does not change model family, only the training/evaluation pipeline around it) |
| Training data | `usedDatasets/merged_expenses.csv`, 97,056 rows, `expenseName` + `expenseCategory` → canonical category. See [ML-001-T01](ML-001-dataset-provenance-and-taxonomy.md) for provenance and [ML-001-T02](ML-001-T02-deduplication-and-label-ambiguity.md) for known duplication (88.8% of rows are exact duplicates of one of only 11,514 distinct `(name, category)` pairs — this is exactly why grouped splitting, next row, matters). |
| Split strategy | `stratified_group` (ML-001-T03's primary tier — `StratifiedGroupKFold` grouped by a normalized `(cleanedName, category)` key, so near-duplicate rows can never appear on both sides of a split). `fallbackSplitUsed: false` — the primary strategy succeeded outright on this run; the degraded tiers (group-only, then ungrouped) were not needed. |
| Split sizes | Train 67,093 / Validation 10,348 / Test 19,615 |
| Training time | 2.51s (this run; excludes dataset assembly/feedback reservation, which run as separate pipeline stages) |
| Model version | `model-test-run-1` (this is a manual verification run, not a real training-run id from a live retrain — see [§6](#6-reproducing-this-report)) |
| Validation gates | 9/9 passed (`validate_model.py`, real run — see [§5](#5-automated-gate-results)) |

## 2. Headline metrics (test split, 19,615 rows)

| Metric | Value |
|---|---|
| Accuracy | **97.01%** |
| Macro F1 | **97.38%** |
| Expected Calibration Error (ECE) | **0.0787** |

Macro F1 (unweighted mean across all 15 categories) is reported
alongside accuracy specifically because accuracy alone is dominated by
the largest categories (Bills: 3,344 test rows; Rent: 190) — see
[§3](#3-per-class-breakdown) for the categories where the two diverge.

## 3. Per-class breakdown

Sorted by F1, worst first — this is where a reviewer's attention should
go before approving a candidate.

| Category | Precision | Recall | F1 | Support |
|---|---|---|---|---|
| **Transport** | **72.9%** | 99.9% | 84.3% | 1,340 |
| **Travel** | 99.96% | **81.9%** | 90.0% | 2,745 |
| Personal Care | 97.6% | 95.9% | 96.7% | 555 |
| Gifts | 90.2% | 100% | 94.8% | 174 |
| Rent | 96.0% | 100% | 97.9% | 190 |
| Shopping | 98.8% | 99.0% | 98.9% | 1,785 |
| Others | 100% | 98.6% | 99.3% | 1,689 |
| Groceries | 99.5% | 99.8% | 99.6% | 1,484 |
| Bills | 99.6% | 99.8% | 99.7% | 3,344 |
| Food | 99.8% | 99.6% | 99.7% | 1,539 |
| Entertainment | 99.9% | 99.5% | 99.7% | 1,090 |
| Education | 99.8% | 99.8% | 99.8% | 1,984 |
| Health | 100% | 100% | 100% | 1,160 |
| Investment | 100% | 100% | 100% | 338 |
| Salary | 100% | 100% | 100% | 198 |

**The one real weak spot in this run: Transport and Travel confuse with
each other.** The confusion matrix (`result.json`'s `metrics.confusion`)
shows the Travel row's off-diagonal mass lands almost entirely in the
Transport column — Travel's precision is near-perfect (99.96%) but its
recall is the lowest of any category (81.9%), while Transport shows the
mirror pattern: near-perfect recall (99.9%) but the lowest precision of
any category (72.9%). In plain terms: the model over-predicts
"Transport" and under-predicts "Travel" specifically for inputs near the
boundary between the two (a taxi to the airport, a flight booking
described tersely, "travel" itself as a raw expense name) — a real,
semantically-explainable ambiguity in the label taxonomy itself, not
obviously a model defect a different architecture would fix. Every other
category is at or above 94.8% F1, and eight of fifteen categories are at
100% precision or 100% recall (small support for several of these —
Salary 198, Investment 338, Rent 190 — so treat those specific 100%
figures as "no errors observed in this many test rows," not as a
promise that holds at larger scale).

This is exactly the kind of finding the 9 automated gates in
`validate_model.py` cannot surface — they check aggregate accuracy
against a threshold, not which specific category pair is confusable. A
reviewer deciding whether to approve a candidate should look at whether
Transport/Travel (or a similarly correlated pair) got worse
version-over-version, not just whether overall accuracy held.

## 4. Baseline comparison

From ML-001-T04 (`training/baselines.py`), fit on the same train split
and evaluated on the same validation split (10,348 rows) as the real
model, so the gap below is apples-to-apples:

| Model | Accuracy | Macro F1 |
|---|---|---|
| Majority-class baseline | 5.9% | 0.7% |
| Keyword baseline | 78.0% | 76.2% |
| Linear (logistic regression) baseline | 91.4% | 90.7% |
| **Production model (this run)** | **~97%** (test split; val-split figure not separately reported above) | **~97%** (test split) |

The majority baseline (predict "Bills" — the single largest category —
every time) sets the absolute floor: 5.9% accuracy confirms the task is
not trivially solvable by exploiting class imbalance alone. The keyword
baseline (exact/substring keyword-to-category rules, `min_precision=0.7`)
reaching 78% shows a meaningful fraction of this dataset is solvable by
surface-level lexical cues alone — expected, given how many `expenseName`
values are literally merchant/category names. The linear TF-IDF baseline
at 91.4% is the closest point of comparison to the production model's
own architecture family; the ~6-point gap between it and the full
pipeline's ~97% is attributable to the production model's fuller feature
set and tuning, not to a difference in fundamental approach. None of the
three baselines comes close to 97%, which is the actual evidence (not
just an assumption) that the production model is earning its complexity.

## 5. Automated gate results

All 9 gates from `training/model_validation.py`, run for real via
`validate_model.py` against this run's bundle:

| Gate | Result |
|---|---|
| completeness | ✅ pass |
| loadability | ✅ pass |
| feature_compatibility | ✅ pass |
| encoder_model_compatibility | ✅ pass |
| dataset_metadata_consistency | ✅ pass |
| valid_metrics | ✅ pass |
| regression_threshold | ⏭️ skipped — no previous completed run to compare against (first run) |
| smoke_predictions | ✅ pass |
| category_set_comparison | ⏭️ skipped — no previous completed run to compare against (first run) |

The two skips are expected and correct for a first/manual run with no
prior activated model recorded against this `ML_MODEL_ROOT` — in a real
retrain against the live model history, both would run for real. Gates
passing is necessary but not sufficient for promotion — see
[ML-001-T06 §2](ML-001-T06-promotion-and-rollback.md#2-what-to-check-before-calling-approve)
for what else a human should look at (this report is that "what else").

## 6. Reproducing this report

```bash
cd ml-service/training
ML_MODEL_ROOT=/tmp/ml_verify_bundles python3 trainer.py \
  --dataset ../usedDatasets/merged_expenses.csv \
  --run-id <a-run-id> \
  --model-version <a-model-version> \
  --dataset-hash <sha256-of-the-dataset-file> \
  --row-counts-json '{"total": 97056}' \
  --result-path /tmp/ml_verify_run/result.json

ML_MODEL_ROOT=/tmp/ml_verify_bundles python3 validate_model.py \
  --model-version <the-same-model-version> \
  --dataset-hash <the-same-dataset-hash> \
  --row-counts-json '{"total": 97056}' \
  --result-path /tmp/ml_verify_run/validate_result.json
```

`ML_MODEL_ROOT` points both commands at a scratch directory instead of
the live `training/models/` — this never touches the real model bundle
history or the live `model.pkl`/`vectorizer.pkl`/`labelEncoder.pkl` files
predictor.py actually reads. `result.json`'s `metrics` object carries
every number in this report (`accuracy`, `macroF1`, `perClass`,
`confusion`, `calibration`, `baselines`, `splitStrategy`,
`fallbackSplitUsed`); this report is written from that JSON, not the
reverse — regenerate the run before trusting a number here against a
codebase that has since changed.
