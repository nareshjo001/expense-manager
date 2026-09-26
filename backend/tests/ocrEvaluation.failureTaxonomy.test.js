// OCR-006-T01/T02 -- unit tests for the failure-taxonomy and ceiling
// helpers. Pure functions only: no OCR, no sharp, no filesystem, matching
// the stance of ocrEvaluation.scoring.test.js.
"use strict";

const {
  findNumericTokens,
  findAmountInText,
  findDateCandidates,
  findDateInText,
  findMerchantInText,
  classifyFieldFailure,
  buildFailureRecord,
  summarizeTaxonomy,
  editDistance,
} = require("../scripts/ocrEvaluation/buildFailureCorpus");
const {
  normalizeLayout,
  otsuThreshold,
  upscaleFactor,
  extractionCeilingOf,
  classifyRecovery,
  rankConfigs,
} = require("../scripts/ocrEvaluation/measureOcrCeiling");

describe("findNumericTokens / findAmountInText", () => {
  test("reads thousands separators and offers comma-as-decimal for 123,45", () => {
    const tokens = findNumericTokens("Grand Total 1,947.00\nIDR 107,000\nPaid 50,25");
    expect(tokens.map((t) => t.values)).toEqual([[1947], [107000], [5025, 50.25]]);
  });

  test("never starts a token inside a longer digit run", () => {
    expect(findAmountInText("GSTIN 1302", 302).present).toBe(false);
    expect(findAmountInText("CASH 302.00", 302).present).toBe(true);
  });

  test("records whether the value sits on a payable-total line", () => {
    expect(findAmountInText("Grand Total 525.00", 525).labelled).toBe(true);
    expect(findAmountInText("Idli 525.00", 525).labelled).toBe(false);
  });

  test("near misses need 3+ digits on both sides", () => {
    expect(findAmountInText("Time 23:40", 640).nearMisses).toEqual([]);
    expect(findAmountInText("Grand Total 107,00", 107000).nearMisses).toEqual(["107,00"]); // dropped zero
    expect(findAmountInText("Total 1,070", 107000).nearMisses).toEqual([]); // two edits away
    expect(findAmountInText("Total 802", 302).nearMisses).toEqual(["802"]);
  });

  test("a null/absent expected amount is never present", () => {
    expect(findAmountInText("Total 10", null).present).toBe(false);
  });
});

describe("findDateCandidates / findDateInText", () => {
  test("reads day-first numeric, ISO and worded forms", () => {
    const text = "Date: 28-04-09\nOn 2023-08-17\n12-Sep-2026\nSep 12, 2026\n16 / 04 / 2026";
    const isos = findDateCandidates(text).map((c) => c.iso);
    expect(isos).toEqual(
      expect.arrayContaining(["2009-04-28", "2023-08-17", "2026-09-12", "2026-04-16"])
    );
  });

  test("does not match across a line break", () => {
    expect(findDateInText("12\n09\n2026", "2026-09-12").present).toBe(false);
  });

  test("flags a single-digit misread as a near miss, not a match", () => {
    const r = findDateInText("DATE: 16-04-2028", "2026-04-16");
    expect(r.present).toBe(false);
    expect(r.nearMisses).toEqual(["16-04-2028"]);
  });

  test("a matching date anywhere counts as present", () => {
    expect(findDateInText("Tanggal : 15-04-26", "2026-04-15").present).toBe(true);
  });
});

describe("findMerchantInText", () => {
  test("requires every 3+ character word of the name", () => {
    expect(findMerchantInText("RATNA CAFE\nMylapore", "Ratna Cafe - Mylapore").present).toBe(true);
    expect(findMerchantInText("RATNA CAFE", "Ratna Cafe - Mylapore")).toEqual({
      present: false,
      missingWords: ["mylapore"],
    });
  });
});

describe("classifyFieldFailure", () => {
  test("value present in raw text -> extraction", () => {
    const r = classifyFieldFailure("amount", { expected: 50.25, rawText: "TOTA 50.25" });
    expect(r.category).toBe("extraction");
    expect(r.subcategory).toBe("unlabelled-line");
  });

  test("value absent -> recognition, with near-miss sub-category when applicable", () => {
    expect(classifyFieldFailure("date", { expected: "2026-04-16", rawText: "16-04-2028" })).toMatchObject({
      category: "recognition",
      subcategory: "near-miss",
    });
    expect(classifyFieldFailure("date", { expected: "2026-06-18", rawText: "Grand Total 1947.00" })).toMatchObject({
      category: "recognition",
      subcategory: "absent",
    });
  });

  test("empty raw text -> recognition", () => {
    expect(classifyFieldFailure("amount", { expected: 10, rawText: "" }).category).toBe("recognition");
  });

  test("null ground truth that was filled anyway -> extraction false positive", () => {
    expect(classifyFieldFailure("amount", { expected: null, rawText: "Total 5" })).toMatchObject({
      category: "extraction",
      subcategory: "false-positive",
    });
  });

  test("reviewReasons are derived, and unknown fields throw", () => {
    expect(classifyFieldFailure("reviewReasons", { expected: [], rawText: "x" }).category).toBe("derived");
    expect(() => classifyFieldFailure("tip", { expected: 1, rawText: "x" })).toThrow();
  });
});

