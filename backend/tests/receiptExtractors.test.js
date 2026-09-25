// OCR-003-T03/T04 -- per-extractor tests.
//
// These could not exist before: the extractors were private to
// receiptParser.js, so every case had to be written as a whole receipt and a
// failure said "the parse was wrong" rather than which extractor was wrong.
// Receipt text is hostile input, and the cases below are the ones that
// actually cost a user money -- an ambiguous total above all.
"use strict";

const {
  extractMerchant,
  extractAmount,
  extractDate,
  extractItemsBlock,
  looksLikeHeading,
} = require("../Services/BillServices/receiptExtractors");

const { parseReceipt, REVIEW_REASONS } = require("../Services/BillServices/receiptParser");

describe("extractAmount -- selection and ambiguity (T04)", () => {
  test("prefers an explicit grand total over a plain total", () => {
    const result = extractAmount("Total 100.00\nGrand Total 118.00");
    expect(result.value).toBe(118);
    expect(result.matchedText.toLowerCase()).toContain("grand");
  });

  test("takes the last total when there is no grand total -- subtotal precedes total", () => {
    const result = extractAmount("Subtotal 90.00\nTotal 106.20");
    expect(result.value).toBe(106.2);
  });

  test("flags AMBIGUITY when two total-like lines disagree", () => {
    // The selection rule still picks one, but silently guessing at the
    // amount of money to record is exactly what should be surfaced.
    const result = extractAmount("Total 100.00\nTotal 118.00");
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((c) => c.value)).toEqual([100, 118]);
  });

  test("does NOT flag ambiguity when repeated totals agree", () => {
    // A customer copy repeating the same total is agreement, not conflict.
    // Warning here would train people to dismiss the warning.
    const result = extractAmount("Total 45.00\nTotal 45.00");
    expect(result.ambiguous).toBe(false);
    expect(result.value).toBe(45);
  });

  test("returns null with no candidates when no total is present", () => {
    const result = extractAmount("Thank you for shopping");
    expect(result.value).toBeNull();
    expect(result.candidates).toEqual([]);
    expect(result.ambiguous).toBe(false);
  });

  test("a malformed amount fails closed to null rather than a wrong prefix value", () => {
    // parseFloat("12.34.56") would be 12.34 -- a plausible, wrong number.
    const result = extractAmount("Total 12.34.56");
    expect(result.value).toBeNull();
  });

  test("tolerates a non-string without throwing", () => {
    expect(() => extractAmount(undefined)).not.toThrow();
    expect(extractAmount(undefined).value).toBeNull();
  });

  // OCR-003-T08 -- regression tests for a real gap found via OCR-003-T07's
  // real-Tesseract evaluation run: some receipts never print "Total" at all
  // for the true payable amount, only "Gross Amount" or "Bill Amt".
  test("recognises 'Gross Amount' as a total label when no 'Total' line exists", () => {
    // Mirrors limbo-premium from the evaluation corpus: the only
    // "total"-labelled line is a pre-discount Sub Total, and the true
    // payable amount is printed later under "Gross Amount".
    const result = extractAmount("Sub Total 699.00\nGross Amount 640.00");
    expect(result.value).toBe(640);
  });

  test("recognises 'Bill Amt' as a total label when no 'Total' line exists", () => {
    // Mirrors khodiyar-dhaba: "TOTAL" is the pre-GST figure, "Bill Amt" is
    // what the customer actually paid, printed after it.
    const result = extractAmount("TOTAL 216.00\nBill Amt 227.00");
    expect(result.value).toBe(227);
  });

  test("still prefers grand total over Gross Amount/Bill Amt when both are present", () => {
    const result = extractAmount("Bill Amt 227.00\nGrand Total 250.00");
    expect(result.value).toBe(250);
    expect(result.matchedText.toLowerCase()).toContain("grand");
  });
});

describe("extractMerchant and heading detection (T04)", () => {
  test("takes the first two words as the merchant", () => {
    expect(extractMerchant("Fresh Mart\nTotal 120")).toBe("Fresh Mart");
  });

  test("recognises a document heading masquerading as a merchant", () => {
    expect(looksLikeHeading("Tax Invoice")).toBe(true);
    expect(looksLikeHeading("RECEIPT")).toBe(true);
  });

  test("does not flag a real shop whose name merely contains a heading word", () => {
    // "Total Tools" is a real retailer. Flagging it would be a false alarm,
    // and blanking it would be worse.
    expect(looksLikeHeading("Total Tools")).toBe(false);
  });

  test("an empty receipt yields an empty merchant, not a crash", () => {
    expect(extractMerchant("")).toBe("");
    expect(extractMerchant(null)).toBe("");
  });
});

