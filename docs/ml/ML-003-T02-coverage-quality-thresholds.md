# ML-003-T02 — Coverage/quality abstention threshold policy

**Status: Done, as a provisional global policy — not final per-class numbers.**
`ml-service/training/threshold_policy.py` reads ML-003-T01's
`calibration_report.json` and writes `ml-service/training/threshold_policy.json`,
the artifact T03 (abstention flag in the API contract) will consume.

## Definitions

For a candidate confidence threshold *t*, a prediction is **committed** if
`confidence >= t` and **abstained** otherwise (T03's job is turning that
boolean into an actual API field — this task only decides *t*).

- **Quality** of a class at *t* = precision among that class's *committed*
  predictions only. Abstained predictions are excluded, not counted as wrong.
- **Coverage** of a class at *t* = committed / total predictions for that
  class — how much traffic still gets a suggestion instead of an abstention.

Both reuse `calibrate_confidence.py`'s own per-class `curve`/`coverage`/
`precision` fields rather than redefining the metric a second time.

## Why this is one global threshold, not 15 per-class ones

T01's own finding was that every one of the 15 canonical categories clears
every precision target (p80/p90/p95) at the *lowest* threshold tested (0.30),
because the validation fold is drawn from a ~85% templated/synthetic,
77%-exact-duplicate dataset — the model is largely being re-asked questions
it has already memorized. Under that condition, differences between
categories in the calibration curve more likely reflect which synthetic
generator produced more or fewer near-duplicate templates for a category
than genuine differences in how hard that category is to classify. Setting
15 distinct numbers from this curve today would encode dataset contamination
as product policy — the exact outcome T01 flagged for T02 to avoid.

What the report *does* support even under that caveat is a coarser,
distribution-level signal: 98.7% of the validation fold lands in the
[0.9, 1.0] confidence bin. That isn't a trustworthy fine-grained precision
number, but it is where this model's own output happens to cluster — a
prediction scoring below that cluster is already an outlier for this model
regardless of whether the cluster's own accuracy can be trusted. That
qualitative cliff is the one part of the curve that survives the
contamination problem, so the policy is built on it: a single, conservative
`GLOBAL_DEFAULT_THRESHOLD = 0.90` at the edge of that cluster, applied
identically to every category.

## What the numbers actually show (re-aggregated from T01's own per-class curves)

| Global threshold | Overall coverage | Precision among committed | Notably low-coverage classes |
|---|---|---|---|
| 0.80 | 99.83% | 99.96% | — |
| 0.85 | 99.54% | 99.98% | — |
| **0.90 (chosen)** | 98.93% | 99.98% | Personal Care (92.9%) |
| 0.95 | 97.38% | 99.99% | Food (95.0%), Groceries (94.7%), Personal Care (87.4%) |

0.90 was chosen over 0.95 specifically because the coverage cost of the last
5 points of (already untrustworthy) precision is disproportionate — three
categories drop below 95% coverage, including two of the highest-volume
categories in the dataset (Food, Groceries). Given that the precision
numbers themselves aren't fully trusted, there's no basis for paying that
coverage cost yet.

## Schema (`threshold_policy.json`)

```json
{
  "schemaVersion": 1,
  "trustLevel": "synthetic-provisional",
  "globalDefaultThreshold": 0.90,
  "perClassThresholds": { "Food": null, "Transport": null, "...": null },
  "qualityTargets": [0.80, 0.90, 0.95],
  "coverageAtCandidateThresholds": [ /* the table above, in full */ ],
  "revisitTrigger": "..."
}
```

`perClassThresholds` is explicitly `null` for all 15 canonical categories —
a visible placeholder for T03, not a silent gap. T03 should read
`globalDefaultThreshold` as the abstain cutoff for every category until a
specific category's entry here stops being `null`.

## When this becomes a real per-class policy

Either condition below is sufficient on its own once genuinely met:

1. **The served model is retrained through the versioned pipeline**
   (`training/model_bundle.py`'s manifest), proving real train/val
   disjointness — today's legacy bundle predates that system and carries no
   recorded manifest (T01's finding #1).
2. **Enough real, non-synthetic feedback accumulates** in
   `db/feedback_repository.py` that `calibrate_confidence.py` can be re-run
   against input the model has not memorized a template of (T01's finding
   #2 — the one condition #1 alone does not fix, since a manifested retrain
   on the *same* templated CSV would still be optimistic).

Re-running `calibrate_confidence.py` under either condition and feeding its
fresh `calibration_report.json` into `threshold_policy.build_policy()` is
the intended upgrade path; `perClassThresholds[<category>]` only needs to
stop being `null` per category once that evidence exists — no other part of
this schema needs to change.

## Deliberately not done here

Retraining the model (via `retrain_pipeline.py`) to resolve finding #1 was
considered and set aside for this task: it requires a live MongoDB
connection (feedback reservation, training-run record) not available in
this environment, and — more importantly — would still leave finding #2
(templated data) unresolved, since it would train on the same
`merged_expenses.csv`. Producing a real manifest without a genuinely
different, non-synthetic dataset behind it would look more resolved than it
actually is. This is left as the trigger condition above, not attempted as
a shortcut.

## Scope note

This is T02 only — an offline transform of an existing report into a
policy artifact. It does not touch `predictor.py`, `backend/Routes/ml.router.js`,
or any served behavior, and requires no database connection. T03 (wiring
`globalDefaultThreshold` into an actual abstain decision in the API
response) is next; T04–T07 (UI, outcome tracking, merchant-rule shortcut,
tests) remain unstarted.
