// Batch 3B.1: request-level idempotency regression suite.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-ask-idempotency-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;

// Batch 3E: the controller's readiness gate additionally requires a
const FAKE_CREDENTIAL = "test-credential-value-not-a-real-key";
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const VALID_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const OTHER_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d2";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.OPENAI_API_KEY = FAKE_CREDENTIAL;
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
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
  return jwt.sign({ email: "sia-idempotency-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const healthContext = () => ({
  intent: "HEALTH_EXPLANATION",
  fields: { financialHealth: { overall: 75, risk: { label: "Low", color: "green" } } },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

const QUESTION = "Why is my financial health score low?";
const OTHER_QUESTION = "Why did my spending increase this month?";

// ---------------------------------------------------------------------
function createSiaRequestFake() {
  const docs = [];
  let nextId = 1;

  const matches = (doc, filter) =>
    Object.keys(filter).every((key) => {
      const expected = filter[key];
      const actual = doc[key];
      if (expected && typeof expected === "object" && "$lt" in expected) {
        return actual != null && new Date(actual).getTime() < new Date(expected.$lt).getTime();
      }
      return String(actual) === String(expected);
    });

  const model = {
    async findOne(filter) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    async create(attrs) {
      // The unique (user, clientMessageId) index, enforced for real.
      const clash = docs.find(
        (d) => String(d.user) === String(attrs.user) && d.clientMessageId === attrs.clientMessageId
      );
      if (clash) {
        throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      }
      const doc = { _id: `req-${nextId++}`, ...attrs };
      docs.push(doc);
      return doc;
    },
    async findOneAndUpdate(filter, update) {
      // Atomic compare-and-set: only a caller whose filter still matches
      // (including the exact prior ownerToken) may mutate.
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return null;
      Object.assign(doc, update.$set);
      return doc;
    },
    async deleteOne(filter) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    __docs: docs,
  };

  // Mongoose lean() support on the follower-poll query path.
  const originalFindOne = model.findOne.bind(model);
  model.findOne = (filter) => {
    const promise = originalFindOne(filter);
    promise.lean = () => promise;
    return promise;
  };

  return model;
}

function loadApp({
  buildContextImpl,
  askLlmImpl,
  directAnswerImpl,
  findOwnedSessionImpl,
  createSessionImpl,
  appendTurnImpl,
  sessionStoreAvailable = true,
  siaRequestFake,
} = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", model: "sia-test-model", timeoutMs: 800 }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  const classifyIntentMock = jest.fn(realClassifyIntent);
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: classifyIntentMock }));

  const buildContextMock = jest.fn(buildContextImpl || (async () => healthContext()));
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  const { LlmProviderError: RealLlmProviderError } = jest.requireActual("../sia/llmService");
  let answerCounter = 0;
  const askLlmMock = jest.fn(
    askLlmImpl ||
      (async () => ({
        // A DIFFERENT answer each call, on purpose: if the provider were
        answer: `Answer #${++answerCounter}`,
        model: "mock-model",
        latencyMs: 5,
      }))
  );
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError: RealLlmProviderError }));

  // POST /sia/ask now uses the direct financial-snapshot path. Keep this
  const buildFinancialSnapshotMock = jest.fn(async () => ({
    ok: true,
    snapshot: { period: { label: "this month" }, analytics: {}, income: {} },
  }));
  const answerDirectlyMock = jest.fn(async (args) => {
    if (directAnswerImpl) return directAnswerImpl(args);
    const result = await askLlmMock(args);
    if (result && typeof result.ok === "boolean") return result;
    return result && typeof result.answer === "string"
      ? { ok: true, answer: result.answer }
      : { ok: false, errorCode: "DIRECT_ANSWER_INVALID" };
  });
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot: buildFinancialSnapshotMock }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly: answerDirectlyMock }));

  const findOwnedSessionMock = jest.fn(
    findOwnedSessionImpl || (async (userId, sessionId) => ({ _id: sessionId, user: userId }))
  );
  let sessionCounter = 0;
  const createSessionMock = jest.fn(
    createSessionImpl || (async (userId) => ({ _id: `new-sess-${++sessionCounter}`, user: userId }))
  );
  const appendTurnMock = jest.fn(appendTurnImpl || (async () => ({ deduplicated: false })));
  const loadRecentTurnsMock = jest.fn(async () => []);
  jest.doMock("../sia/sessionService", () => ({
    findOwnedSession: findOwnedSessionMock,
    createSession: createSessionMock,
    getOrCreateSession: jest.fn(),
    appendTurn: appendTurnMock,
    loadRecentTurns: loadRecentTurnsMock,
    listSessions: jest.fn(async () => []),
    listMessages: jest.fn(async () => null),
    deleteSession: jest.fn(async () => false),
  }));

  jest.doMock("../sia/sessionStoreAvailability", () => ({
    isSessionStoreAvailable: () => sessionStoreAvailable,
  }));

  const requestFake = siaRequestFake || createSiaRequestFake();
  const { REQUEST_STATUS } = jest.requireActual("../models/SiaRequest");
  jest.doMock("../models/SiaRequest", () => {
    const exported = requestFake;
    exported.REQUEST_STATUS = REQUEST_STATUS;
    return exported;
  });

  const app = require("../app");
  return {
    app,
    buildContextMock,
    askLlmMock,
    classifyIntentMock,
    findOwnedSessionMock,
    createSessionMock,
    appendTurnMock,
    buildFinancialSnapshotMock,
    answerDirectlyMock,
    requestFake,
  };
}

