// OCR-005-T06 -- Services/ReceiptServices/duplicateDecisionAudit.js.
// No live production traffic reaches this sandbox, so this suite proves
// the measurement math (computeDuplicateDecisionRates) against synthetic
// fixtures, and proves emitDuplicateDecisionEvent logs the right
// structured shape with identity fields hashed -- same approach
// tests/auth.recoverySecurity.test.js uses for emitAuthAuditEvent.
"use strict";

const {
  emitDuplicateDecisionEvent,
  computeDuplicateDecisionRates,
} = require("../Services/ReceiptServices/duplicateDecisionAudit");

describe("computeDuplicateDecisionRates", () => {
  test("empty input never divides by zero", () => {
    expect(computeDuplicateDecisionRates([])).toEqual({
      totalDecisions: 0,
      overrideRate: 0,
      exactMatchOverrideRate: 0,
    });
  });

  test("a mixed batch computes a hand-verified rate", () => {
    const events = [
      { decision: "confirmed_new", matchedReasonCode: "EXACT_FILE_MATCH" },
      { decision: "linked_existing", matchedReasonCode: "EXACT_FILE_MATCH" },
      { decision: "linked_existing", matchedReasonCode: "PROBABLE_MERCHANT_DATE_AMOUNT" },
      { decision: "confirmed_new", matchedReasonCode: "PROBABLE_MERCHANT_DATE_AMOUNT" },
    ];
    // overrideRate: 2 confirmed_new out of 4 total decisions = 0.5
    // exactMatchOverrideRate: 1 confirmed_new out of 2 EXACT_FILE_MATCH decisions = 0.5
    expect(computeDuplicateDecisionRates(events)).toEqual({
      totalDecisions: 4,
      overrideRate: 0.5,
      exactMatchOverrideRate: 0.5,
    });
  });

  test("all linked_existing -> overrideRate is 0", () => {
    const events = [
      { decision: "linked_existing", matchedReasonCode: "EXACT_FILE_MATCH" },
      { decision: "linked_existing", matchedReasonCode: null },
    ];
    expect(computeDuplicateDecisionRates(events).overrideRate).toBe(0);
  });

  test("all confirmed_new -> overrideRate is 1", () => {
    const events = [
      { decision: "confirmed_new", matchedReasonCode: null },
      { decision: "confirmed_new", matchedReasonCode: "PROBABLE_MERCHANT_DATE_AMOUNT" },
    ];
    expect(computeDuplicateDecisionRates(events).overrideRate).toBe(1);
  });

  test("no EXACT_FILE_MATCH events present -> exactMatchOverrideRate is 0, not NaN", () => {
    const events = [
      { decision: "confirmed_new", matchedReasonCode: "PROBABLE_MERCHANT_DATE_AMOUNT" },
      { decision: "linked_existing", matchedReasonCode: null },
    ];
    const result = computeDuplicateDecisionRates(events);
    expect(result.exactMatchOverrideRate).toBe(0);
    expect(Number.isNaN(result.exactMatchOverrideRate)).toBe(false);
  });

  test("an EXACT_FILE_MATCH correctly caught (linked_existing) mixed with one overridden (confirmed_new) -> exactMatchOverrideRate is 0.5", () => {
    const events = [
      { decision: "linked_existing", matchedReasonCode: "EXACT_FILE_MATCH" },
      { decision: "confirmed_new", matchedReasonCode: "EXACT_FILE_MATCH" },
    ];
    expect(computeDuplicateDecisionRates(events).exactMatchOverrideRate).toBe(0.5);
  });
});

describe("emitDuplicateDecisionEvent", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "duplicate-decision-audit-test-secret";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("logs a structured event with the right type/featureId/decision/matchedReasonCode", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    const req = { userId: "user-123", get: () => "req-abc" };

    emitDuplicateDecisionEvent({
      req,
      receiptId: "receipt-456",
      decision: "confirmed_new",
      matchedReasonCode: "EXACT_FILE_MATCH",
    });

    expect(info).toHaveBeenCalledTimes(1);
    const event = JSON.parse(info.mock.calls[0][0]);
    expect(event.type).toBe("duplicate_decision_event");
    expect(event.featureId).toBe("OCR-005");
    expect(event.decision).toBe("confirmed_new");
    expect(event.matchedReasonCode).toBe("EXACT_FILE_MATCH");
    expect(event.requestId).toBe("req-abc");
    expect(typeof event.occurredAt).toBe("string");
    expect(new Date(event.occurredAt).toISOString()).toBe(event.occurredAt);
  });

  test("hashes userId and receiptId rather than logging them raw", () => {
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    const req = { userId: "user-123" };

    emitDuplicateDecisionEvent({
      req,
      receiptId: "receipt-456",
      decision: "linked_existing",
      matchedReasonCode: null,
    });

    const serialized = info.mock.calls[0][0];
    const event = JSON.parse(serialized);

    expect(serialized).not.toContain("user-123");
    expect(serialized).not.toContain("receipt-456");
    expect(event.userHash).toBeDefined();
    expect(event.userHash).not.toBe("user-123");
    expect(event.receiptIdHash).toBeDefined();
    expect(event.receiptIdHash).not.toBe("receipt-456");
    expect(event.userHash).toMatch(/^[a-f0-9]{24}$/);
    expect(event.receiptIdHash).toMatch(/^[a-f0-9]{24}$/);
  });
});
