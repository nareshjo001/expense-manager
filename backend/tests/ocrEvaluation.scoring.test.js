// OCR-003-T07 -- unit tests for the evaluation harness's pure comparison
// and aggregation functions. No OCR, no fixtures, no filesystem: these are
// the same kind of per-unit cases receiptExtractors.test.js uses, applied
// to the scoring rules instead of the extraction rules.
"use strict";

const {
  normalizeMerchant,
  merchantMatches,
  amountMatches,
  parseExtractedDate,
  dateMatches,
  reviewReasonsMatch,
  scoreEntry,
  aggregateScores,
  stripConfidenceReasons,
} = require("../scripts/ocrEvaluation/scoring");

describe("normalizeMerchant / merchantMatches", () => {
  test("strips punctuation and case before comparing", () => {
    expect(normalizeMerchant("Coffee-House, Inc.")).toBe("coffeehouse inc");
  });

  test("matches via containment in either direction", () => {
    expect(merchantMatches("Star Mart", "Star Mart 24/7")).toBe(true);
    expect(merchantMatches("Star Mart 24/7 Branch 2", "Star Mart")).toBe(true);
  });

  test("both empty counts as a match", () => {
    expect(merchantMatches("", "")).toBe(true);
    expect(merchantMatches(null, undefined)).toBe(true);
  });

  test("one empty, one not, does not match", () => {
    expect(merchantMatches("", "Star Mart")).toBe(false);
    expect(merchantMatches("Star Mart", "")).toBe(false);
  });

  test("unrelated names do not match", () => {
    expect(merchantMatches("Tax Invoice", "Star Mart")).toBe(false);
  });
});

describe("amountMatches", () => {
  test("equal numbers match", () => {
    expect(amountMatches(245, 245)).toBe(true);
  });

  test("both null counts as a match", () => {
    expect(amountMatches(null, null)).toBe(true);
  });

  test("one null, one a number, does not match", () => {
    expect(amountMatches(null, 245)).toBe(false);
    expect(amountMatches(245, null)).toBe(false);
  });

  test("tolerates floating-point noise", () => {
    expect(amountMatches(320.5, 320.5000001)).toBe(true);
  });

  test("different values do not match", () => {
    expect(amountMatches(100, 118)).toBe(false);
  });
});

describe("parseExtractedDate / dateMatches", () => {
  test("parses a slash-separated day-first date", () => {
    expect(parseExtractedDate("12/03/2026")).toBe("2026-03-12");
  });

  test("parses a dash-separated day-first date", () => {
    expect(parseExtractedDate("05-01-2026")).toBe("2026-01-05");
  });

  test("parses a written-month date, with or without an ordinal suffix", () => {
    expect(parseExtractedDate("3rd April 2026")).toBe("2026-04-03");
    expect(parseExtractedDate("22 September 2026")).toBe("2026-09-22");
  });

  test("returns null for unparseable or empty text", () => {
    expect(parseExtractedDate("not a date")).toBeNull();
    expect(parseExtractedDate("")).toBeNull();
    expect(parseExtractedDate(null)).toBeNull();
  });

  test("dateMatches: both absent counts as a match", () => {
    expect(dateMatches(null, null)).toBe(true);
  });

  test("dateMatches: one absent, one present, does not match", () => {
    expect(dateMatches("12/03/2026", null)).toBe(false);
    expect(dateMatches(null, "2026-03-12")).toBe(false);
  });

  test("dateMatches: matching and mismatching dates", () => {
    expect(dateMatches("12/03/2026", "2026-03-12")).toBe(true);
    expect(dateMatches("12/03/2026", "2026-03-13")).toBe(false);
  });
});

describe("reviewReasonsMatch", () => {
  test("matches regardless of order", () => {
    expect(reviewReasonsMatch(["NO_DATE_FOUND", "AMBIGUOUS_AMOUNT"], ["AMBIGUOUS_AMOUNT", "NO_DATE_FOUND"])).toBe(
      true
    );
  });

  test("ignores confidence-derived reasons on both sides", () => {
    expect(reviewReasonsMatch(["NO_DATE_FOUND", "LOW_OVERALL_CONFIDENCE"], ["NO_DATE_FOUND"])).toBe(true);
    expect(reviewReasonsMatch(["NO_DATE_FOUND"], ["NO_DATE_FOUND", "LOW_AMOUNT_CONFIDENCE"])).toBe(true);
  });

  test("a genuine mismatch still fails", () => {
    expect(reviewReasonsMatch(["NO_DATE_FOUND"], ["AMBIGUOUS_AMOUNT"])).toBe(false);
    expect(reviewReasonsMatch(["NO_DATE_FOUND"], [])).toBe(false);
  });
});

