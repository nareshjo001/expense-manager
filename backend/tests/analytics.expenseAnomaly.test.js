// Phase 1 (V1): isolated characterization of the pure, deterministic
// expenseAnomalyAnalyzer.analyze() contract.
//
// This suite exercises ONLY backend/analytics/analyzers/expenseAnomalyAnalyzer.js
// (and, indirectly, its sibling scores/expenseAnomalyRules.js). It never
// touches MongoDB, Redis, the ML service, the network, the filesystem
// (beyond one static source-text check below), or SIA. No jest.mock/
// jest.doMock is used anywhere in this file -- the analyzer takes plain
// JS values in and returns plain JS values out, so there is nothing to
// mock.
"use strict";

const fs = require("fs");
const path = require("path");

const { analyze } = require("../analytics/analyzers/expenseAnomalyAnalyzer");
const { anomaly: RULES } = require("../analytics/analyzers/scores/expenseAnomalyRules");

// Analysis month: August 2026, local time -- matches this repository's own
// month-boundary convention (analytics/dataProvider.js's
// `new Date(year, month, 1)`), constructed explicitly and never derived
// from `new Date()`.
const CURRENT_MONTH_START = new Date(2026, 7, 1);
const CURRENT_MONTH_MID = new Date(2026, 7, 15);
const BASELINE_START = new Date(2025, 7, 1); // exactly 12 months before CURRENT_MONTH_START
const SAFE_BASELINE_DATE = new Date(2025, 9, 15); // comfortably inside the 12-month window

const makeCandidate = (overrides = {}) => ({
  _id: "candidate-1",
  expenseCategory: "Food",
  expenseAmount: 3500,
  expenseDate: CURRENT_MONTH_MID,
  expenseName: "Dinner",
  ...overrides,
});

// Builds N baseline (historical) records for one category, one amount per
// record, all dated on the same safely-in-window date unless overridden.
const makeBaselineRecords = (category, amounts, date = SAFE_BASELINE_DATE) =>
  amounts.map((amount, index) => ({
    _id: `${category}-baseline-${index}`,
    expenseCategory: category,
    expenseAmount: amount,
    expenseDate: date,
    expenseName: `${category} baseline ${index}`,
  }));

// A clean 10-record baseline with median=500, MAD=250 -- MAD is large
// relative to the median, so the amountRatio (>=2.0) condition is already
// satisfied well before modifiedZ reaches 3.5. Used to isolate the
// modifiedZ boundary.
const MODIFIED_Z_BASELINE_AMOUNTS = [50, 150, 250, 350, 450, 550, 650, 750, 850, 950];

// A clean 10-record baseline with median=1000, MAD=30 -- MAD is small
// relative to the median, so modifiedZ is already far past 3.5 well before
// amountRatio reaches 2.0. Used to isolate the amountRatio boundary.
const AMOUNT_RATIO_BASELINE_AMOUNTS = [950, 960, 970, 980, 990, 1010, 1020, 1030, 1040, 1050];

// A degenerate-MAD baseline (every record identical) -- exercises the
// MEDIAN_RATIO fallback method.
const MAD_ZERO_BASELINE_AMOUNTS = new Array(10).fill(500);

