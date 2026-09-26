# OCR-006-T02: Traditional (non-AI) OCR ceiling

Evidence for the OCR-006 evidence gate item "A non-AI baseline is measured".
The question this task answers: of the receipts the current pipeline gets
wrong, how many could a better non-AI pipeline plausibly fix, and how many
are recognition failures that only a stronger recognizer (for example a
vision model) might fix?

Everything ran locally. OCR is tesseract.js 7.0.0 with the language data
already on disk, and preprocessing uses `sharp`, which is already a backend
dependency. Nothing was installed, and no image or text was sent to any
external service.

## Method

- **Script:** `backend/scripts/ocrEvaluation/measureOcrCeiling.js`, which
  writes `results/ocr-ceiling.json`. Run it from `backend/` with
  `node scripts/ocrEvaluation/measureOcrCeiling.js [--budget=150]
  [--no-variants]`. The variant sweep is 588 OCR passes, so the script is
  resumable: each invocation works for at most `--budget` seconds, caches
  progress in `results/ocr-variants-cache.json`, and writes the report when
  the sweep is complete. Each pass gets the same 30 s budget that
  production's `OCR_TIMEOUT_MS` defaults to, and none timed out. All
  outputs are gitignored run output.
- **(a) Current accuracy:** the real pipeline's scores, re-derived from
  T01's cached raw OCR (`results/raw-ocr-baseline.json`). These are
  identical to `npm run eval:ocr`.
- **(b) Extraction ceiling:** the score a *perfect extractor* would get on
  the *same* raw OCR text. A gated field counts if it already matches, or
  if its correct value is present in the text under T01's matching rules
  (see `OCR-006-T01-failure-corpus.md`). This is an upper bound, because
  "present" does not tell an extractor which occurrence is the answer.
- **(c) Recognition-side ceiling:** the same 21 images through 7
  preprocessing variants crossed with 4 Tesseract page-segmentation modes
  (PSM), giving 28 configurations. Every configuration is scored with the
  unchanged `parseReceipt()` + `scoring.js`.
  - **Variants:**
    - `original`: the unmodified image.
    - `production-preprocess`: the real `imageProcessor.preprocessImage()`.
    - `gray-normalize`: grayscale plus normalise.
    - `gray-up`: grayscale plus a 2x Lanczos upscale, capped at 3000 px on
      the long side.
    - `gray-up-normalize-sharpen`: `gray-up` plus normalise and sharpen.
    - `gray-up-clahe`: `gray-up` plus CLAHE with a 64x64 tile and slope 3.
    - `gray-up-otsu`: `gray-up` plus Otsu binarisation.
  - **PSM:** 3 (auto), 4 (single column), 6 (single block) and 11 (sparse
    text).

  Two views are reported:
  - **Best single configuration:** one fixed configuration for every
    receipt, which is something that could actually ship. Because it is
    chosen on the same 21 receipts it is scored on, it is optimistic.
  - **Oracle:** per receipt and per field, the best of all 28
    configurations. It needs the ground truth to choose, so it is an upper
    bound, not a pipeline.

### Two findings about the setup itself

1. **Production runs PSM 6, not PSM 3.** tesseract.js initializes its
   worker with PSM 6 (`SINGLE_BLOCK`), and `ocrService.js` sets no PSM. The
   sweep's `original/psm6` pass reproduces the harness's OCR text exactly
   on **21/21** entries, which confirms the sweep is comparable to (a).
   Tesseract's own "auto" default (PSM 3) is worse on this corpus: 11/21
   vs 15/21.
2. **The OCR-003-T07 harness does not run the production preprocessing.**
   `runEvaluation.js` passes the original image to
   `extractTextFromImage()`. Both production upload paths
   (`receiptIngestService.js` and `billController.js`) call
   `imageProcessor.preprocessImage()` first. The production path scores
   the **same 15/21**, but on a **different failure set** (see below).
   The harness's header comment says it runs "the same two functions
   receiptIngestService.js calls", which misses this step. It is recorded
   here as a follow-up for the harness owner and was not changed in this
   task.

## Results

The corpus has 21 entries: 6 synthetic and 15 anonymized real receipts. A
receipt passes when amount, date and any asserted reviewReasons all match.

### (a) Current accuracy and (b) extraction ceiling

| Pipeline | Receipts passed | Amount | Date | Merchant (info) |
|---|---|---|---|---|
| (a) Harness baseline (original image, PSM 6) | **15/21** | 17/21 | 18/21 | 12/21 |
| (a) Production path (`preprocessImage()`, PSM 6) | **15/21** | 15/21 | 18/21 | 9/21 |
| (b) Extraction ceiling, harness text | **17/21** | 19/21 | 18/21 | 13/21 present |
| (b) Extraction ceiling, production-path text | **17/21** | 19/21 | 18/21 | n/a |

