// Batch 3F acceptance remediation -- requirement 2: prove exact
// final-context provenance.
//
// backend/sia/groundingService.js's buildGroundingSnapshot() decides which
// sources to list purely from field presence on the `contextResult` object
// returned by backend/sia/contextBuilder.js's buildContext() (see that
// module's own contract comments). This test does NOT re-assert that
// design in isolation (backend/tests/sia.grounding.test.js already does) --
// it instead proves the thing Batch 3F's acceptance review specifically
// demanded: that the exact same `contextResult` object handed to
// buildGroundingSnapshot() is ALSO, byte-for-byte, what reaches the real
// provider payload, with no filtering, transformation, omission, or
// truncation in between.
//
// The mock boundary is deliberately axios.post, not backend/sia/llmService
// itself (contrast backend/tests/sia.ask.groundingTransparency.test.js,
// which mocks llmService directly for its own unrelated concerns). Going
// through the REAL backend/sia/llmService.js -- specifically its
// buildUserInputContent(), which is otherwise untouched by this batch --
// means the captured axios request body is the actual final provider
// input, not a stand-in for it. This test then parses that real request
// body's JSON-context segment back out (never the free-text prose parts of
// the prompt) and diffs it against the grounding snapshot -- proving
// provenance without ever parsing the LLM's *answer* or the constructed
// system prompt to reconstruct it.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-grounding-provenance-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const REAL_API_KEY = "sk-test-provenance-key";
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const QUESTION = "Why is my financial health score low?";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.OPENAI_API_KEY = REAL_API_KEY;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
});

let consoleLogSpy;
beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  consoleLogSpy.mockRestore();
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-grounding-provenance@example.test", _id: userId }, TEST_JWT_SECRET);
}

const READY_CONFIG = { enabled: true, provider: "openai", model: "gpt-test", timeoutMs: 8000 };

function completedResponse(text) {
  return {
    data: {
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    },
  };
}

// Loads the app with the REAL backend/sia/llmService.js (only axios.post is
// mocked, one layer below it) and the REAL backend/sia/groundingService.js,
// so both the grounding snapshot and the provider request body come from
// the actual Batch 3F production code path -- only buildContext (the
// analytics boundary) and the session/idempotency stores are test doubles,
// exactly as backend/tests/sia.ask.groundingTransparency.test.js already
// does for its own, different assertions.
function loadApp({ buildContextImpl, postMock } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => READY_CONFIG);

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: jest.fn(realClassifyIntent) }));

  const buildContextMock = jest.fn(buildContextImpl);
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  jest.doMock("axios", () => ({ post: postMock }));

  jest.doMock("../sia/sessionService", () => ({
    findOwnedSession: jest.fn(async (userId, sessionId) => ({ _id: sessionId, user: userId })),
    createSession: jest.fn(async (userId) => ({ _id: `sess-${userId}`, user: userId })),
    getOrCreateSession: jest.fn(),
    appendTurn: jest.fn(async () => ({ deduplicated: false })),
    loadRecentTurns: jest.fn(async () => []),
    listSessions: jest.fn(async () => []),
    listMessages: jest.fn(async () => null),
    deleteSession: jest.fn(async () => false),
  }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => true }));

  const realIdempotency = jest.requireActual("../sia/idempotencyService");
  jest.doMock("../sia/idempotencyService", () => ({
    ...realIdempotency,
    reserveRequest: jest.fn(async () => {
      throw new Error("reserveRequest should not be called without clientMessageId in these tests");
    }),
    markAnswerReady: jest.fn(async () => {}),
    markCompleted: jest.fn(async () => {}),
    releaseRequest: jest.fn(async () => {}),
  }));

  const app = require("../app");
  return { app, buildContextMock };
}

const post = (app, token, body) => request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);

// Pulls the serialized JSON context segment back out of the real user
// input content string built by backend/sia/llmService.js's
// buildUserInputContent(): `Question: ${question}\n\nFinancial context
// (JSON):\n${serializedContext}`. Only that trailing JSON segment is ever
// parsed here -- never the free-text prose, and never the model's answer.
function extractProviderContext(userInputContent) {
  const marker = "Financial context (JSON):\n";
  const idx = userInputContent.indexOf(marker);
  expect(idx).toBeGreaterThan(-1);
  const jsonText = userInputContent.slice(idx + marker.length);
  return JSON.parse(jsonText);
}

