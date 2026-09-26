# OCR-006-T01: OCR failure corpus and failure taxonomy

Evidence for the OCR-006 (P3, vision-model OCR fallback) evidence gate.
This task classifies every field the current OCR pipeline gets wrong on the
committed evaluation corpus as either a **recognition** failure (Tesseract
never produced the correct value) or an **extraction** failure (the value
is in Tesseract's text, but the extractor picked the wrong thing or nothing).
Only recognition failures are candidates for a stronger recognizer, such as
a vision model. Extraction failures can be reached by cheaper deterministic
fixes.

No receipt image or OCR text was sent to any external service. OCR is local
tesseract.js, as in `npm run eval:ocr`.

## Method

- **Script:** `backend/scripts/ocrEvaluation/buildFailureCorpus.js`
  (`node scripts/ocrEvaluation/buildFailureCorpus.js` from `backend/`; add
  `--reuse` to reuse cached raw OCR output instead of running OCR again).
- **Pipeline:** the script runs the same real pipeline as the OCR-003-T07
  harness (`runEvaluation.js`): `extractTextFromImage()` ->
  `parseReceipt()` -> `scoring.scoreEntry()`, over all 21 entries in
  `corpus/manifest.json`. It also keeps the raw OCR text, which
  `latest.json` does not store. Scoring is not reimplemented: a field has
  failed exactly when `scoring.js` says it does not match.
- **Outputs:** these files are run output and gitignored, like `latest.*`.
  - `results/raw-ocr-baseline.json`: the full OCR result per entry.
  - `results/failure-corpus.json`: every failing receipt with per-field
    expected vs extracted values, category, evidence and raw text, plus the
    taxonomy counts.
- **Reproduced baseline:** 15/21 passed (run 2026-09-26, tesseract.js
  7.0.0). This is the same result and the same six failing receipts as the
  2026-09-25 run recorded in `corpus/README.md`.

### Classification rule (deterministic)

For each failed field, the script looks for the correct (ground-truth)
value anywhere in the raw OCR text. The matching is normalized per field:

| Field | "Present in raw text" means |
|---|---|
| amount | Some numeric token equals the expected amount within 0.005. Commas are read as thousands separators, so `1,947.00` = 1947 and `107,000` = 107000. A token shaped `123,45` is also read with the comma as a decimal point. A token never starts inside a longer digit run, so `1302` does not contain `302`. |
| date | Some date-shaped token parses to the expected calendar date. Accepted forms: day-first `d/m/y` (separator `/`, `-` or `.`; 2- or 4-digit year read as 20yy), ISO `yyyy-mm-dd`, `12 Sep 2026` / `12-Sep-26`, and `Sep 12, 2026`. At most one space is allowed around a separator, and a token never spans a line break. Day-first follows the same Indian-convention assumption as `scoring.js`. |
| merchant | Every word of 3 or more characters in the normalized ground-truth name occurs in the normalized raw text. This is informational only, like merchant scoring. |

Each failed field then gets one category:

- **recognition**: the value is not present. The recognizer never produced
  it, so no extractor change can recover it from this text. Sub-category
  `near-miss` means a token one digit edit away is present, for example
  `2028` for `2026`, or `10,700` for `107000` (both numbers need 3+
  integer digits). Otherwise the sub-category is `absent`. Near-miss is a
  heuristic signal that the right region was read but a glyph was misread.
  It is not proof.
- **extraction**: the value is present, but the extractor returned
  something else or nothing. A null ground truth that the extractor filled
  anyway is also extraction (`false-positive`). For amounts, the
  sub-category records whether the correct value sits on a line with a
  payable-total keyword (`labelled-line`) or only on some other line
  (`unlabelled-line`).
- **derived**: `reviewReasons` mismatches, which are computed from the
  other fields rather than read off the receipt. There were none in this
  run.

"Present" is a necessary condition for an extractor to succeed, not a
sufficient one: a small amount can appear on an unrelated line. That makes
extraction counts an upper bound on what extractor work can recover.
OCR-006-T02 builds on exactly that bound.

Unit tests for every matching and classification rule are in
`backend/tests/ocrEvaluation.failureTaxonomy.test.js`.

## Results

### Taxonomy

The pass/fail gate uses amount, date and reviewReasons. There are 21 entries:
6 synthetic and 15 anonymized real receipts.

| Field | Failures | Recognition (of which near-miss) | Extraction | Derived |
|---|---|---|---|---|
| amount | 4 | 2 (0) | 2 | 0 |
| date | 3 | 3 (1) | 0 | 0 |
| reviewReasons | 0 | 0 | 0 | 0 |
| **Gated total** | **7 field failures on 6 receipts** | **5** | **2** | **0** |
| merchant (informational) | 9 | 7 (0) | 2 | 0 |

All 6 failing receipts are real photographs. All 6 synthetic fixtures pass.

### Failure corpus

| Receipt | Field | Expected | Extracted | Category | Evidence from raw OCR text |
|---|---|---|---|---|---|
| 1947-restaurant | date | 2026-06-18 | *(none)* | recognition / absent | No date-shaped token at all. The receipt's `Date:` line was not produced. |
| saravana-bhavan | amount | 50.25 | 3 | extraction / unlabelled-line | `p TOTA 50.25`: the label was cut to `TOTA`, so the extractor matched `TOTAL og 3.00` instead. |
| limbo-premium | amount | 640 | 1 | recognition / absent | The payable line reads `Grass Aaount #00`. `640` does not appear anywhere. |
| chidhambaram-stc | date | 2026-09-12 | *(none)* | recognition / absent | The printed `12-Sep-2026` came out as `1250p-2026`. |
| a-grade-samosa | amount | 302 | *(none)* | recognition / absent | The text stops before the `CASH 302.00` line. There is no total label on this receipt. |
| a-grade-samosa | date | 2026-04-16 | 16-04-2028 | recognition / near-miss | `DATE: -16-04-2028` (6 misread as 8). |
| warung-leko | amount | 107000 | 10700 | extraction / unlabelled-line | The grand-total line was misread (`Grand Total + 107,00`). The correct `107,000` appears only on the payment line `OR: 107,000`. |

Two rows correct or refine hypotheses recorded earlier in `corpus/README.md`:

- **chidhambaram-stc.** The README records that the date is printed as
  `12-Sep-2026`, a format `extractDate()` does not support. That is true of
  the paper, but on this OCR text the failure is recognition, not
  extraction: the date never reaches the extractor as `12-Sep-2026`. T02
  shows that some preprocessing/PSM variants do produce the correct string,
  and at that point the extractor gap also matters.
- **warung-leko.** This is extraction by the rule, but it is a mixed case.
  The labelled line itself was misrecognized, and only an unlabelled
  payment line holds the right value. An extractor could reach it only
  through weaker anchors, such as payment lines or the arithmetic
  cross-check `Total Bill 107,107 - Pembulatan 107`.

Both extraction failures are `unlabelled-line`. Neither is a simple
missing-label regex gap like the ones OCR-003-T08 fixed.

### Merchant (informational, not gated)

There are 9 mismatches. 7 are recognition failures by the strict all-words
rule (for example `barurg Leko` for Warung Leko, and `SSR Lo` for 1947
Restaurant). The other 2 are extraction failures: `heading-collision` and
`belgian-waffle-co`, where the name is in the text but
`extractMerchant()` takes the first two words. Merchant is not part of the
pass gate, so it is reported only for completeness.

## Limits of this evidence

- **Small sample.** 15 real receipts from one maintainer's own purchases,
  14 merchants, mostly Indian restaurants. 7 field failures is too few for
  any percentage to be stable. Counts are given alongside every rate for
  that reason.
- **Harness path differs from production.** The harness (and therefore
  this corpus) feeds Tesseract the original image. The production upload
  paths (`receiptIngestService.js`, `billController.js`) first run
  `imageProcessor.preprocessImage()`: rotate, fit inside 1500px, grayscale,
  normalise, sharpen. T02 measures that production path separately. It also
  scores 15/21, but with a different failure set.
- **The rule is only as good as its normalization.** It is lenient in one
  direction and strict in the other. A whole-rupee amount with a garbled
  decimal separator still matches through its integer token (`302-00`
  contains the token `302`). An amount split by a space (`1 947`) or with a
  misread digit does not match.