- **Harness baseline:** 7 failing fields. 2 are extraction failures
  (saravana-bhavan and warung-leko amounts). 5 are recognition failures
  (see T01).
- **Production path:** the six failing receipts are hotel-vishwanand,
  1947-restaurant, limbo-premium, chidhambaram-stc, a-grade-samosa and
  warung-leko, with 9 failing fields.
  - 4 fields are extraction failures, all amounts: hotel-vishwanand (500
    extracted vs 525), 1947-restaurant, chidhambaram-stc and warung-leko.
  - 5 fields are recognition failures: the limbo-premium and
    a-grade-samosa amounts, and the 1947-restaurant, chidhambaram-stc and
    a-grade-samosa dates.
  - saravana-bhavan passes on this path.

With the recognizer unchanged, a perfect extractor would move either
pipeline from 15 to at most 17 of 21 receipts.

### (c) Recognition-side ceiling (28 configurations)

| View | Receipts passed | Amount | Date |
|---|---|---|---|
| Best single configuration, current extractor: `gray-up-normalize-sharpen` / PSM 6 | **16/21** | 16/21 | 19/21 |
| Same configuration, extraction ceiling | 18/21 | 18/21 present | 20/21 present |
| Oracle (best per field of all 28), current extractor | **18/21** | 19/21 | 20/21 |
| Oracle, perfect extractor | **20/21** | 20/21 | 21/21 |

The best single configuration **fixes 2** receipts relative to the harness
baseline (1947-restaurant and warung-leko) and **breaks 1**
(hotel-vishwanand). That is a net +1 receipt, chosen on the test set, and
merchant agreement drops from 12 to 7. It is not a clear improvement and
would need a larger corpus to confirm.

Full configuration table (from `results/ocr-ceiling.json`):

| Preprocessing | PSM | Receipts passed | Amount | Date | Merchant | Amount present | Date present | Extraction ceiling (receipts) |
|---|---|---|---|---|---|---|---|---|
| original | 3 | 11 | 14 | 16 | 13 | 16 | 16 | 13 |
| original | 4 | 13 | 16 | 16 | 11 | 17 | 16 | 14 |
| original (harness baseline) | 6 | 15 | 17 | 18 | 12 | 19 | 18 | 17 |
| original | 11 | 9 | 10 | 14 | 10 | 19 | 15 | 14 |
| production-preprocess | 3 | 12 | 14 | 17 | 11 | 15 | 17 | 13 |
| production-preprocess | 4 | 12 | 14 | 16 | 11 | 16 | 16 | 13 |
| production-preprocess (production path) | 6 | 15 | 15 | 18 | 9 | 19 | 18 | 17 |
| production-preprocess | 11 | 11 | 12 | 17 | 9 | 18 | 17 | 15 |
| gray-normalize | 3 | 12 | 15 | 16 | 11 | 15 | 16 | 12 |
| gray-normalize | 4 | 11 | 14 | 15 | 10 | 14 | 15 | 11 |
| gray-normalize | 6 | 15 | 17 | 17 | 10 | 18 | 18 | 17 |
| gray-normalize | 11 | 10 | 12 | 16 | 10 | 19 | 16 | 14 |
| gray-up | 3 | 12 | 14 | 16 | 12 | 15 | 16 | 12 |
| gray-up | 4 | 12 | 13 | 15 | 9 | 14 | 15 | 12 |
| gray-up | 6 | 14 | 16 | 17 | 8 | 18 | 17 | 15 |
| gray-up | 11 | 10 | 13 | 17 | 8 | 19 | 17 | 15 |
| gray-up-normalize-sharpen | 3 | 12 | 13 | 17 | 10 | 13 | 17 | 12 |
| gray-up-normalize-sharpen | 4 | 10 | 11 | 16 | 10 | 12 | 16 | 11 |
| gray-up-normalize-sharpen | 6 | 16 | 16 | 19 | 7 | 18 | 20 | 18 |
| gray-up-normalize-sharpen | 11 | 9 | 11 | 16 | 11 | 18 | 17 | 15 |
| gray-up-clahe | 3 | 13 | 14 | 17 | 12 | 15 | 17 | 14 |
| gray-up-clahe | 4 | 13 | 15 | 14 | 11 | 16 | 14 | 13 |
| gray-up-clahe | 6 | 16 | 16 | 19 | 11 | 17 | 19 | 16 |
| gray-up-clahe | 11 | 10 | 12 | 16 | 11 | 19 | 16 | 14 |
| gray-up-otsu | 3 | 12 | 16 | 15 | 8 | 17 | 16 | 13 |
| gray-up-otsu | 4 | 12 | 15 | 15 | 10 | 15 | 15 | 12 |
| gray-up-otsu | 6 | 11 | 16 | 15 | 8 | 19 | 15 | 13 |
| gray-up-otsu | 11 | 8 | 12 | 13 | 9 | 19 | 14 | 12 |