const post = (app, token, body) =>
  request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);

// ---------------------------------------------------------------------
describe("POST /sia/ask -- sequential duplicate on an established session", () => {
  it("invokes the LLM exactly once, returns byte-identical responses, and appends exactly one turn", async () => {
    const { app, askLlmMock, appendTurnMock } = loadApp();
    const token = signToken("user-seq-1");
    const body = { question: QUESTION, sessionId: VALID_SESSION_ID, clientMessageId: "key-seq-1" };

    const first = await post(app, token, body);
    const second = await post(app, token, body);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual(first.body);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- concurrent duplicates", () => {
  it("only one request reaches the LLM; the follower never processes independently", async () => {
    let releaseProvider;
    const gate = new Promise((resolve) => {
      releaseProvider = resolve;
    });

    const { app, askLlmMock, appendTurnMock } = loadApp({
      askLlmImpl: async () => {
        await gate;
        return { answer: "The one and only answer.", model: "mock-model", latencyMs: 5 };
      },
    });
    const token = signToken("user-conc-1");
    const body = { question: QUESTION, sessionId: VALID_SESSION_ID, clientMessageId: "key-conc-1" };

    const inFlight = Promise.all([post(app, token, body), post(app, token, body)]);
    // Let both requests get past reservation before the provider resolves.
    await new Promise((resolve) => setTimeout(resolve, 60));
    releaseProvider();
    const [a, b] = await inFlight;

    // The critical proof: the provider was entered exactly once even
    // though two requests were in flight simultaneously.
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);

    const statuses = [a.status, b.status].sort();
    // The follower either replayed the owner's stored response, or (if the
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);

    const succeeded = [a, b].filter((r) => r.status === 200);
    for (const res of succeeded) {
      expect(res.body.answer).toBe("The one and only answer.");
    }
    const conflicted = [a, b].find((r) => r.status === 409);
    if (conflicted) {
      expect(conflicted.body.code).toBe("SIA_REQUEST_IN_PROGRESS");
    }
  });

  // Batch 3G narrow regression: the same race as above, but staged in the
  it("a duplicate arriving while the owner is still finalizing an ANSWER_READY answer never starts a second finalizer", async () => {
    let releasePersistence;
    const gate = new Promise((resolve) => {
      releasePersistence = resolve;
    });

    const { app, askLlmMock, appendTurnMock, createSessionMock } = loadApp({
      appendTurnImpl: async () => {
        await gate;
        return { deduplicated: false };
      },
    });
    const token = signToken("user-answer-ready-race-1");
    const body = { question: QUESTION, clientMessageId: "key-answer-ready-race-1" };

    const inFlight = Promise.all([post(app, token, body), post(app, token, body)]);
    // Let the owner get all the way through askLlm + validation +
    await new Promise((resolve) => setTimeout(resolve, 60));
    releasePersistence();
    const [a, b] = await inFlight;

    // The decisive proof: the provider and session persistence were each
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledTimes(1);

    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]);

    const succeeded = [a, b].filter((r) => r.status === 200);
    // Every successful response shares the SAME session id -- proof that no
    // second session was created for this one logical first turn.
    const sessionIds = new Set(succeeded.map((r) => r.body.sessionId));
    expect(sessionIds.size).toBe(1);

    const conflicted = [a, b].find((r) => r.status === 409);
    if (conflicted) {
      expect(conflicted.body.code).toBe("SIA_REQUEST_IN_PROGRESS");
    }
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- first-turn retry with no sessionId", () => {
  it("recovers the original session and answer, creating one session and calling the LLM once", async () => {
    const { app, askLlmMock, createSessionMock } = loadApp();
    const token = signToken("user-first-1");
    const body = { question: QUESTION, clientMessageId: "key-first-1" };

    const first = await post(app, token, body);
    // The client never received/stored the sessionId -- it retries with
    // the exact same payload, still with no sessionId.
    const retry = await post(app, token, body);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(retry.body.sessionId).toBe(first.body.sessionId);
    expect(retry.body).toEqual(first.body);
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- idempotency key conflicts", () => {
  it("the same key with a DIFFERENT question returns 409 with no new LLM call or persistence", async () => {
    const { app, askLlmMock, appendTurnMock } = loadApp();
    const token = signToken("user-conflict-1");

    await post(app, token, { question: QUESTION, sessionId: VALID_SESSION_ID, clientMessageId: "key-cf-1" });
    expect(askLlmMock).toHaveBeenCalledTimes(1);

    const conflict = await post(app, token, {
      question: OTHER_QUESTION,
      sessionId: VALID_SESSION_ID,
      clientMessageId: "key-cf-1",
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      success: false,
      code: "SIA_IDEMPOTENCY_CONFLICT",
      message: "This clientMessageId was already used for a different request.",
    });
    // Neither the provider nor persistence ran a second time.
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
  });

  it("the same key with a CONFLICTING sessionId returns the same conflict class", async () => {
    const { app, askLlmMock } = loadApp();
    const token = signToken("user-conflict-2");

    await post(app, token, { question: QUESTION, sessionId: VALID_SESSION_ID, clientMessageId: "key-cf-2" });

    const conflict = await post(app, token, {
      question: QUESTION,
      sessionId: OTHER_SESSION_ID,
      clientMessageId: "key-cf-2",
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe("SIA_IDEMPOTENCY_CONFLICT");
    expect(askLlmMock).toHaveBeenCalledTimes(1);
  });

  it("OMITTING sessionId on a retry is never a conflict -- it is the recovery path", async () => {
    const { app, askLlmMock } = loadApp();
    const token = signToken("user-conflict-3");

    const first = await post(app, token, {
      question: QUESTION,
      sessionId: VALID_SESSION_ID,
      clientMessageId: "key-cf-3",
    });
    const retry = await post(app, token, { question: QUESTION, clientMessageId: "key-cf-3" });

    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- completed replay", () => {
  it("skips the classifier, context builder, LLM, validator and appendTurn entirely", async () => {
    const { app, askLlmMock, buildContextMock, classifyIntentMock, appendTurnMock, createSessionMock } = loadApp();
    const token = signToken("user-replay-1");
    const body = { question: QUESTION, sessionId: VALID_SESSION_ID, clientMessageId: "key-replay-1" };

    await post(app, token, body);

    const classifyCallsAfterFirst = classifyIntentMock.mock.calls.length;
    const contextCallsAfterFirst = buildContextMock.mock.calls.length;

    const replay = await post(app, token, body);

    expect(replay.status).toBe(200);
    expect(classifyIntentMock.mock.calls.length).toBe(classifyCallsAfterFirst);
    expect(buildContextMock.mock.calls.length).toBe(contextCallsAfterFirst);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
    // Batch 3G remediation (closing an explicit coverage gap): REPLAY_COMPLETED
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- recovery from a stored answer", () => {
  it("completes persistence from the stored answer without another LLM call", async () => {
    const requestFake = createSiaRequestFake();
    // A prior attempt reached answer_ready then died before persisting.
    const { fingerprintQuestion } = jest.requireActual("../sia/idempotencyService");
    await requestFake.create({
      user: "user-resume-1",
      clientMessageId: "key-resume-1",
      questionFingerprint: fingerprintQuestion(QUESTION),
      status: "answer_ready",
      ownerToken: "stale-owner",
      processingExpiresAt: new Date(Date.now() - 60000),
      session: null,
      answer: "Previously validated answer.",
      intent: "HEALTH_EXPLANATION",
    });

    const { app, askLlmMock, appendTurnMock } = loadApp({ siaRequestFake: requestFake });
    const token = signToken("user-resume-1");

    const res = await post(app, token, { question: QUESTION, clientMessageId: "key-resume-1" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe("Previously validated answer.");
    // The whole point: no second provider call.
    expect(askLlmMock).not.toHaveBeenCalled();
    // Persistence was finished off from the stored answer.
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
  });

  // Batch 3G remediation: closes the audit's explicitly identified coverage
  it("RESUME_ANSWER_READY for a brand-new session creates exactly one session with the original validated question, and a same-key retry cannot diverge", async () => {
    const requestFake = createSiaRequestFake();
    const { fingerprintQuestion } = jest.requireActual("../sia/idempotencyService");
    await requestFake.create({
      user: "user-resume-title-1",
      clientMessageId: "key-resume-title-1",
      questionFingerprint: fingerprintQuestion(QUESTION),
      status: "answer_ready",
      ownerToken: "stale-owner",
      processingExpiresAt: new Date(Date.now() - 60000),
      session: null,
      answer: "Previously validated answer.",
      intent: "HEALTH_EXPLANATION",
    });

    const { app, askLlmMock, appendTurnMock, createSessionMock } = loadApp({ siaRequestFake: requestFake });
    const token = signToken("user-resume-title-1");
    const body = { question: QUESTION, clientMessageId: "key-resume-title-1" };

    const res = await post(app, token, body);

    expect(res.status).toBe(200);
    expect(askLlmMock).not.toHaveBeenCalled();

    // Exactly one new session, created with exactly the original validated
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledWith("user-resume-title-1", QUESTION);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);

    // A second arrival under the SAME clientMessageId (now status
    const retry = await post(app, token, body);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(res.body);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
  });

  it("RESUME_ANSWER_READY for an EXISTING session never creates a new session (no rename)", async () => {
    const requestFake = createSiaRequestFake();
    const { fingerprintQuestion } = jest.requireActual("../sia/idempotencyService");
    await requestFake.create({
      user: "user-resume-existing-1",
      clientMessageId: "key-resume-existing-1",
      questionFingerprint: fingerprintQuestion(QUESTION),
      status: "answer_ready",
      ownerToken: "stale-owner",
      processingExpiresAt: new Date(Date.now() - 60000),
      session: VALID_SESSION_ID,
      answer: "Previously validated answer for an existing session.",
      intent: "HEALTH_EXPLANATION",
    });

    const { app, askLlmMock, appendTurnMock, createSessionMock, findOwnedSessionMock } = loadApp({
      siaRequestFake: requestFake,
    });
    const token = signToken("user-resume-existing-1");

    const res = await post(app, token, {
      question: QUESTION,
      sessionId: VALID_SESSION_ID,
      clientMessageId: "key-resume-existing-1",
    });

    expect(res.status).toBe(200);
    expect(askLlmMock).not.toHaveBeenCalled();
    expect(findOwnedSessionMock).toHaveBeenCalled();
    // The decisive proof: resuming an ANSWER_READY record that already
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
    expect(res.body.sessionId).toBe(VALID_SESSION_ID);
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- failures leave the key safely retryable", () => {
  it("a provider failure creates no empty session and allows a later successful retry with the same key", async () => {
    let shouldFail = true;
    const { app, createSessionMock, askLlmMock } = loadApp({
      askLlmImpl: async () => {
        if (shouldFail) {
          const { LlmProviderError } = jest.requireActual("../sia/llmService");
          throw new LlmProviderError("boom", { code: "PROVIDER_TIMEOUT", provider: "openai" });
        }
        return { answer: "Recovered answer.", model: "mock-model", latencyMs: 5 };
      },
    });
    const token = signToken("user-fail-1");
    const body = { question: QUESTION, clientMessageId: "key-fail-1" };

    const failed = await post(app, token, body);
    expect(failed.status).toBe(503);
    expect(createSessionMock).not.toHaveBeenCalled();

    // The key was released, not poisoned -- the identical request now
    // succeeds under a fresh, properly-owned reservation.
    shouldFail = false;
    const retried = await post(app, token, body);
    expect(retried.status).toBe(200);
    expect(retried.body.answer).toBe("Recovered answer.");
    expect(askLlmMock).toHaveBeenCalledTimes(2); // one failed, one successful
  });

  it("a direct-answer validation rejection creates no empty session and leaves the key retryable", async () => {
    const { app, createSessionMock, requestFake } = loadApp({
      directAnswerImpl: async () => ({ ok: false, errorCode: "DIRECT_ANSWER_UNSUPPORTED_MONETARY_FIGURE" }),
    });
    const token = signToken("user-fail-2");

    const res = await post(app, token, {
      question: "What is my spending forecast for next month?",
      clientMessageId: "key-fail-2",
    });

    expect(res.status).toBe(503);
    expect(createSessionMock).not.toHaveBeenCalled();
    // Reservation released -- no lingering record blocks a future retry.
    expect(requestFake.__docs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- direct-answer replay", () => {
  it("replays the same 200 without a second direct-answer call or a new session", async () => {
    const { app, askLlmMock, createSessionMock } = loadApp({
      buildContextImpl: async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }),
    });
    const token = signToken("user-nodata-1");
    const body = { question: QUESTION, clientMessageId: "key-nodata-1" };

    const first = await post(app, token, body);
    const retry = await post(app, token, body);

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(createSessionMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- clientMessageId and sessionId validation", () => {
  it.each([
    ["a non-string clientMessageId", { clientMessageId: 12345 }, "clientMessageId must be a string"],
    ["a blank clientMessageId", { clientMessageId: "   " }, "clientMessageId must not be empty"],
    [
      "an overlength clientMessageId",
      { clientMessageId: "x".repeat(101) },
      "clientMessageId must be 100 characters or fewer",
    ],
    ["a non-string sessionId", { sessionId: 999 }, "sessionId must be a string"],
    ["a blank sessionId", { sessionId: "  " }, "sessionId must not be empty"],
    ["a malformed sessionId", { sessionId: "not-an-object-id" }, "sessionId is not a valid identifier"],
  ])("rejects %s with 400 before any LLM call", async (_label, extraBody, expectedMessage) => {
    const { app, askLlmMock } = loadApp();
    const token = signToken("user-validation-1");

    const res = await post(app, token, { question: QUESTION, ...extraBody });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: expectedMessage });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("accepts a clientMessageId of exactly 100 characters", async () => {
    const { app } = loadApp();
    const token = signToken("user-validation-2");

    const res = await post(app, token, { question: QUESTION, clientMessageId: "x".repeat(100) });

    expect(res.status).toBe(200);
  });

  it("a valid but unknown/foreign sessionId returns the non-disclosing 404, never a substituted new session", async () => {
    const { app, askLlmMock, createSessionMock } = loadApp({
      findOwnedSessionImpl: async () => null,
    });
    const token = signToken("user-validation-3");

    const res = await post(app, token, { question: QUESTION, sessionId: VALID_SESSION_ID });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Session not found." });
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- keyed request without a usable coordination store", () => {
  it("returns 503 BEFORE invoking the LLM rather than running an unprotected keyed request", async () => {
    const { app, askLlmMock } = loadApp({ sessionStoreAvailable: false });
    const token = signToken("user-store-1");

    const res = await post(app, token, { question: QUESTION, clientMessageId: "key-store-1" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(askLlmMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
describe("POST /sia/ask -- existing no-key behaviour is unchanged", () => {
  it("a request with no clientMessageId still succeeds and creates no idempotency record", async () => {
    const { app, askLlmMock, requestFake } = loadApp();
    const token = signToken("user-nokey-1");

    const res = await post(app, token, { question: QUESTION });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(requestFake.__docs.length).toBe(0);
  });

  it("two unkeyed duplicates behave exactly as before -- each is an independent request", async () => {
    const { app, askLlmMock } = loadApp();
    const token = signToken("user-nokey-2");

    await post(app, token, { question: QUESTION });
    await post(app, token, { question: QUESTION });

    // No idempotency guarantee was ever claimed for unkeyed requests.
    expect(askLlmMock).toHaveBeenCalledTimes(2);
  });

  it("an unkeyed request still works when the session store is unavailable", async () => {
    const { app } = loadApp({ sessionStoreAvailable: false });
    const token = signToken("user-nokey-3");

    const res = await post(app, token, { question: QUESTION });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeUndefined();
  });
});
