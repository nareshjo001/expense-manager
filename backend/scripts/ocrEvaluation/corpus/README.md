# OCR evaluation set (OCR-003-T07)

Purpose: measure whether the real OCR + parsing pipeline
(`Services/BillServices/ocrService.js` -> `receiptParser.js`) extracts the
right merchant/amount/date from a receipt **image**, instead of only
exercising the parser's logic against hand-written text the way
`receiptExtractors.test.js` and `receiptParser.hostileText.test.js` do. Run
it whenever a change touches that pipeline, to catch a regression before it
reaches a real user's receipt.

## Status

The harness (this directory) is complete and runnable. The corpus
(`manifest.json` + `images/`) now has 21 entries: 6 generated synthetic
smoke-test fixtures (deterministic regression cases -- amount selection,
ambiguity, the heading-collision guess, the no-amount/no-date/no-text
paths) plus **15 real, anonymized receipt photographs** contributed by
the maintainer on 2026-09-25 (`source: "anonymized-real"` in the
manifest), spanning 14 different merchants, three currencies/formats
(INR and Indonesian Rupiah), receipts from 2005 through 2026, thermal
print, ink stamps, and a range of photo quality -- real variance no
synthetic image can produce.

Two real entries had genuine customer-identifying text (a name, a
name+mobile line) blacked out with a solid rectangle before being
committed; EXIF/GPS metadata was stripped from all 15 by re-encoding.
One entry (`belgian-waffle-co`) arrived pre-redacted by the maintainer
with a physical highlighter and was left as-is. See each entry's `notes`
in `manifest.json` for specifics.

**Not yet done, and it's a real gap, not a formality**: this evaluation
harness has never actually been run against real Tesseract. Both
environments available while building this (the cloud sandbox, and the
local VM a device-bridge session's shell runs in) fail outbound requests
to Tesseract's language-data host -- confirmed directly (`curl` to
google.com itself returns nothing from that local VM despite a
configured proxy, so this is a sandboxing restriction, not something
specific to Tesseract). **`npm run eval:ocr` needs to be run from an
ordinary terminal directly on the machine that has these files** (not
through an AI coding assistant's sandboxed shell) to get real results.
Four of the real entries have a `notes` field flagging a *predicted*
failure from a known regex limitation (a receipt whose only labelled
total is "Gross Amount" or "Bill Amt" rather than "Total"; a date
written `12-Sep-2026` instead of numerically) -- those are informed
guesses from reading the receipts, not measured outcomes, and the actual
run may agree, disagree, or surface something else entirely. Once run,
update this section, `manifest.json` (if any ground truth needs
correcting), the feature doc, and the tracker.

This tracks with the 2026-09-08 forensic audit's finding for this task
(see `workflow/features/P0/OCR-003-ocr-accuracy-and-reliability.md`): a
synthetic-only corpus was explicitly judged not representative there.
That gap is now closed on the corpus side; what's left is running the
harness for real and acting on what it finds.
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

## Adding more real receipts

15 have been added so far (2026-09-25) -- more, especially covering
merchants, layouts or conditions not already represented, are still
welcome and follow the same process. This is the part that needs a
maintainer, not more scripting. To add a real receipt:

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