describe("buildFailureRecord / summarizeTaxonomy", () => {
  const entry = {
    id: "r1",
    source: "anonymized-real",
    groundTruth: { expenseName: "Warung Leko", expenseAmount: 107000, expenseDate: "2026-04-15" },
  };
  const score = {
    id: "r1",
    passed: false,
    merchantMatch: false,
    amountMatch: false,
    dateMatch: true,
    reasonsMatch: null,
    extracted: { expenseName: "barurg Leko", expenseAmount: 10700, expenseDate: "15-04-26", reviewReasons: [] },
  };
  const record = buildFailureRecord(entry, score, "barurg Leko\nGrand Total 107,00\nOR: 107,000", 76);

  test("classifies only failed fields and lists gated failures", () => {
    expect(record.gatedFailures).toEqual(["amount"]);
    expect(record.fields.amount.category).toBe("extraction");
    expect(record.fields.date.category).toBeUndefined();
    expect(record.fields.merchant).toMatchObject({ informational: true, category: "recognition" });
  });

  test("counts per field and totals only gated fields", () => {
    const t = summarizeTaxonomy([record]);
    expect(t.amount).toMatchObject({ failures: 1, extraction: 1, recognition: 0 });
    expect(t.merchant.failures).toBe(1);
    expect(t.gatedTotal).toEqual({ fieldFailures: 1, recognition: 0, extraction: 1, derived: 0 });
  });
});

describe("editDistance", () => {
  test("counts insertions, deletions and substitutions", () => {
    expect(editDistance("107000", "10700")).toBe(1);
    expect(editDistance("2026", "2028")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
  });
});

describe("measureOcrCeiling helpers", () => {
  test("normalizeLayout collapses spaces and blank lines but keeps line breaks", () => {
    expect(normalizeLayout("  Total   45 \n\n\t Date  1/2/26 ")).toBe("Total 45\nDate 1/2/26");
  });

  test("otsuThreshold separates a bimodal histogram", () => {
    const pixels = Uint8Array.from([...Array(50).fill(20), ...Array(50).fill(220)]);
    const t = otsuThreshold(pixels);
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThan(220);
  });

  test("upscaleFactor caps at 2x and at the max side, never below 1x", () => {
    expect(upscaleFactor(400, 600)).toBe(2);
    expect(upscaleFactor(770, 1991)).toBeCloseTo(3000 / 1991);
    expect(upscaleFactor(4000, 100)).toBe(1);
  });

  test("extractionCeilingOf counts a field as reachable when matched or present", () => {
    expect(
      extractionCeilingOf({ amountMatch: false, amountPresent: true, dateMatch: true, datePresent: true, reasonsMatch: null })
    ).toEqual({ amount: true, date: true, passed: true });
    expect(
      extractionCeilingOf({ amountMatch: true, amountPresent: true, dateMatch: false, datePresent: false, reasonsMatch: null })
        .passed
    ).toBe(false);
  });

  test("classifyRecovery orders statuses from cheapest to hardest fix", () => {
    const none = { variantExtractedBy: [], variantPresentIn: [] };
    expect(classifyRecovery({ baselinePresent: true, ...none })).toBe("extraction-fixable");
    expect(classifyRecovery({ baselinePresent: false, variantExtractedBy: ["a"], variantPresentIn: ["a"] })).toBe(
      "recovered-by-preprocessing"
    );
    expect(classifyRecovery({ baselinePresent: false, variantExtractedBy: [], variantPresentIn: ["a"] })).toBe(
      "recognised-by-preprocessing-not-extracted"
    );
    expect(classifyRecovery({ baselinePresent: false, ...none })).toBe("not-recovered");
  });

  test("rankConfigs prefers pass count, then amount, then date, stably", () => {
    const mk = (name, passed, amountMatch, dateMatch) => ({ name, summary: { passed, amountMatch, dateMatch } });
    const ranked = rankConfigs([mk("a", 15, 17, 18), mk("b", 16, 16, 18), mk("c", 16, 17, 17), mk("d", 16, 17, 17)]);
    expect(ranked.map((c) => c.name)).toEqual(["c", "d", "b", "a"]);
  });
});