### What happens to each current failure

These are the 7 failing gated fields of the harness baseline (T01).

| Receipt / field | Status | What recovers it |
|---|---|---|
| saravana-bhavan / amount | **extraction-fixable** | `50.25` is already in the text (`TOTA 50.25`). It needs a fuzzy total label. The production path already gets it right. |
| warung-leko / amount | **extraction-fixable** (also recovered by preprocessing) | `107,000` is already in the text on the payment line. 12 configurations read the grand-total line correctly and extract it, including the best single one. |
| 1947-restaurant / date | **recovered by preprocessing/PSM** | `Date: 18/06/26` is produced by 7 configurations, including `original`/PSM 3 and 4 and `gray-up-normalize-sharpen`/PSM 6. The current extractor then gets it right. |
| a-grade-samosa / date | **recovered by preprocessing/PSM** | `DATE:-16-04-2026` (correct year) appears in 7 configurations, mostly PSM 11 variants plus `gray-normalize`/PSM 3 and `production-preprocess`/PSM 3. |
| chidhambaram-stc / date | **recognized by preprocessing, needs an extractor change too** | The date appears in 6 configurations, for example `12-Sep-2026` under `original`/PSM 11 and `gray-up-otsu`/PSM 11. `extractDate()` has no hyphenated `d-Mon-yyyy` form, the gap already noted in `corpus/README.md`. |
| a-grade-samosa / amount | **recognized by preprocessing, needs an extractor change too** | The amount appears in 8 configurations: `302-00` under PSM 11 variants, and `Cag 302.00` under `gray-up-otsu`/PSM 6. The receipt has no total label, only `CASH`, so the extractor would need a payment-line rule. |
| limbo-premium / amount | **not recovered by any of the 28 configurations** | The payable line comes out as `Grass Aaount #00`, `Gross hunt`, `Gross Anount Wl` and similar. `640` never appears. |

Every "present" hit above was checked by reading the matched OCR line; none
of them is a chance number match. The per-configuration evidence is in
`results/ocr-ceiling.json` under `recognitionCeiling.failureRecovery`.

## Conclusion

On this corpus, the current pipeline has **7 failing gated fields on 6
receipts**. They split as follows:

- **2 fields** (2 receipts) are **extraction failures**. The value is
  already in the OCR text, so better deterministic extraction could fix
  them.
- **4 fields** (3 receipts) are recognition failures on the current
  settings, but **a cheap traditional configuration does produce the
  correct value**:
  - 2 of them are then extracted correctly with no code change.
  - 2 of them also need a small extractor change.

  Recovering them would need a multi-configuration OCR pass plus a rule to
  choose between outputs. No single tested configuration recovers all
  four without regressions, and such a rule was **not** built or tested
  here.
- **1 field** (1 receipt, limbo-premium's total) is a recognition failure
  that **no tested traditional method recovered**. This is the only
  failure on this corpus where a stronger recognizer, such as a vision
  model, is the remaining candidate.

In short: **about 6 of 7 current field failures are plausibly within reach
of non-AI work, and 1 of 7 (1 of 21 receipts) is recognition-only.** These
are upper bounds (oracle selection, and "present" rather than "extracted").
They come from 15 real receipts from one person's purchases. That is far
too few to estimate the benefit of a vision fallback, or to tell a 1-receipt
difference from noise. Nothing here shows that a vision model *would* read
limbo-premium correctly; that would have to be measured, and T03 sets the
privacy conditions for doing so.

What this does support: on the current evidence, the cheaper next steps come
before any vision-model experiment. They are listed as candidates only and
none is implemented:

1. Make `runEvaluation.js` apply `preprocessImage()`, so the harness
   measures production.
2. Add extractor rules for a hyphenated `d-Mon-yyyy` date, fuzzy or
   truncated total labels, and payment (`CASH`) lines, with an arithmetic
   cross-check between total, rounding and payment.
3. Measure a two-pass OCR (for example PSM 6 plus PSM 11) with a
   deterministic candidate-selection rule.
4. Grow the real corpus, especially with low-quality photos of the kind
   limbo-premium represents, so any remaining recognition gap can be sized.
