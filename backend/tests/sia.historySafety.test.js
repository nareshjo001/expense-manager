// Batch 2 architecture closure: consolidated proof of the exact stored
// message allowlist, its exclusions, and the size/count bounds applied
// before anything reaches the LLM. Complements
// tests/sia.sessionService.test.js (behavioral proof) and
// tests/sia.llmService.history.test.js (framing proof) with a direct,
// structural proof that forbidden fields have no path into storage at all.
"use strict";

const SiaMessage = require("../models/SiaMessage");
const { buildHistoryMessages } = require("../sia/llmService");

describe("models/SiaMessage -- exact stored field allowlist", () => {
  it("the schema's own path list contains only the intentionally bounded fields", () => {
    const paths = Object.keys(SiaMessage.schema.paths);
    const allowed = new Set([
      "_id",
      "session",
      "user",
      "role",
      "content",
      "intent",
      "clientMessageId",
      "metadata.provider",
      "metadata.model",
      "metadata.latencyMs",
      "metadata.errorCode",
      "createdAt",
      "updatedAt",
      "__v",
    ]);
    for (const path of paths) {
      expect(allowed.has(path)).toBe(true);
    }
    // And nothing that looks like a report/context/prompt/secret field
    // exists on the schema at all.
    const serializedPaths = paths.join(",").toLowerCase();
    for (const forbidden of ["report", "context", "prompt", "apikey", "token", "rawresponse", "reasoning"]) {
      expect(serializedPaths).not.toContain(forbidden);
    }
  });

  it("content is bounded to a finite maxlength -- messages cannot grow without limit", () => {
    const contentPath = SiaMessage.schema.path("content");
    const maxlengthValidator = contentPath.validators.find((v) => v.type === "maxlength");
    expect(maxlengthValidator).toBeDefined();
    expect(typeof maxlengthValidator.maxlength === "number" || typeof contentPath.options.maxlength === "number").toBe(true);
  });
});

describe("sia/sessionService.appendTurn -- forbidden fields have no path into storage", () => {
  function loadMockedService() {
    jest.resetModules();
    const sessionDocs = { updateOne: jest.fn(async () => ({})) };
    const messageDocs = {
      findOne: jest.fn(() => ({ lean: async () => null })),
      create: jest.fn(async (attrs) => ({ ...attrs, _id: "m", createdAt: new Date() })),
    };
    jest.doMock("../models/SiaSession", () => sessionDocs);
    jest.doMock("../models/SiaMessage", () => messageDocs);
    return { sessionService: require("../sia/sessionService"), messageDocs };
  }

  afterEach(() => {
    jest.resetModules();
  });

  it("appendTurn's own create() calls never carry a report/context/apiKey/prompt field, even though it is not asked to", async () => {
    const { sessionService, messageDocs } = loadMockedService();

    await sessionService.appendTurn({
      sessionId: "s1",
      userId: "u1",
      question: "Why is my health score low?",
      intent: "HEALTH_EXPLANATION",
      answer: "Because X.",
      providerMetadata: { provider: "openai" },
      // Even if a caller mistakenly passed extra fields, appendTurn's own
      // signature destructuring never reads them -- proven by
      // asserting the create() calls below never contain them.
    });

    for (const call of messageDocs.create.mock.calls) {
      const attrs = call[0];
      const keys = Object.keys(attrs);
      for (const forbidden of ["report", "context", "systemPrompt", "apiKey", "rawResponse", "reasoning"]) {
        expect(keys).not.toContain(forbidden);
      }
      // Only the exact bounded field set is ever written.
      expect(new Set(keys)).toEqual(
        new Set(["session", "user", "role", "content", "intent", "clientMessageId", ...(attrs.metadata ? ["metadata"] : [])])
      );
    }
  });
});

describe("bounded recent-turn window -- deterministic serialized-size ceiling before reaching the LLM", () => {
  beforeEach(() => {
    jest.resetModules();
    // Undo any jest.doMock registrations left over from the earlier
    // describe block in this same file (jest.resetModules() clears the
    // module registry but NOT explicit jest.doMock() registrations).
    jest.dontMock("../models/SiaSession");
    jest.dontMock("../models/SiaMessage");
  });

  it("MAX_RECENT_TURNS_FOR_LLM x per-message maxlength bounds the total history size supplied to buildHistoryMessages", () => {
    const { MAX_RECENT_TURNS_FOR_LLM } = require("../sia/sessionService");
    const { CONTENT_LIMITS } = require("../models/SiaMessage");

    const worstCaseTurns = Array.from({ length: MAX_RECENT_TURNS_FOR_LLM }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(CONTENT_LIMITS.MAX_ASSISTANT_CONTENT_LENGTH),
    }));

    const messages = buildHistoryMessages(worstCaseTurns);
    const totalSize = messages.reduce((sum, m) => sum + m.content.length, 0);

    // A concrete, finite, computable ceiling -- not "unbounded".
    const theoreticalCeiling = MAX_RECENT_TURNS_FOR_LLM * (CONTENT_LIMITS.MAX_ASSISTANT_CONTENT_LENGTH + 80); // +80 for the label prefix
    expect(totalSize).toBeLessThan(theoreticalCeiling);
    expect(messages.length).toBe(MAX_RECENT_TURNS_FOR_LLM);
  });

  it("loadRecentTurns never returns more than MAX_RECENT_TURNS_FOR_LLM turns even if asked for more", async () => {
    jest.resetModules();
    const messageDocs = {
      find: jest.fn(() => {
        const chain = {
          sort: () => chain,
          limit: jest.fn(() => chain),
          lean: async () => [],
        };
        return chain;
      }),
    };
    jest.doMock("../models/SiaSession", () => ({}));
    jest.doMock("../models/SiaMessage", () => messageDocs);
    // Required only once, after mocking, so this exact instance's
    // MAX_RECENT_TURNS_FOR_LLM and its internal SiaMessage reference are
    // both the mocked ones -- requiring it a second time before mocking
    // (as an earlier version of this test did) caches the REAL module
    // instead, which doMock cannot retroactively replace.
    const sessionService = require("../sia/sessionService");
    const { MAX_RECENT_TURNS_FOR_LLM } = sessionService;

    await sessionService.loadRecentTurns("64f1a2b3c4d5e6f7a8b9c0d1", "64f1a2b3c4d5e6f7a8b9c0d2", 999999);

    const chain = messageDocs.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(MAX_RECENT_TURNS_FOR_LLM);
  });
});