describe("stripConfidenceReasons", () => {
  test("removes only the three confidence codes", () => {
    expect(
      stripConfidenceReasons([
        "NO_AMOUNT_FOUND",
        "LOW_OVERALL_CONFIDENCE",
        "LOW_AMOUNT_CONFIDENCE",
        "LOW_DATE_CONFIDENCE",
        "MERCHANT_LOOKS_LIKE_HEADING",
      ])
    ).toEqual(["NO_AMOUNT_FOUND", "MERCHANT_LOOKS_LIKE_HEADING"]);
  });

  test("tolerates a non-array input", () => {
    expect(stripConfidenceReasons(undefined)).toEqual([]);
  });
});

describe("scoreEntry", () => {
  const entry = {
    id: "clean-simple",
    groundTruth: {
      expenseName: "Coffee House",
      expenseAmount: 245,
      expenseDate: "2026-03-12",
      expectReviewReasons: [],
    },
  };

  test("passes when amount, date and reviewReasons all match", () => {
    const parsed = {
      expenseName: "Coffee House",
      expenseAmount: 245,
      expenseDate: "12/03/2026",
      overallConfidence: 91,
      needsReview: false,
      reviewReasons: [],
    };
    const result = scoreEntry(entry, parsed);
    expect(result).toMatchObject({
      id: "clean-simple",
      passed: true,
      merchantMatch: true,
      amountMatch: true,
      dateMatch: true,
      reasonsMatch: true,
    });
  });

  test("fails when the amount is wrong, even if merchant and date match", () => {
    const parsed = {
      expenseName: "Coffee House",
      expenseAmount: 999,
      expenseDate: "12/03/2026",
      overallConfidence: 91,
      needsReview: false,
      reviewReasons: [],
    };
    const result = scoreEntry(entry, parsed);
    expect(result.amountMatch).toBe(false);
    expect(result.passed).toBe(false);
  });

  test("a merchant mismatch alone does not fail the entry (informational only)", () => {
    const parsed = {
      expenseName: "Tax Invoice",
      expenseAmount: 245,
      expenseDate: "12/03/2026",
      overallConfidence: 91,
      needsReview: false,
      reviewReasons: [],
    };
    const result = scoreEntry(entry, parsed);
    expect(result.merchantMatch).toBe(false);
    expect(result.passed).toBe(true);
  });

  test("reviewReasons are not graded when the fixture omits an expectation", () => {
    const entryWithoutExpectation = { id: "x", groundTruth: { expenseAmount: 245, expenseDate: "2026-03-12" } };
    const parsed = {
      expenseName: "Coffee House",
      expenseAmount: 245,
      expenseDate: "12/03/2026",
      overallConfidence: 91,
      needsReview: false,
      reviewReasons: ["AMBIGUOUS_AMOUNT"],
    };
    const result = scoreEntry(entryWithoutExpectation, parsed);
    expect(result.reasonsMatch).toBeNull();
    expect(result.passed).toBe(true);
  });
});

describe("aggregateScores", () => {
  test("computes rates and lists failing ids", () => {
    const results = [
      { id: "a", passed: true, merchantMatch: true, amountMatch: true, dateMatch: true, reasonsMatch: true },
      { id: "b", passed: false, merchantMatch: false, amountMatch: false, dateMatch: true, reasonsMatch: null },
      { id: "c", passed: true, merchantMatch: true, amountMatch: true, dateMatch: true, reasonsMatch: null },
      { id: "d", passed: true, merchantMatch: true, amountMatch: true, dateMatch: true, reasonsMatch: false },
    ];
    // "d" has reasonsMatch: false, which the pass/fail gate in scoreEntry()
    // would have already failed -- this fixture tests aggregateScores()
    // purely on the fields it reads, independent of scoreEntry()'s own
    // rule, so it is deliberately inconsistent with scoreEntry()'s output.
    const aggregate = aggregateScores(results);

    expect(aggregate.total).toBe(4);
    expect(aggregate.passed).toBe(3);
    expect(aggregate.failed).toBe(1);
    expect(aggregate.passRate).toBe(75);
    expect(aggregate.merchantMatchRate).toBe(75);
    expect(aggregate.amountMatchRate).toBe(75);
    expect(aggregate.dateMatchRate).toBe(100);
    expect(aggregate.failingIds).toEqual(["b"]);
    // reasonsMatch is non-null (asserted) only for a (true) and d (false);
    // b and c are null (no expectation declared) and are excluded.
    expect(aggregate.reviewReasonsAssertedCount).toBe(2);
    expect(aggregate.reviewReasonsPassRate).toBe(50);
  });

  test("handles an empty result set without dividing by zero", () => {
    const aggregate = aggregateScores([]);
    expect(aggregate).toMatchObject({ total: 0, passed: 0, failed: 0, passRate: 0, failingIds: [] });
  });
});
