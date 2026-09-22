// OCR-004-T07 -- unit tests for utils/receiptLifecycle.js's pure
// functions. These are real, un-mocked calls against the actual module --
// no DB, no network -- so this suite is the single place that pins down
// the RULE every other OCR-004 module (the cron, the schema, the ingest
// service) is built against. If this rule ever drifts, this file is meant
// to be the one that catches it first.
"use strict";

const {
  RECEIPT_REVIEW_STATUSES,
  RECEIPT_UNLINKED_RETENTION_DAYS,
  deriveInitialReviewStatus,
  isEligibleForRetentionSweep,
} = require("../utils/receiptLifecycle");

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = RECEIPT_UNLINKED_RETENTION_DAYS * DAY_MS;

describe("deriveInitialReviewStatus", () => {
  test("needsReview: true -> NEEDS_REVIEW", () => {
    expect(deriveInitialReviewStatus({ needsReview: true })).toBe(
      RECEIPT_REVIEW_STATUSES.NEEDS_REVIEW
    );
  });

  test("needsReview: false -> REVIEWED", () => {
    expect(deriveInitialReviewStatus({ needsReview: false })).toBe(
      RECEIPT_REVIEW_STATUSES.REVIEWED
    );
  });

  test("a falsy/missing parsedReceipt is treated as not needing review (defensive default)", () => {
    expect(deriveInitialReviewStatus(null)).toBe(RECEIPT_REVIEW_STATUSES.REVIEWED);
    expect(deriveInitialReviewStatus(undefined)).toBe(RECEIPT_REVIEW_STATUSES.REVIEWED);
    expect(deriveInitialReviewStatus({})).toBe(RECEIPT_REVIEW_STATUSES.REVIEWED);
  });
});

describe("isEligibleForRetentionSweep", () => {
  const now = new Date("2026-09-21T00:00:00.000Z");

  test("unlinked and well past the retention window -> eligible", () => {
    const receipt = {
      linkedExpenseId: null,
      uploadedAt: new Date(now.getTime() - RETENTION_MS - DAY_MS),
    };
    expect(isEligibleForRetentionSweep(receipt, now)).toBe(true);
  });

  test("unlinked but well within the retention window -> not eligible", () => {
    const receipt = {
      linkedExpenseId: null,
      uploadedAt: new Date(now.getTime() - DAY_MS),
    };
    expect(isEligibleForRetentionSweep(receipt, now)).toBe(false);
  });

  test("linkedExpenseId undefined is treated the same as null (still unlinked)", () => {
    const receipt = {
      uploadedAt: new Date(now.getTime() - RETENTION_MS - DAY_MS),
    };
    expect(isEligibleForRetentionSweep(receipt, now)).toBe(true);
  });

  test("linked, however old -- NEVER eligible, regardless of age", () => {
    const linkedButAncient = {
      linkedExpenseId: "expense-1",
      uploadedAt: new Date(now.getTime() - RETENTION_MS * 10),
    };
    expect(isEligibleForRetentionSweep(linkedButAncient, now)).toBe(false);
  });

  test("linked receipt exactly at the retention boundary -- still never eligible", () => {
    const linkedAtBoundary = {
      linkedExpenseId: "expense-1",
      uploadedAt: new Date(now.getTime() - RETENTION_MS),
    };
    expect(isEligibleForRetentionSweep(linkedAtBoundary, now)).toBe(false);
  });

  test("no uploadedAt -- never eligible, even if unlinked", () => {
    expect(isEligibleForRetentionSweep({ linkedExpenseId: null }, now)).toBe(false);
    expect(
      isEligibleForRetentionSweep({ linkedExpenseId: null, uploadedAt: null }, now)
    ).toBe(false);
    expect(
      isEligibleForRetentionSweep({ linkedExpenseId: null, uploadedAt: undefined }, now)
    ).toBe(false);
  });

  test("a falsy receipt is never eligible", () => {
    expect(isEligibleForRetentionSweep(null, now)).toBe(false);
    expect(isEligibleForRetentionSweep(undefined, now)).toBe(false);
  });

  describe("boundary conditions at exactly the 90-day cutoff", () => {
    test("uploadedAt exactly RECEIPT_UNLINKED_RETENTION_DAYS ago (age === retention) -> NOT eligible (age must be strictly greater)", () => {
      const receipt = {
        linkedExpenseId: null,
        uploadedAt: new Date(now.getTime() - RETENTION_MS),
      };
      expect(isEligibleForRetentionSweep(receipt, now)).toBe(false);
    });

    test("uploadedAt one millisecond older than the cutoff (age > retention by 1ms) -> eligible", () => {
      const receipt = {
        linkedExpenseId: null,
        uploadedAt: new Date(now.getTime() - RETENTION_MS - 1),
      };
      expect(isEligibleForRetentionSweep(receipt, now)).toBe(true);
    });

    test("uploadedAt one millisecond younger than the cutoff (age < retention by 1ms) -> not eligible", () => {
      const receipt = {
        linkedExpenseId: null,
        uploadedAt: new Date(now.getTime() - RETENTION_MS + 1),
      };
      expect(isEligibleForRetentionSweep(receipt, now)).toBe(false);
    });
  });
});
