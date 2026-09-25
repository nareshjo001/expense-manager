# OCR evaluation set (OCR-003-T07)

Purpose: measure whether the real OCR + parsing pipeline
(`Services/BillServices/ocrService.js` -> `receiptParser.js`) extracts the
right merchant/amount/date from a receipt **image**, instead of only
exercising the parser's logic against hand-written text the way
`receiptExtractors.test.js` and `receiptParser.hostileText.test.js` do. Run
it whenever a change touches that pipeline, to catch a regression before it
reaches a real user's receipt.

## Status

The harness (this directory) is complete and runnable. The committed
corpus (`manifest.json` + `images/`) is **synthetic smoke-test fixtures
only** -- six generated receipt-like images, not real photographs. They
prove the harness works end to end and catch regressions in the
deterministic parts of the pipeline (amount selection, ambiguity
detection, the heading-collision guess, the no-amount/no-date/no-text
paths). They do **not** measure real-world OCR accuracy: rendered SVG text
has none of the thermal-print fade, skew, crumpling, glare or handwriting
variance that make real receipts hard to read -- which is exactly what
OCR-003 (confidence, retry and review-UI behavior) exists to handle. A
**representative** evaluation set needs real anonymized receipt
photographs, which this environment has no way to source; see "Adding real
receipts" below.

This tracks with the 2026-09-08 forensic audit's finding for this task
(see `workflow/features/P0/OCR-003-ocr-accuracy-and-reliability.md`): a
synthetic corpus was explicitly judged not representative there, for the
same reason repeated above. What changed since then is that the harness,
scoring and synthetic smoke corpus now exist and are unit-tested -- only
the real-photograph corpus remains outstanding, and only a maintainer with
actual receipts can supply that.

## Running it

```
cd backend
npm run eval:ocr
```

This runs the real `extractTextFromImage()` (real Tesseract, no mocking)
against every image in `manifest.json`, scores each result against its
ground truth, prints PASS/FAIL per entry, and writes `../results/latest.json`
and `../results/latest.md`. `results/` is gitignored -- it is run output,
not a fixture.

It needs no database, Redis, or any other service running -- OCR runs
standalone here exactly as it does inside `ingestReceipt()`. It does need
network access the first time, for Tesseract to fetch its English language
data (cached afterward); this repo's cloud sandbox environment cannot reach
that host, so this harness's real-OCR output has not been verified from
there -- only its scoring/orchestration logic has (see
`ocrEvaluation.scoring.test.js` and `ocrEvaluation.runEvaluation.test.js`,
both of which mock the OCR call). Run it once locally after cloning to
confirm the synthetic fixtures still pass; if one doesn't, that's either a
real pipeline regression (worth filing) or ground truth that needs
adjusting in `manifest.json` (edit by hand, or regenerate via
`generateSyntheticFixtures.js` if the rendered text itself needs to
change).

`OCR_EVAL_STRICT=1 npm run eval:ocr` exits non-zero on any failing entry,
for a manual pre-release check. It is opt-in, not the default, because the
only corpus committed today is the synthetic one above -- defaulting to a
hard failure on a corpus that's explicitly not representative would train
people to ignore the gate.

## Corpus format

`manifest.json`:

```json
{
  "version": 1,
  "corpusType": "synthetic-smoke-test",
  "entries": [
    {
      "id": "clean-simple",
      "image": "images/clean-simple.png",
      "source": "synthetic",
      "anonymized": true,
      "groundTruth": {
        "expenseName": "Coffee House",
        "expenseAmount": 245,
        "expenseDate": "2026-03-12",
        "expectReviewReasons": []
      },
      "notes": "..."
    }
  ]
}
```

- `groundTruth.expenseAmount` -- a number, or `null` if no total should be
  found.
- `groundTruth.expenseDate` -- an ISO `YYYY-MM-DD` string, or `null`. The
  scorer parses whatever raw text `extractDate()` matched (day-first,
  matching this app's INR/Indian-market convention -- see `scoring.js`)
  and compares the result.
- `groundTruth.expenseName` -- compared loosely (case-insensitive
  containment), never exact-match: `extractMerchant()` is a positional
  guess (first two words of the document), not a name lookup, and
  `receiptExtractors.js` already documents that limitation. Merchant
  match is informational only and is never part of the pass/fail gate.
- `groundTruth.expectReviewReasons` -- optional. When present, the scorer
  checks it (as a set) against `parseReceipt()`'s `reviewReasons`, with the
  three confidence-derived codes (`LOW_OVERALL_CONFIDENCE`,
  `LOW_AMOUNT_CONFIDENCE`, `LOW_DATE_CONFIDENCE`) excluded from both sides
  first -- those depend on Tesseract's actual recognition quality, which a
  synthetic render can't control or predict, and asserting on them here
  would make the fixture flaky rather than meaningful. When absent,
  `reviewReasons` are not graded for that entry.
- `source` -- `"synthetic"` or `"anonymized-real"`. `anonymized` must be
  `true` for every entry; there is no path in this harness for a
  non-anonymized image.

## Adding real receipts

This is the part that needs a maintainer, not more scripting. To add a
real receipt:

1. Photograph or scan the receipt the way a real user would (phone camera,
   not a flatbed scan -- skew and lighting variance are part of what's
   being measured).
2. Anonymize it before it touches this repository:
   - Crop or black out card/account numbers, loyalty or membership IDs,
     phone numbers, home addresses and signatures.
   - Do not include a receipt that names a person other than the
     purchaser, or one for a purchase category that would out someone's
     health, legal or other sensitive situation (see `docs/privacy/`).
   - Strip image metadata (EXIF/GPS). `sharp` (already a backend
     dependency) drops it by default when re-encoding, e.g.
     `node -e "require('sharp')('in.jpg').jpeg().toFile('out.jpg')"`;
     confirm with `exiftool out.jpg` if available.
   - Only add a receipt you have the right to share.
3. Save the anonymized image to `images/<id>.jpg` (or `.png`).
4. Add an entry to `manifest.json` by hand: `source: "anonymized-real"`,
   the true merchant/amount/date as you read them off the receipt,
   `expectReviewReasons` omitted unless you're confident what the OCR pass
   should flag.
5. Run `npm run eval:ocr` and confirm the new entry's extracted values look
   right before committing -- if they don't, that's either a real pipeline
   bug (file it) or ground truth you got wrong (fix the manifest entry).
6. Once there are enough real entries to be representative of this app's
   actual receipt mix (multiple merchants, lighting conditions, receipt
   paper types), update `corpusType` in the manifest and the "Status"
   section above, and move OCR-003-T07 to Done in the tracker and feature
   doc.
