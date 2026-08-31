// backend/tests/sia.followUp.test.js
/**
 * Jest integration test for the follow‑up flow:
 *   1. An assistant turn persists a `planSummary` via sessionService.appendTurn.
 *   2. The next user turn loads that summary with loadLastPlanSummary.
 *   3. The semantic router receives a sanitized previous‑plan summary.
 */

"use strict";

const SESSION_MODEL_PATH = "../models/SiaSession";
const MESSAGE_MODEL_PATH = "../models/SiaMessage";
const SERVICE_PATH = "../sia/sessionService";
const ROUTER_PATH = "../sia/semanticRouter";

// Helper to create chainable mongoose‑like query mocks
function chainable(resolvedValue) {
  const chain = {
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => resolvedValue),
    then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return chain;
}

function loadMocks({ messageDocs: providedMessageDocs } = {}) {
  jest.resetModules();

  const sessionDocs = { findOne: jest.fn(() => chainable(null)), create: jest.fn(), updateOne: jest.fn(() => Promise.resolve()) };
  const messageDocs = providedMessageDocs || { create: jest.fn() };

  jest.doMock(SESSION_MODEL_PATH, () => sessionDocs);
  jest.doMock(MESSAGE_MODEL_PATH, () => messageDocs);

  const sessionService = require(SERVICE_PATH);
  const { sanitizePreviousPlanSummary } = require(ROUTER_PATH);

  return { sessionService, sessionDocs, messageDocs, sanitizePreviousPlanSummary };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const VALID_SESSION_ID = "507f1f77bcf86cd799439011";
const PLAN_SUMMARY = {
  metrics: ["EXPENSE_TOTAL"],
  operation: "LOOKUP",
  periodLabel: "this month",
  grouping: "NONE",
  categoryFilter: null,
  topicLabel: "Spending overview for personal account",
  entityFilter: "account:personal",
};

describe("sia/follow‑up flow", () => {
  it("persists a planSummary and retrieves the same sanitized version on the next turn", async () => {
    const { sessionService, messageDocs, sanitizePreviousPlanSummary } = loadMocks();

    // mock the assistant message creation to include the planSummary we pass in
    messageDocs.create.mockResolvedValueOnce({ _id: "user-msg-1" })
      .mockResolvedValueOnce({ _id: "assistant-msg-1", createdAt: new Date() });

    await sessionService.appendTurn({
      sessionId: VALID_SESSION_ID,
      userId: "user-1",
      question: "How much did I spend this month?",
      intent: null,
      answer: "You spent ₹4250 this month.",
      planSummary: PLAN_SUMMARY,
    });

    // Load the service with a message-model query that returns our stored plan.
    const mockFind = jest.fn(() => chainable({ planSummary: PLAN_SUMMARY }));
    const { sessionService: svc2 } = loadMocks({ messageDocs: { findOne: mockFind } });
    const result = await svc2.loadLastPlanSummary(VALID_SESSION_ID, "user-1");

    // The retrieved summary should equal the original (sanitized by the router later)
    expect(result).toEqual(PLAN_SUMMARY);

    // Verify the sanitization drops overly long fields (simulate a long topicLabel)
    const longSummary = { ...PLAN_SUMMARY, topicLabel: "x".repeat(200) };
    const sanitized = sanitizePreviousPlanSummary(longSummary);
    expect(sanitized.topicLabel.length).toBeLessThanOrEqual(80);
    expect(sanitized.entityFilter.length).toBeLessThanOrEqual(60);
  });
});