describe("SIA grounding -- exact final-context provenance (Batch 3F acceptance remediation, requirement 2)", () => {
  it("every source buildGroundingSnapshot lists corresponds to a field genuinely present, byte-for-byte, in the real provider payload", async () => {
    const contextResult = {
      intent: "HEALTH_EXPLANATION",
      fields: {
        financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
        summary: { healthScore: 75, riskLevel: "Low" },
      },
      sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
    };
    const postMock = jest.fn().mockResolvedValue(completedResponse("Your score is healthy."));
    const { app } = loadApp({ buildContextImpl: async () => contextResult, postMock });

    const res = await post(app, signToken("user-1"), { question: QUESTION });

    expect(res.status).toBe(200);
    expect(postMock).toHaveBeenCalledTimes(1);

    // The real request body axios.post actually received.
    const requestBody = postMock.mock.calls[0][1];
    const lastInputEntry = requestBody.input[requestBody.input.length - 1];
    expect(lastInputEntry.role).toBe("user");
    const providerContext = extractProviderContext(lastInputEntry.content);

    // Byte-for-byte: the serialized context segment sent to the provider is
    // exactly JSON.stringify(contextResult) -- the identical object
    // buildGroundingSnapshot(contextResult) was called with in
    // Controllers/SiaControllers/ask.js, confirming no filtering,
    // transformation, or truncation happens in between.
    expect(lastInputEntry.content).toContain(JSON.stringify(contextResult));
    expect(providerContext).toEqual(contextResult);

    // And the grounding response returned to the client lists exactly the
    // sources whose fields are present in that same, now-proven-identical,
    // provider-sent context.
    expect(res.body.grounding.sources.map((s) => s.key).sort()).toEqual(["financialHealth", "summary"]);
    for (const source of res.body.grounding.sources) {
      expect(providerContext.fields).toHaveProperty(source.key);
      expect(providerContext.fields[source.key]).not.toBeNull();
      expect(providerContext.fields[source.key]).not.toBeUndefined();
    }
  });

  it("a selected-but-absent section is listed in neither grounding nor the real provider payload's fields", async () => {
    // The classifier picks HEALTH_EXPLANATION (which normally carries both
    // financialHealth and summary), but this turn's buildContext() only
    // actually resolved financialHealth -- summary is genuinely absent from
    // what was selected AND from what reaches the provider.
    const contextResult = {
      intent: "HEALTH_EXPLANATION",
      fields: { financialHealth: { overall: 40, risk: { label: "High", color: "red" } } },
      sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
    };
    const postMock = jest.fn().mockResolvedValue(completedResponse("Your score is at risk."));
    const { app } = loadApp({ buildContextImpl: async () => contextResult, postMock });

    const res = await post(app, signToken("user-2"), { question: QUESTION });

    expect(res.status).toBe(200);
    const requestBody = postMock.mock.calls[0][1];
    const lastInputEntry = requestBody.input[requestBody.input.length - 1];
    const providerContext = extractProviderContext(lastInputEntry.content);

    expect(providerContext.fields).not.toHaveProperty("summary");
    expect(res.body.grounding.sources.map((s) => s.key)).toEqual(["financialHealth"]);
    expect(res.body.grounding.sources.find((s) => s.key === "summary")).toBeUndefined();
  });

  it("a field explicitly present as null is neither grounded nor a genuine value in the real provider payload", async () => {
    const contextResult = {
      intent: "FINANCIAL_RISK_EXPLANATION",
      fields: { financialHealth: null, risk: { hasData: true, signals: [] } },
      sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
    };
    const postMock = jest.fn().mockResolvedValue(completedResponse("Your risk is low."));
    const { app } = loadApp({ buildContextImpl: async () => contextResult, postMock });

    const res = await post(app, signToken("user-3"), { question: "Why is my financial risk high?" });

    expect(res.status).toBe(200);
    const requestBody = postMock.mock.calls[0][1];
    const lastInputEntry = requestBody.input[requestBody.input.length - 1];
    const providerContext = extractProviderContext(lastInputEntry.content);

    // The key is present in the real provider payload (JSON.stringify keeps
    // null-valued keys) but its value is null, not real data -- and
    // grounding correctly excludes it on that basis, matching
    // groundingService.js's isPresent() rule exactly.
    expect(providerContext.fields.financialHealth).toBeNull();
    expect(res.body.grounding.sources.map((s) => s.key)).toEqual(["risk"]);
  });
});