describe("backend/analytics/analyzers/expenseAnomalyAnalyzer", () => {
  describe("candidate eligibility", () => {
    it("returns NO_ELIGIBLE_CURRENT_EXPENSES when there are no current-month expenses", () => {
      const result = analyze({
        currentMonthExpenses: [],
        recentExpensePool: [],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_ELIGIBLE_CURRENT_EXPENSES");
      expect(result.evaluatedExpenseCount).toBe(0);
      expect(result.flaggedCount).toBe(0);
      expect(result.anomalies).toEqual([]);
    });

    it("handles completely missing input without throwing", () => {
      expect(() => analyze({})).not.toThrow();
      expect(() => analyze()).not.toThrow();

      const result = analyze();
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_ELIGIBLE_CURRENT_EXPENSES");
    });

    it("excludes refunds (negative amounts) and zero-valued expenses from candidates", () => {
      const currentMonthExpenses = [
        makeCandidate({ _id: "refund", expenseAmount: -500 }),
        makeCandidate({ _id: "zero", expenseAmount: 0 }),
      ];

      const result = analyze({
        currentMonthExpenses,
        recentExpensePool: [],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_ELIGIBLE_CURRENT_EXPENSES");
      expect(result.evaluatedExpenseCount).toBe(0);
    });

    it("skips missing/malformed records and only counts genuinely valid candidates", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);

      const currentMonthExpenses = [
        null,
        undefined,
        42,
        "not-an-expense",
        {},
        makeCandidate({ _id: undefined }), // missing id
        makeCandidate({ _id: "" }), // blank id
        makeCandidate({ expenseCategory: "" }), // blank category
        makeCandidate({ expenseCategory: null }), // non-string category
        makeCandidate({ expenseAmount: "not-a-number" }), // non-finite amount
        makeCandidate({ expenseAmount: NaN }),
        makeCandidate({ expenseDate: "not-a-date" }), // malformed date
        makeCandidate({ expenseDate: undefined }),
        makeCandidate({ _id: "valid-candidate", expenseAmount: 600 }), // the only genuinely valid one
      ];

      const result = analyze({
        currentMonthExpenses,
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.evaluatedExpenseCount).toBe(1);
      expect(result.hasData).toBe(true);
      expect(result.reasonCode).toBeNull();
    });

    it("excludes expenses outside the analysis month even when present in currentMonthExpenses", () => {
      const currentMonthExpenses = [
        makeCandidate({ _id: "too-early", expenseDate: new Date(2026, 6, 31) }), // July 31, 2026
        makeCandidate({ _id: "too-late", expenseDate: new Date(2026, 8, 1) }), // Sep 1, 2026
        makeCandidate({ _id: "in-month", expenseDate: CURRENT_MONTH_MID }),
      ];

      const result = analyze({
        currentMonthExpenses,
        recentExpensePool: [],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.evaluatedExpenseCount).toBe(1);
    });
  });

  describe("baseline sample-size gate (no overall-user fallback)", () => {
    it("does not evaluate a category with exactly nine valid baseline records", () => {
      const recentExpensePool = makeBaselineRecords("Food", [500, 510, 490, 505, 495, 500, 500, 510, 490]);
      expect(recentExpensePool).toHaveLength(9);

      const result = analyze({
        currentMonthExpenses: [makeCandidate()],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
      expect(result.eligibleCategoryCount).toBe(0);
      expect(result.insufficientHistoryCategoryCount).toBe(1);
      expect(result.evaluatedExpenseCount).toBe(1);
    });

    it("activates the category baseline once there are exactly ten valid baseline records", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      expect(recentExpensePool).toHaveLength(10);

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })], // not extreme enough to flag
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(true);
      expect(result.reasonCode).toBeNull();
      expect(result.eligibleCategoryCount).toBe(1);
      expect(result.insufficientHistoryCategoryCount).toBe(0);
      expect(result.flaggedCount).toBe(0); // hasData:true even though nothing was flagged
    });

    // Rewritten for the category-normalization fix: case/whitespace/alias
    // variants of the SAME category are now intended to share one baseline
    // (see analytics.expenseAnomaly.test.js's "category normalization"
    // describe block below), so a "different-case category never
    // contributes" expectation would directly contradict that fix. What
    // must still hold -- and what this test now proves instead -- is that
    // there is still no overall-user or cross-CATEGORY fallback: a
    // genuinely unrelated canonical category's abundant history can never
    // satisfy a different category's insufficient baseline, no matter how
    // much of it exists in the same pool.
    it("does not fall back to an unrelated canonical category's baseline -- 'Food' stays below the minimum even with plentiful 'Rent' history in the same pool", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("Food", [500, 510, 490]), // only 3 -- below minBaselineSampleSize (10)
        ...makeBaselineRecords("Rent", MODIFIED_Z_BASELINE_AMOUNTS), // 10 -- plenty, but a different category
      ];

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Food", expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
      expect(result.eligibleCategoryCount).toBe(0);
      expect(result.insufficientHistoryCategoryCount).toBe(1);
      expect(result.flaggedCount).toBe(0);
    });

    it("never falls back to an overall-user baseline across categories", () => {
      // Plenty of total historical records, but split across categories so
      // no single category the candidate needs ever reaches ten.
      const recentExpensePool = [
        ...makeBaselineRecords("Travel", [100, 110, 120]),
        ...makeBaselineRecords("Shopping", [200, 210, 220]),
        ...makeBaselineRecords("Entertainment", [300, 310, 320, 330]),
      ];
      expect(recentExpensePool).toHaveLength(10);

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Travel", expenseAmount: 5000 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
    });

    it("when at least one candidate category has a valid baseline, hasData is true even if flaggedCount is zero", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS),
        ...makeBaselineRecords("Travel", [100, 110, 120]), // insufficient, irrelevant to the outcome
      ];

      const result = analyze({
        currentMonthExpenses: [
          makeCandidate({ _id: "food-1", expenseCategory: "Food", expenseAmount: 600 }),
          makeCandidate({ _id: "travel-1", expenseCategory: "Travel", expenseAmount: 130 }),
        ],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(true);
      expect(result.reasonCode).toBeNull();
      expect(result.eligibleCategoryCount).toBe(1);
      expect(result.insufficientHistoryCategoryCount).toBe(1);
    });
  });

  describe("12-complete-month baseline window", () => {
    it("includes a baseline record dated exactly at the window start (inclusive lower bound)", () => {
      const nineInWindow = makeBaselineRecords(
        "Food",
        [500, 510, 490, 505, 495, 500, 500, 510, 490]
      );
      const exactlyAtStart = {
        _id: "food-at-window-start",
        expenseCategory: "Food",
        expenseAmount: 500,
        expenseDate: BASELINE_START,
        expenseName: "at window start",
      };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })],
        recentExpensePool: [...nineInWindow, exactlyAtStart],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(true);
      expect(result.eligibleCategoryCount).toBe(1);
    });

    it("excludes a baseline record dated one day before the window start", () => {
      const nineInWindow = makeBaselineRecords(
        "Food",
        [500, 510, 490, 505, 495, 500, 500, 510, 490]
      );
      const oneDayTooOld = {
        _id: "food-too-old",
        expenseCategory: "Food",
        expenseAmount: 500,
        expenseDate: new Date(BASELINE_START.getTime() - 24 * 60 * 60 * 1000),
        expenseName: "too old",
      };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })],
        recentExpensePool: [...nineInWindow, oneDayTooOld],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
    });

    it("excludes current-month records from the baseline even though the pool may legitimately contain them", () => {
      const nineInWindow = makeBaselineRecords(
        "Food",
        [500, 510, 490, 505, 495, 500, 500, 510, 490]
      );
      const currentMonthPoolRecord = {
        _id: "food-current-month-in-pool",
        expenseCategory: "Food",
        expenseAmount: 500,
        expenseDate: CURRENT_MONTH_MID, // same month as the candidate
        expenseName: "should not count as baseline",
      };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })],
        recentExpensePool: [...nineInWindow, currentMonthPoolRecord],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
    });

    it("a candidate cannot contaminate its own baseline, even if duplicated into the historical pool", () => {
      const nineInWindow = makeBaselineRecords(
        "Food",
        [500, 510, 490, 505, 495, 500, 500, 510, 490]
      );
      const candidate = makeCandidate({ _id: "self-contaminate", expenseAmount: 3500 });
      // The exact same expense (same id, same category, same date) also
      // appears in the historical pool, as if a caller mistakenly passed
      // overlapping arrays.
      const duplicateOfCandidateInPool = {
        _id: candidate._id,
        expenseCategory: candidate.expenseCategory,
        expenseAmount: candidate.expenseAmount,
        expenseDate: candidate.expenseDate,
        expenseName: candidate.expenseName,
      };

      const result = analyze({
        currentMonthExpenses: [candidate],
        recentExpensePool: [...nineInWindow, duplicateOfCandidateInPool],
        currentMonthStart: CURRENT_MONTH_START,
      });

      // Still only 9 valid (pre-current-month) baseline records -- the
      // duplicate is excluded by date, not by identity.
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
    });

    it("excludes refunds from the baseline pool", () => {
      const nineInWindow = makeBaselineRecords(
        "Food",
        [500, 510, 490, 505, 495, 500, 500, 510, 490]
      );
      const refundInPool = {
        _id: "food-refund",
        expenseCategory: "Food",
        expenseAmount: -500,
        expenseDate: SAFE_BASELINE_DATE,
        expenseName: "refund",
      };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })],
        recentExpensePool: [...nineInWindow, refundInPool],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
    });
  });

  describe("modified-z detection (MAD > 0)", () => {
    // Baseline: median=500, MAD=250 -- amountRatio (>=2.0) is comfortably
    // satisfied throughout this range, isolating the modifiedZ boundary at
    // 3.5. Boundary amounts were derived from the analyzer's own formula
    // and confirmed with Node's actual double-precision arithmetic, so the
    // "at" case genuinely sits on the true >=3.5 transition.
    const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);

    it("does not flag just below the modifiedZ threshold (amount 1797.25, z < 3.5)", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 1797.25 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(0);
    });

    it("flags at the modifiedZ threshold (amount 1797.26, z >= 3.5)", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 1797.26 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].detection.method).toBe("MODIFIED_Z");
      expect(result.anomalies[0].detection.score).toBeGreaterThanOrEqual(3.5);
    });

    it("flags clearly above the modifiedZ threshold", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 1834.32 })], // z ~= 3.6
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].detection.score).toBeGreaterThan(3.5);
    });

    it("requires BOTH modifiedZ >= 3.5 AND amountRatio >= 2.0 -- a high z with a low ratio is not flagged", () => {
      // Small median, small MAD, so a modest absolute amount produces a
      // large z-score while the ratio stays under 2.0.
      const tightBaseline = makeBaselineRecords("Subscriptions", [
        95, 96, 97, 98, 99, 101, 102, 103, 104, 105,
      ]); // median=100, small MAD

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Subscriptions", expenseAmount: 150 })],
        recentExpensePool: tightBaseline,
        currentMonthStart: CURRENT_MONTH_START,
      });

      // ratio = 150/100 = 1.5, below the 2.0 floor -- must not flag no
      // matter how large the z-score is.
      expect(result.flaggedCount).toBe(0);
    });

    it("does not produce a misleading flag for a normal, low-variance change", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })], // modest increase over median 500
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(0);
    });

    it("does not flag a routine expense at the high end of an already-high-variance category", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 950 })], // the baseline's own historical max
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(0);
    });

    it("flags a genuine large spike (₹500 typical Food spend, ₹3500 actual)", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      const [anomaly] = result.anomalies;
      expect(anomaly.severity).toBe("high");
      expect(anomaly.reasonCode).toBe("CATEGORY_AMOUNT_SPIKE");
      expect(anomaly.baseline.medianAmount).toBe(500);
    });
  });

  describe("amountRatio boundary (isolated from modifiedZ)", () => {
    // Baseline: median=1000, MAD=30 -- modifiedZ is already far past 3.5
    // by the time amountRatio nears 2.0, isolating the ratio boundary.
    const recentExpensePool = makeBaselineRecords("Food", AMOUNT_RATIO_BASELINE_AMOUNTS);

    it("does not flag just below amountRatio 2.0", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 1999.99 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(0);
    });

    it("flags exactly at amountRatio 2.0", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 2000 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].detection.amountRatio).toBe(2);
    });

    it("flags just above amountRatio 2.0", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 2000.01 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
    });
  });

  describe("MAD == 0 fallback (MEDIAN_RATIO method)", () => {
    const recentExpensePool = makeBaselineRecords("Rent", MAD_ZERO_BASELINE_AMOUNTS); // median=500, MAD=0

    it("does not flag just below amountRatio 4.0", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Rent", expenseAmount: 1999.99 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(0);
    });

    it("flags exactly at amountRatio 4.0 using MEDIAN_RATIO", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Rent", expenseAmount: 2000 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].detection.method).toBe("MEDIAN_RATIO");
      expect(result.anomalies[0].detection.amountRatio).toBe(4);
      expect(result.anomalies[0].detection.score).toBe(4);
      expect(result.anomalies[0].detection.threshold).toBe(4);
    });

    it("flags just above amountRatio 4.0", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Rent", expenseAmount: 2000.01 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
    });
  });

  describe("severity boundaries", () => {
    const recentExpensePool = makeBaselineRecords("Rent", MAD_ZERO_BASELINE_AMOUNTS); // median=500, MAD=0

    it.each([
      [2000, "moderate"], // ratio=4.0 -> thresholdMultiple=1.0
      [2995, "moderate"], // ratio=5.99 -> thresholdMultiple=1.4975
      [3000, "high"], // ratio=6.0 -> thresholdMultiple=1.5
      [4995, "high"], // ratio=9.99 -> thresholdMultiple=2.4975
      [5000, "very_high"], // ratio=10.0 -> thresholdMultiple=2.5
      [10000, "very_high"], // ratio=20.0 -> thresholdMultiple=5.0
    ])("amount %d produces severity %s", (amount, expectedSeverity) => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Rent", expenseAmount: amount })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.anomalies[0].severity).toBe(expectedSeverity);
    });

    it('never uses the word "severe"', () => {
      const labels = RULES.severityTiers.map((tier) => tier.label);
      expect(labels.some((label) => label.includes("severe"))).toBe(false);
    });
  });

  describe("output contract", () => {
    it("uses the Mongo _id (stringified) as expenseId, not a client-supplied id field", () => {
      const objectIdLike = { toString: () => "64f1a2b3c4d5e6f7a8b9c0d1" };
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ _id: objectIdLike, expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.anomalies[0].expenseId).toBe("64f1a2b3c4d5e6f7a8b9c0d1");
      expect(typeof result.anomalies[0].expenseId).toBe("string");
    });

    it("includes no sensitive, client-supplied, or unrelated fields on an anomaly record", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      const [anomaly] = result.anomalies;

      expect(Object.keys(anomaly).sort()).toEqual(
        [
          "expenseId",
          "expenseName",
          "category",
          "amount",
          "expenseDate",
          "severity",
          "reasonCode",
          "baseline",
          "detection",
        ].sort()
      );
      expect(Object.keys(anomaly.baseline).sort()).toEqual(["scope", "sampleCount", "medianAmount"].sort());
      expect(Object.keys(anomaly.detection).sort()).toEqual(
        ["method", "score", "threshold", "thresholdMultiple", "amountRatio"].sort()
      );

      // Explicitly forbidden by the frozen contract.
      expect(anomaly).not.toHaveProperty("userId");
      expect(anomaly).not.toHaveProperty("id");
      expect(anomaly).not.toHaveProperty("description");
      expect(anomaly).not.toHaveProperty("mlPredictedCategory");
      expect(anomaly).not.toHaveProperty("mlConfidence");
      expect(anomaly.baseline).not.toHaveProperty("typicalRange");
      expect(anomaly.baseline).not.toHaveProperty("expenses");
      expect(result).not.toHaveProperty("skipped");
    });

    it("never presents the score as a probability (score can exceed 1)", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 10000 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.anomalies[0].detection.score).toBeGreaterThan(1);
    });

    it("returns the NO_ELIGIBLE_CURRENT_EXPENSES shape exactly", () => {
      const result = analyze({
        currentMonthExpenses: [],
        recentExpensePool: [],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result).toEqual({
        hasData: false,
        reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES",
        baselineWindow: {
          months: 12,
          start: BASELINE_START.toISOString(),
          endExclusive: CURRENT_MONTH_START.toISOString(),
        },
        evaluatedExpenseCount: 0,
        eligibleCategoryCount: 0,
        insufficientHistoryCategoryCount: 0,
        flaggedCount: 0,
        anomalies: [],
      });
    });

    it("returns the NO_BASELINE_YET shape exactly", () => {
      const result = analyze({
        currentMonthExpenses: [makeCandidate()],
        recentExpensePool: makeBaselineRecords("Food", [500, 500, 500]),
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result).toEqual({
        hasData: false,
        reasonCode: "NO_BASELINE_YET",
        baselineWindow: {
          months: 12,
          start: BASELINE_START.toISOString(),
          endExclusive: CURRENT_MONTH_START.toISOString(),
        },
        evaluatedExpenseCount: 1,
        eligibleCategoryCount: 0,
        insufficientHistoryCategoryCount: 1,
        flaggedCount: 0,
        anomalies: [],
      });
    });
  });

  describe("ordering and the ten-result cap", () => {
    // Twelve distinct, all-flagged candidates in one eligible category, each
    // producing a strictly distinct thresholdMultiple so ranking is
    // unambiguous.
    const recentExpensePool = makeBaselineRecords("Food", MAD_ZERO_BASELINE_AMOUNTS); // median=500, MAD=0

    const buildTwelveFlagged = () =>
      Array.from({ length: 12 }, (_, i) => {
        // amount = 500 * (4 + i * 0.5) -> strictly increasing thresholdMultiple
        const amount = 500 * (4 + i * 0.5);
        return makeCandidate({
          _id: `flagged-${i}`,
          expenseCategory: "Food",
          expenseAmount: amount,
          expenseDate: new Date(2026, 7, 2 + i),
        });
      });

    it("returns at most ten anomalies, ranked by thresholdMultiple descending", () => {
      const result = analyze({
        currentMonthExpenses: buildTwelveFlagged(),
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(10);
      expect(result.anomalies).toHaveLength(10);

      // The two lowest-ratio candidates (flagged-0, flagged-1) must be
      // excluded by the cap.
      const ids = result.anomalies.map((a) => a.expenseId);
      expect(ids).not.toContain("flagged-0");
      expect(ids).not.toContain("flagged-1");
      expect(ids).toContain("flagged-11");

      const multiples = result.anomalies.map((a) => a.detection.thresholdMultiple);
      const sorted = [...multiples].sort((a, b) => b - a);
      expect(multiples).toEqual(sorted);
    });

    it("breaks ties by amount descending, then expenseDate descending, then expenseId lexicographically", () => {
      // Two candidates with an identical thresholdMultiple (same amount,
      // same category/baseline) but different dates and ids.
      const tiedAmount = 2500; // ratio = 5.0 for both
      const currentMonthExpenses = [
        makeCandidate({
          _id: "z-later-date",
          expenseCategory: "Food",
          expenseAmount: tiedAmount,
          expenseDate: new Date(2026, 7, 20),
        }),
        makeCandidate({
          _id: "a-earlier-date",
          expenseCategory: "Food",
          expenseAmount: tiedAmount,
          expenseDate: new Date(2026, 7, 5),
        }),
      ];

      const result = analyze({
        currentMonthExpenses,
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.anomalies.map((a) => a.expenseId)).toEqual(["z-later-date", "a-earlier-date"]);
    });

    it("breaks a full tie (same multiple, amount, and date) by expenseId lexicographic order", () => {
      const sameDate = new Date(2026, 7, 10);
      const currentMonthExpenses = [
        makeCandidate({ _id: "id-b", expenseCategory: "Food", expenseAmount: 2500, expenseDate: sameDate }),
        makeCandidate({ _id: "id-a", expenseCategory: "Food", expenseAmount: 2500, expenseDate: sameDate }),
      ];

      const result = analyze({
        currentMonthExpenses,
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.anomalies.map((a) => a.expenseId)).toEqual(["id-a", "id-b"]);
    });

    it("is independent of input array order", () => {
      const currentMonthExpenses = buildTwelveFlagged();
      const reversedExpenses = [...currentMonthExpenses].reverse();
      const reversedPool = [...recentExpensePool].reverse();

      const resultA = analyze({
        currentMonthExpenses,
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });
      const resultB = analyze({
        currentMonthExpenses: reversedExpenses,
        recentExpensePool: reversedPool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(resultB).toEqual(resultA);
    });
  });

  describe("determinism and purity", () => {
    it("repeated calls with the same input return equal results", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const input = {
        currentMonthExpenses: [makeCandidate({ expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      };

      const first = analyze(input);
      const second = analyze(input);

      expect(second).toEqual(first);
    });

    it("never mutates its inputs", () => {
      const currentMonthExpenses = Object.freeze([
        Object.freeze(makeCandidate({ expenseAmount: 3500 })),
      ]);
      const recentExpensePool = Object.freeze(
        makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS).map((record) => Object.freeze(record))
      );

      expect(() =>
        analyze({
          currentMonthExpenses,
          recentExpensePool,
          currentMonthStart: CURRENT_MONTH_START,
        })
      ).not.toThrow();
    });

    it("performs no database, Redis, network, filesystem, ML-service, or SIA calls (static source check)", () => {
      const analyzerSource = fs.readFileSync(
        path.join(__dirname, "../analytics/analyzers/expenseAnomalyAnalyzer.js"),
        "utf8"
      );
      const rulesSource = fs.readFileSync(
        path.join(__dirname, "../analytics/analyzers/scores/expenseAnomalyRules.js"),
        "utf8"
      );

      const forbiddenPatterns = [
        /require\(\s*["']mongoose["']\s*\)/,
        /require\(\s*["'](\.\.\/)*models\//,
        /require\(\s*["'](\.\.\/)*cache\//,
        /require\(\s*["'](\.\.\/)*config\/redis["']\s*\)/,
        /require\(\s*["']redis["']\s*\)/,
        /require\(\s*["']axios["']\s*\)/,
        /require\(\s*["']http["']\s*\)/,
        /require\(\s*["']https["']\s*\)/,
        /require\(\s*["']fs["']\s*\)/,
        /require\(\s*["'](\.\.\/)*sia\//,
        /fetch\(/,
      ];

      for (const pattern of forbiddenPatterns) {
        expect(analyzerSource).not.toMatch(pattern);
        expect(rulesSource).not.toMatch(pattern);
      }
    });
  });

  // Phase 1 remediation: coverage added for the accepted code-review
  // findings (safe amount coercion, safe identifier serialization, and the
  // frozen rules contract). All tests above this point are unmodified.
  describe("remediation: safe amount coercion", () => {
    it("skips a candidate whose amount is a Symbol instead of crashing (Number(Symbol) throws)", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const currentMonthExpenses = [
        makeCandidate({ _id: "symbol-amount", expenseAmount: Symbol("amount") }),
        makeCandidate({ _id: "valid", expenseAmount: 600 }),
      ];

      expect(() =>
        analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START })
      ).not.toThrow();

      const result = analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START });
      expect(result.evaluatedExpenseCount).toBe(1);
    });

    it("skips a candidate whose amount is a null-prototype object with no usable valueOf/toString", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const currentMonthExpenses = [
        makeCandidate({ _id: "null-proto-amount", expenseAmount: Object.create(null) }),
        makeCandidate({ _id: "valid", expenseAmount: 600 }),
      ];

      expect(() =>
        analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START })
      ).not.toThrow();

      const result = analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START });
      expect(result.evaluatedExpenseCount).toBe(1);
    });

    it("skips a candidate whose amount throws from valueOf/toString instead of crashing analyze()", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const throwingAmount = {
        valueOf() {
          throw new Error("boom");
        },
        toString() {
          throw new Error("boom");
        },
      };
      const currentMonthExpenses = [
        makeCandidate({ _id: "throwing-amount", expenseAmount: throwingAmount }),
        makeCandidate({ _id: "valid", expenseAmount: 600 }),
      ];

      expect(() =>
        analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START })
      ).not.toThrow();

      const result = analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START });
      expect(result.evaluatedExpenseCount).toBe(1);
    });

    it("skips a baseline record whose amount is uncoercible instead of crashing or corrupting the baseline", () => {
      const goodBaseline = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS.slice(0, 9));
      const uncoercibleBaseline = {
        _id: "food-baseline-bad",
        expenseCategory: "Food",
        expenseAmount: Object.create(null),
        expenseDate: SAFE_BASELINE_DATE,
        expenseName: "bad baseline amount",
      };
      // Only 9 valid baseline records once the uncoercible one is excluded --
      // below the sample-size gate, proving it was not silently counted.
      expect(goodBaseline).toHaveLength(9);

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })],
        recentExpensePool: [...goodBaseline, uncoercibleBaseline],
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
      expect(result.insufficientHistoryCategoryCount).toBe(1);
    });
  });

  describe("remediation: safe identifier serialization", () => {
    it("skips a candidate with an uncoercible (null-prototype) _id instead of crashing", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const currentMonthExpenses = [
        makeCandidate({ _id: Object.create(null) }),
        makeCandidate({ _id: "valid", expenseAmount: 600 }),
      ];

      expect(() =>
        analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START })
      ).not.toThrow();

      const result = analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START });
      expect(result.evaluatedExpenseCount).toBe(1);
    });

    it("skips a candidate whose _id.toString() throws instead of crashing analyze()", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const throwingId = {
        toString() {
          throw new Error("boom");
        },
      };
      const currentMonthExpenses = [
        makeCandidate({ _id: throwingId }),
        makeCandidate({ _id: "valid", expenseAmount: 600 }),
      ];

      expect(() =>
        analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START })
      ).not.toThrow();

      const result = analyze({ currentMonthExpenses, recentExpensePool, currentMonthStart: CURRENT_MONTH_START });
      expect(result.evaluatedExpenseCount).toBe(1);
    });

    it("coerces a stateful _id.toString() exactly once and reuses that single result as expenseId", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      let calls = 0;
      const statefulId = {
        toString() {
          calls += 1;
          return `id-call-${calls}`;
        },
      };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ _id: statefulId, expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      // If coercion happened more than once, the id would either be
      // "id-call-2"+ or the calls counter would exceed 1.
      expect(calls).toBe(1);
      expect(result.anomalies[0].expenseId).toBe("id-call-1");
    });

    it("never exposes the original _id object on the output, only the serialized string", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const objectIdLike = { toString: () => "64f1a2b3c4d5e6f7a8b9c0d1" };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ _id: objectIdLike, expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.anomalies[0].expenseId).toBe("64f1a2b3c4d5e6f7a8b9c0d1");
      expect(result.anomalies[0].expenseId).not.toBe(objectIdLike);
      expect(typeof result.anomalies[0].expenseId).toBe("string");
    });
  });

  describe("remediation: prototype-pollution-shaped category names", () => {
    // Updated for the shared normalizer's own prototype-pollution fix
    // (utils/categoryNormalization.js's CATEGORY_ALIASES is now a
    // null-prototype lookup): the analyzer's `category` output is the
    // CANONICAL grouping value, not a raw pass-through, so a prototype-
    // shaped input no longer necessarily round-trips to its own original
    // spelling -- exactly the same "unknown category -> Title-Cased
    // display string" fallback every other unknown category already goes
    // through (see categoryNormalization.test.js's own dedicated
    // prototype-pollution suite for the normalizer-level proof). Expected
    // values are hardcoded literals here, not computed by calling the
    // production normalizer inside the assertion.
    it.each([
      ["__proto__", "__proto__"],
      ["constructor", "Constructor"],
      ["hasOwnProperty", "Hasownproperty"],
    ])(
      'treats "%s" as an ordinary category string, normalized to its canonical "%s" form and isolated from other categories',
      (category, expectedCanonicalCategory) => {
        const recentExpensePool = makeBaselineRecords(category, MODIFIED_Z_BASELINE_AMOUNTS);

        const result = analyze({
          currentMonthExpenses: [makeCandidate({ expenseCategory: category, expenseAmount: 3500 })],
          recentExpensePool,
          currentMonthStart: CURRENT_MONTH_START,
        });

        expect(result.hasData).toBe(true);
        expect(result.flaggedCount).toBe(1);
        expect(typeof result.anomalies[0].category).toBe("string");
        expect(result.anomalies[0].category).toBe(expectedCanonicalCategory);
        // Confirms no leakage into/from Object.prototype internals: an
        // unrelated category must still be evaluated independently, and
        // Object.prototype itself is never touched by analysis.
        expect(Object.prototype.toString.call({})).toBe("[object Object]");
      }
    );

    it("does not let a baseline in one reserved-word category leak into another", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("__proto__", MODIFIED_Z_BASELINE_AMOUNTS),
        // Only 3 records for "constructor" -- must remain insufficient.
        ...makeBaselineRecords("constructor", [100, 110, 120]),
      ];

      const result = analyze({
        currentMonthExpenses: [
          makeCandidate({ _id: "c1", expenseCategory: "constructor", expenseAmount: 5000 }),
        ],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
    });
  });

  describe("remediation: sort order uses the unrounded thresholdMultiple, not the rounded public field", () => {
    it("orders two candidates from different categories correctly even though their public (rounded) thresholdMultiple values tie", () => {
      // Category A: median=500 (MAD=0), amount=4001 -> raw thresholdMultiple
      // = 4001/500/4 = 2.0005, which rounds (round2) to the same public
      // value as category B below.
      const categoryA = "RemediationA";
      const amountA = 4001;

      // Category B: median=100 (MAD=0), amount=800.5 -> raw thresholdMultiple
      // = 800.5/100/4 = 2.00125. This is numerically greater than A's raw
      // 2.0005, so B must sort ahead of A -- even though B's raw amount
      // (800.5) is far smaller than A's (4001), and even though both
      // candidates' public detection.thresholdMultiple round to the same
      // displayed value. This proves the sort key is the true unrounded
      // thresholdMultiple, not the rounded field also present on the output,
      // and that it is not simply following amount order.
      const categoryB = "RemediationB";
      const amountB = 800.5;

      const recentExpensePool = [
        ...makeBaselineRecords(categoryA, MAD_ZERO_BASELINE_AMOUNTS), // median 500
        ...makeBaselineRecords(categoryB, new Array(10).fill(100)), // median 100
      ];

      const currentMonthExpenses = [
        makeCandidate({ _id: "candidate-a", expenseCategory: categoryA, expenseAmount: amountA }),
        makeCandidate({ _id: "candidate-b", expenseCategory: categoryB, expenseAmount: amountB }),
      ];

      const result = analyze({
        currentMonthExpenses,
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(2);
      // Both display the same rounded public thresholdMultiple...
      expect(result.anomalies[0].detection.thresholdMultiple).toBe(2);
      expect(result.anomalies[1].detection.thresholdMultiple).toBe(2);
      // ...but B (the true higher raw multiple) must be ranked first, ahead
      // of A, and specifically not in raw-amount order (A's raw amount is
      // larger).
      expect(result.anomalies.map((a) => a.expenseId)).toEqual(["candidate-b", "candidate-a"]);
    });
  });

  describe("remediation: baseline window boundary via a record exactly at currentMonthStart", () => {
    it("excludes a baseline-shaped record dated exactly at currentMonthStart (it belongs to the candidate month, not the baseline)", () => {
      const nineInWindow = makeBaselineRecords(
        "Food",
        [500, 510, 490, 505, 495, 500, 500, 510, 490]
      );
      const exactlyAtMonthStart = {
        _id: "food-at-current-month-start",
        expenseCategory: "Food",
        expenseAmount: 500,
        expenseDate: CURRENT_MONTH_START, // the exclusive upper bound of the baseline window
        expenseName: "at current month start",
      };

      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 600 })],
        recentExpensePool: [...nineInWindow, exactlyAtMonthStart],
        currentMonthStart: CURRENT_MONTH_START,
      });

      // Still only 9 valid baseline records -- the record at currentMonthStart
      // itself must not count toward the baseline.
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BASELINE_YET");
      expect(result.insufficientHistoryCategoryCount).toBe(1);
    });
  });

  describe("remediation: frozen rules contract", () => {
    it("is deeply frozen at every nesting level", () => {
      expect(Object.isFrozen(RULES)).toBe(true);
      expect(Object.isFrozen(RULES.modifiedZ)).toBe(true);
      expect(Object.isFrozen(RULES.medianRatio)).toBe(true);
      expect(Object.isFrozen(RULES.severityTiers)).toBe(true);
      for (const tier of RULES.severityTiers) {
        expect(Object.isFrozen(tier)).toBe(true);
      }

      // The module's root export object is frozen too.
      const rulesModule = require("../analytics/analyzers/scores/expenseAnomalyRules");
      expect(Object.isFrozen(rulesModule)).toBe(true);
    });

    it("silently ignores (non-strict mode) or rejects attempted mutation without altering later analyzer results", () => {
      const before = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 3500 })],
        recentExpensePool: makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS),
        currentMonthStart: CURRENT_MONTH_START,
      });

      // Attempt to corrupt a frozen threshold and a frozen severity label.
      try {
        RULES.modifiedZ.threshold = 0;
      } catch {
        // A frozen object throws in strict mode -- either outcome is fine,
        // the mutation must not take effect either way.
      }
      try {
        RULES.severityTiers[0].label = "corrupted";
      } catch {
        // ignore
      }
      try {
        RULES.maxAnomalies = 999;
      } catch {
        // ignore
      }

      expect(RULES.modifiedZ.threshold).toBe(3.5);
      expect(RULES.severityTiers[0].label).toBe("moderate");
      expect(RULES.maxAnomalies).toBe(10);

      const after = analyze({
        currentMonthExpenses: [makeCandidate({ expenseAmount: 3500 })],
        recentExpensePool: makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS),
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(after).toEqual(before);
    });
  });

  // Category normalization fix: candidate and historical-baseline categories
  // now both go through utils/categoryNormalization.js's
  // normalizeCategoryForGrouping() -- the same shared utility
  // forecastInputAggregator.js already uses -- instead of an exact raw
  // string comparison. All tests above this point are unmodified.
  describe("category normalization (candidate + baseline)", () => {
    it("1. merges case-variant categories ('Food'/'food'/'FOOD') into one baseline", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("Food", [50, 150, 250, 350, 450]),
        ...makeBaselineRecords("food", [550, 650, 750, 850, 950]),
      ];
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "FOOD", expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.eligibleCategoryCount).toBe(1);
      expect(result.insufficientHistoryCategoryCount).toBe(0);
      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].baseline.sampleCount).toBe(10);
      expect(result.anomalies[0].baseline.medianAmount).toBe(500);
      expect(result.anomalies[0].category).toBe("Food");
    });

    it("2. merges leading/trailing-whitespace-variant categories into one baseline", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("Food", [50, 150, 250, 350, 450]),
        ...makeBaselineRecords("  Food  ", [550, 650, 750, 850, 950]),
      ];
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: " Food ", expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.eligibleCategoryCount).toBe(1);
      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].baseline.sampleCount).toBe(10);
      expect(result.anomalies[0].category).toBe("Food");
    });

    it("3. merges a real configured alias pair ('medical'/'Health'/'healthcare') into one canonical 'Health' baseline", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("medical", [50, 150, 250, 350, 450]),
        ...makeBaselineRecords("Health", [550, 650, 750, 850, 950]),
      ];
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "healthcare", expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.eligibleCategoryCount).toBe(1);
      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].baseline.sampleCount).toBe(10);
      expect(result.anomalies[0].category).toBe("Health");
    });

    it("4. individually-fragmented groups (5 + 5, each below the 10-record minimum alone) combine to satisfy minBaselineSampleSize", () => {
      const fragmentA = makeBaselineRecords("Food", [50, 150, 250, 350, 450]);
      const fragmentB = makeBaselineRecords("food", [550, 650, 750, 850, 950]);

      // A lone 5-record fragment is genuinely insufficient on its own --
      // this is not a normalization question, just the existing
      // minBaselineSampleSize gate, asserted here as the baseline this test
      // then shows the MERGE overcomes.
      const loneFragment = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Food", expenseAmount: 3500 })],
        recentExpensePool: fragmentA,
        currentMonthStart: CURRENT_MONTH_START,
      });
      expect(loneFragment.reasonCode).toBe("NO_BASELINE_YET");
      expect(loneFragment.insufficientHistoryCategoryCount).toBe(1);

      const merged = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Food", expenseAmount: 3500 })],
        recentExpensePool: [...fragmentA, ...fragmentB],
        currentMonthStart: CURRENT_MONTH_START,
      });
      expect(merged.hasData).toBe(true);
      expect(merged.eligibleCategoryCount).toBe(1);
      expect(merged.insufficientHistoryCategoryCount).toBe(0);
    });

    it("5. the combined baseline correctly flags a qualifying current-month expense", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("Food", [50, 150, 250, 350, 450]),
        ...makeBaselineRecords("food", [550, 650, 750, 850, 950]),
      ];
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "FOOD", expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].detection.method).toBe("MODIFIED_Z");
      expect(result.anomalies[0].severity).toBe("high");
    });

    it("6. both candidate-side and historical-side variants are independently normalized (mismatched casing on each side still merges)", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("FOOD", [50, 150, 250, 350, 450]), // historical side: all-caps
        ...makeBaselineRecords("Food", [550, 650, 750, 850, 950]), // historical side: canonical
      ];
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "food", expenseAmount: 3500 })], // candidate side: lowercase
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].baseline.sampleCount).toBe(10);
    });

    it("7. unrelated canonical categories remain isolated after normalization", () => {
      const recentExpensePool = [
        ...makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS),
        ...makeBaselineRecords("Rent", MAD_ZERO_BASELINE_AMOUNTS),
      ];
      // One candidate per category (categoryStats is only ever computed for
      // categories a current-month candidate actually needs), each using
      // lowercase/uppercase input on the candidate side to prove
      // normalization still resolves each to its OWN distinct canonical
      // category rather than merging them together.
      const result = analyze({
        currentMonthExpenses: [
          makeCandidate({ _id: "food-candidate", expenseCategory: "food", expenseAmount: 3500 }),
          makeCandidate({ _id: "rent-candidate", expenseCategory: "RENT", expenseAmount: 2000, expenseDate: new Date(2026, 7, 16) }),
        ],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      // Both Food and Rent independently reach the baseline minimum --
      // normalization never merges genuinely different canonical categories.
      expect(result.eligibleCategoryCount).toBe(2);
      expect(result.flaggedCount).toBe(2);
      const byCategory = Object.fromEntries(result.anomalies.map((a) => [a.category, a]));
      expect(byCategory.Food.baseline.sampleCount).toBe(10); // not 20 -- Rent never leaks into Food's baseline
      expect(byCategory.Rent.baseline.sampleCount).toBe(10); // not 20 -- Food never leaks into Rent's baseline
    });

    it("8. already-canonical input produces the same result the analyzer produced before this fix", () => {
      const recentExpensePool = makeBaselineRecords("Food", MODIFIED_Z_BASELINE_AMOUNTS);
      const result = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "Food", expenseAmount: 3500 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });

      // Identical to the pre-existing "candidate eligibility"/output-contract
      // assertions elsewhere in this file for the same canonical input --
      // the fix changes nothing when the input was already canonical.
      expect(result.hasData).toBe(true);
      expect(result.flaggedCount).toBe(1);
      expect(result.anomalies[0].category).toBe("Food");
      expect(result.anomalies[0].baseline.sampleCount).toBe(10);
      expect(result.anomalies[0].baseline.medianAmount).toBe(500);
    });

    it("9. threshold boundary, MAD-zero fallback, severity, and flag/no-flag behaviour are unchanged when routed through normalization", () => {
      // Reuses the exact MAD==0 fixture and boundary values from the
      // "MAD == 0 fallback" / "severity boundaries" describe blocks above,
      // now with lowercase historical input and an all-caps candidate, to
      // prove the fix changes nothing about the surrounding rules.
      const recentExpensePool = makeBaselineRecords("rent", MAD_ZERO_BASELINE_AMOUNTS);

      const atThreshold = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "RENT", expenseAmount: 2000 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });
      expect(atThreshold.anomalies[0].detection.method).toBe("MEDIAN_RATIO");
      expect(atThreshold.anomalies[0].detection.amountRatio).toBe(4);
      expect(atThreshold.anomalies[0].severity).toBe("moderate");

      const belowThreshold = analyze({
        currentMonthExpenses: [makeCandidate({ expenseCategory: "RENT", expenseAmount: 1999.99 })],
        recentExpensePool,
        currentMonthStart: CURRENT_MONTH_START,
      });
      expect(belowThreshold.flaggedCount).toBe(0);
    });
  });
});
