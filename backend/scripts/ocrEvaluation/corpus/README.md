# OCR evaluation set (OCR-003-T07)

Purpose: measure whether the real OCR + parsing pipeline
(`Services/BillServices/ocrService.js` -> `receiptParser.js`) extracts the
right merchant/amount/date from a receipt **image**, instead of only
exercising the parser's logic against hand-written text the way
`receiptExtractors.test.js` and `receiptParser.hostileText.test.js` do. Run
it whenever a change touches that pipeline, to catch a regression before it
reaches a real user's receipt.

## Status

The harness is complete, runnable, and **has now been run against real
Tesseract** (2026-09-25, from an ordinary terminal on the maintainer's own
machine -- both the cloud sandbox and the device-bridge VM used to build
this corpus fail all outbound network, so neither can run real OCR
itself; see "Running it" below). The corpus (`manifest.json` + `images/`)
has 21 entries: 6 generated synthetic smoke-test fixtures plus 15 real,
anonymized receipt photographs spanning 14 different merchants, three
currencies/formats (INR and Indonesian Rupiah), receipts from 2005
through 2026, thermal print, ink stamps, and a range of photo quality --
real variance no synthetic image can produce.

Two real entries had genuine customer-identifying text (a name, a
name+mobile line) blacked out with a solid rectangle before being
committed; EXIF/GPS metadata was stripped from all 15 by re-encoding.
One entry (`belgian-waffle-co`) arrived pre-redacted by the maintainer
with a physical highlighter and was left as-is. See each entry's `notes`
in `manifest.json` for specifics.

**First real run: 7/21 passed (33.3%).** Digging into the failures
surfaced a genuine bug in this harness itself, not the production
pipeline: `scoring.js`'s date comparison used `date-fns`' `parse()` with
a list of candidate format strings starting with `"d/M/yyyy"`, and that
function is not strict about a token's digit width -- `parse("28/01/26",
"d/M/yyyy", ...)` silently returned a *valid* date with the literal year
26 (0026 AD) instead of failing over to the `"d/M/yy"` format later in
the list. Every real receipt with a 2-digit year was misdated by this
bug in the harness, not by anything the OCR pipeline did. Fixed by
rewriting `parseExtractedDate` to parse explicitly (regex capture +
manual century inference + `Date.UTC` round-trip validation) instead of
relying on `date-fns`' format-guessing; two regression tests pin the
2-digit-year behavior in `tests/ocrEvaluation.scoring.test.js`.

**Re-run after the fix: 12/21 passed (57.1%).** The remaining 9 failures
are real findings about the production pipeline and about this specific
photo set, not further harness bugs:

- **Confirmed regex limitations** (predicted before the run, now
  confirmed by real output): `limbo-premium` and `khodiyar-dhaba` --
  `extractAmount()` has no support for a "Gross Amount" / "Bill Amt"
  total label; both receipts only print the true payable total under a
  label the regex doesn't recognise. `a-grade-samosa` -- no "Total"
  label at all (`NO_AMOUNT_FOUND` fires correctly). `saravana-bhavan` --
  amount mismatch, compounded by the lowest confidence in the failing
  set (44%).
- **A newly-discovered regex bug** (not predicted in advance):
  `extractDate()`'s worded-date alternative
  (`\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}`) never validates that
  the middle token is an actual month name, and `\s+` matches
  newlines -- so on noisy OCR text it can false-positive-match garbage
  spanning a line break (seen on `dindigul-thalappakatti` and
  `chidhambaram-stc`, both low-confidence photos) instead of correctly
  reporting no date found.
- **A newly-discovered ISO-date bug**: `belgian-waffle-co` prints its
  date as `2023-08-17`; `extractDate()`'s numeric-date pattern has no
  start-of-token anchor and no support for `yyyy-mm-dd`, so it matches a
  misleading substring (`23-08-17`) instead of the full date or no match.
- **Genuine OCR noise on lower-quality photos, not pipeline bugs**:
  `1947-restaurant` (date not recognised at all), `a-grade-samosa`'s
  date (single digit misread, 6 -> 8), and `warung-leko`'s amount
  (Tesseract dropped a zero: `107,000` read as `10,700`). In each of
  these, the surrounding pipeline logic (grand-total priority,
  comma-stripping) worked exactly as designed -- see each entry's
  `notes` in `manifest.json` for the full detail.

See `manifest.json`'s per-entry `notes` for the complete, confirmed
write-up behind every bullet above. Whether to fix the confirmed
`receiptExtractors.js` regex gaps (amount-label coverage, ISO dates, the
worded-date false-positive) is follow-on work beyond T07's charter of
building the evaluation set -- T07 itself is complete: the corpus exists,
is anonymized, and has been proven against real OCR.

This tracks with the 2026-09-08 forensic audit's finding for this task
(see `workflow/features/P0/OCR-003-ocr-accuracy-and-reliability.md`): a
synthetic-only corpus was explicitly judged not representative there.
That gap is now closed, and the harness has been run for real against a
representative corpus, with its findings documented above and in
`manifest.json`.

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
for a manual pre-release check. It is opt-in, not the default: the real
corpus (see "Status" above) currently passes 12/21, with the other 9 being
tracked, understood limitations rather than unknowns -- defaulting to a
hard failure here would train people to ignore the gate rather than fix
the underlying regex gaps as their own follow-on work.

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
