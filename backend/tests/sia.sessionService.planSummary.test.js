// Unit tests for backend/sia/sessionService.js's additive
"use strict";

const SESSION_MODEL_PATH = "../models/SiaSession";
const MESSAGE_MODEL_PATH = "../models/SiaMessage";
const SERVICE_PATH = "../sia/sessionService";

function chainable(resolvedValue) {
  const chain = {
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => resolvedValue),
    then: (resolve, reject) => Promise.resolve(resolvedValue).then(resolve, reject),
  };
  return chain;
}

function loadSessionService() {
  jest.resetModules();

  const sessionDocs = {
    findOne: jest.fn(() => chainable(null)),
    create: jest.fn(),
    find: jest.fn(),
    updateOne: jest.fn(async () => ({})),
    findOneAndDelete: jest.fn(),
  };
  const messageDocs = {
    findOne: jest.fn(() => chainable(null)),
    create: jest.fn(),
    find: jest.fn(),
    deleteMany: jest.fn(async () => ({})),
  };

  jest.doMock(SESSION_MODEL_PATH, () => sessionDocs);
  jest.doMock(MESSAGE_MODEL_PATH, () => messageDocs);

  const sessionService = require(SERVICE_PATH);
  return { sessionService, sessionDocs, messageDocs };
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
};

describe("sia/sessionService -- appendTurn planSummary persistence", () => {
  it("includes planSummary on the assistant document's create() call when supplied", async () => {
    const { sessionService, messageDocs } = loadSessionService();
    messageDocs.create
      .mockResolvedValueOnce({ _id: "user-msg-1" })
      .mockResolvedValueOnce({ _id: "assistant-msg-1", createdAt: new Date() });

    await sessionService.appendTurn({
      sessionId: VALID_SESSION_ID,
      userId: "user-1",
      question: "How much did I spend this month?",
      intent: null,
      answer: "You spent ₹4250 this month.",
      planSummary: PLAN_SUMMARY,
    });

    const assistantCreateCall = messageDocs.create.mock.calls[1][0];
    expect(assistantCreateCall.planSummary).toEqual(PLAN_SUMMARY);
  });

  it("omits planSummary entirely when not supplied -- a turn from the existing pipeline is unaffected", async () => {
    const { sessionService, messageDocs } = loadSessionService();
    messageDocs.create
      .mockResolvedValueOnce({ _id: "user-msg-1" })
      .mockResolvedValueOnce({ _id: "assistant-msg-1", createdAt: new Date() });

    await sessionService.appendTurn({
      sessionId: VALID_SESSION_ID,
      userId: "user-1",
      question: "Why is my financial health what it is?",
      intent: "HEALTH_EXPLANATION",
      answer: "Your score is 72.",
    });

    const assistantCreateCall = messageDocs.create.mock.calls[1][0];
    expect(assistantCreateCall).not.toHaveProperty("planSummary");
  });
});

describe("sia/sessionService -- loadLastPlanSummary", () => {
  it("returns the most recent assistant message's planSummary", async () => {
    const { sessionService, messageDocs } = loadSessionService();
    messageDocs.findOne.mockImplementation(() => chainable({ planSummary: PLAN_SUMMARY }));

    const result = await sessionService.loadLastPlanSummary(VALID_SESSION_ID, "user-1");
    expect(result).toEqual(PLAN_SUMMARY);
  });

  it("returns null when no prior turn carried a plan summary", async () => {
    const { sessionService, messageDocs } = loadSessionService();
    messageDocs.findOne.mockImplementation(() => chainable(null));

    const result = await sessionService.loadLastPlanSummary(VALID_SESSION_ID, "user-1");
    expect(result).toBeNull();
  });

  it("returns null for a malformed session id without throwing", async () => {
    const { sessionService } = loadSessionService();
    const result = await sessionService.loadLastPlanSummary("not-an-id", "user-1");
    expect(result).toBeNull();
  });
});