describe("extractDate", () => {
  test.each([
    ["12/05/2026", "12/05/2026"],
    ["3-4-26", "3-4-26"],
    ["14th March 2026", "14th March 2026"],
  ])("recognises %s", (input, expected) => {
    expect(extractDate(`Receipt ${input} Total 10`).value).toBe(expected);
  });

  test("returns null when no date is present", () => {
    expect(extractDate("Fresh Mart Total 10").value).toBeNull();
  });

  // OCR-003-T08 -- regression tests for two real bugs found via OCR-003-T07's
  // real-Tesseract evaluation run.
  test("recognises an ISO-formatted date (yyyy-mm-dd)", () => {
    expect(extractDate("Receipt 2023-08-17 Total 360").value).toBe("2023-08-17");
  });

  test("matches the WHOLE ISO date, not a misleading substring of it", () => {
    // Mirrors belgian-waffle-co: the old regex matched "23-08-17" (starting
    // at the year's 3rd digit) against a receipt printing "2023-08-17",
    // silently producing the wrong date instead of the right one.
    const result = extractDate("Bill date: 2023-08-17\nTotal 360");
    expect(result.value).toBe("2023-08-17");
    expect(result.value).not.toBe("23-08-17");
  });

  test("does not false-positive-match garbled OCR text spanning a line break", () => {
    // Mirrors dindigul-thalappakatti/chidhambaram-stc: the old worded-date
    // alternative accepted ANY word between two numbers, and its
    // whitespace matched across newlines, so garbled OCR output like this
    // used to be misread as a date. "FLOR" is not a month name.
    expect(extractDate("41\nFLOR 4241").value).toBeNull();
  });

  test("still recognises an abbreviated month name", () => {
    expect(extractDate("Receipt 5 Sep 2026 Total 10").value).toBe("5 Sep 2026");
  });
});

describe("extractItemsBlock", () => {
  test("stops at the totals section", () => {
    const block = extractItemsBlock("Items\nMilk 40\nBread 30\nSubtotal 70\nTotal 70");
    expect(block).toContain("Milk 40");
    expect(block).not.toContain("Subtotal");
  });
});

describe("parseReceipt -- review reasons (T04)", () => {
  const lines = (text, confidence) => ({
    version: 1,
    text,
    confidence,
    lines: text.split("\n").map((t) => ({ text: t, confidence, bbox: null })),
  });

  test("a clean receipt reports no reasons and needs no review", () => {
    const parsed = parseReceipt(lines("Fresh Mart\n12/05/2026\nTotal 120", 95));
    expect(parsed.reviewReasons).toEqual([]);
    expect(parsed.needsReview).toBe(false);
  });

  test("a missing amount reports NO_AMOUNT_FOUND and needs review", () => {
    const parsed = parseReceipt(lines("Fresh Mart\n12/05/2026\nThank you", 95));
    expect(parsed.reviewReasons).toContain(REVIEW_REASONS.NO_AMOUNT_FOUND);
    expect(parsed.needsReview).toBe(true);
  });

  test("disagreeing totals report AMBIGUOUS_AMOUNT and expose the candidates", () => {
    const parsed = parseReceipt(lines("Fresh Mart\n12/05/2026\nTotal 100\nTotal 118", 95));
    expect(parsed.reviewReasons).toContain(REVIEW_REASONS.AMBIGUOUS_AMOUNT);
    expect(parsed.amountCandidates.map((c) => c.value)).toEqual([100, 118]);
  });

  test("low overall confidence reports LOW_OVERALL_CONFIDENCE", () => {
    const parsed = parseReceipt(lines("Fresh Mart\n12/05/2026\nTotal 120", 40));
    expect(parsed.reviewReasons).toContain(REVIEW_REASONS.LOW_OVERALL_CONFIDENCE);
    expect(parsed.needsReview).toBe(true);
  });

  test("UNKNOWN confidence is not treated as low confidence", () => {
    // A legacy string caller has no confidence data. Reporting low
    // confidence for every such receipt would make the signal worthless.
    const parsed = parseReceipt("Fresh Mart\n12/05/2026\nTotal 120");
    expect(parsed.reviewReasons).not.toContain(REVIEW_REASONS.LOW_OVERALL_CONFIDENCE);
    expect(parsed.reviewReasons).not.toContain(REVIEW_REASONS.LOW_AMOUNT_CONFIDENCE);
    expect(parsed.needsReview).toBe(false);
  });

  test("a heading-looking merchant is reported without being rewritten", () => {
    const parsed = parseReceipt(lines("Tax Invoice\n12/05/2026\nTotal 120", 95));
    expect(parsed.reviewReasons).toContain(REVIEW_REASONS.MERCHANT_LOOKS_LIKE_HEADING);
    expect(parsed.expenseName).toBe("Tax Invoice");
  });

  test("needsReview keeps its previous meaning and is not widened by the new reasons", () => {
    // An ambiguous amount is a new reason, but on its own it must not flip
    // needsReview -- the shipped T06 UI reads that flag, and widening it in
    // the same change would confuse any regression between the two.
    const parsed = parseReceipt(lines("Fresh Mart\n12/05/2026\nTotal 100\nTotal 118", 95));
    expect(parsed.reviewReasons).toContain(REVIEW_REASONS.AMBIGUOUS_AMOUNT);
    expect(parsed.needsReview).toBe(false);
  });

  test("still accepts a bare string and an unversioned legacy object", () => {
    expect(parseReceipt("Fresh Mart Total 120").expenseAmount).toBe(120);
    expect(
      parseReceipt({ text: "Fresh Mart Total 120", confidence: 90, lines: [] }).expenseAmount
    ).toBe(120);
  });
});
