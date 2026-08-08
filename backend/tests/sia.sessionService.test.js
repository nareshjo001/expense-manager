// Unit tests for backend/sia/sessionService.js -- Batch 2.
//
// models/SiaSession.js and models/SiaMessage.js are fully mocked (no real
// MongoDB connection, consistent with tests/sia.contextBuilder.test.js's
// reportService-mocking convention) -- these tests prove sessionService.js's
// own logic: which queries it builds, how it enforces ownership, how it
// bounds pagination limits, and how it handles the idempotency check --
// not Mongoose's own query engine.
"use strict";

const SESSION_MODEL_PATH = "../models/SiaSession";
const MESSAGE_MODEL_PATH = "../models/SiaMessage";
const SERVICE_PATH = "../sia/sessionService";

// find()/findOne()/find({...}).sort().limit().lean() chain support -- a
// single helper used for both findOne(...).lean() (listMessages'
// ownership check) and find(...).sort().limit().lean() (listSessions,
// listMessages, loadRecentTurns). Also thenable (a `.then()` that resolves
// to `resolvedValue`), matching real Mongoose Query objects, which are
// themselves awaitable directly (e.g. getOrCreateSession's/appendTurn's
// `await SiaSession.findOne({...})` with no `.lean()` call at all).
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
  return { sessionService, sessionDocs, messageDocs, chainable };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const VALID_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const OTHER_VALID_ID = "64f1a2b3c4d5e6f7a8b9c0d2";

describe("sia/sessionService -- getOrCreateSession", () => {
  it("creates a brand-new session when no sessionId is supplied", async () => {
    const { sessionService, sessionDocs } = loadSessionService();
    sessionDocs.create.mockResolvedValue({ _id: VALID_ID, user: "user-1" });

    const session = await sessionService.getOrCreateSession("user-1", undefined);

    expect(sessionDocs.findOne).not.toHaveBeenCalled();
    expect(sessionDocs.create).toHaveBeenCalledWith({ user: "user-1" });
    expect(session._id).toBe(VALID_ID);
  });

  it("returns the existing session when sessionId resolves to one owned by this user", async () => {
    const { sessionService, sessionDocs } = loadSessionService();
    sessionDocs.findOne.mockResolvedValue({ _id: VALID_ID, user: "user-1" });

    const session = await sessionService.getOrCreateSession("user-1", VALID_ID);

    expect(sessionDocs.findOne).toHaveBeenCalledWith({ _id: VALID_ID, user: "user-1" });
    expect(sessionDocs.create).not.toHaveBeenCalled();
    expect(session._id).toBe(VALID_ID);
  });

  it("silently creates a new session instead of throwing when sessionId belongs to a different user", async () => {
    const { sessionService, sessionDocs } = loadSessionService();
    sessionDocs.findOne.mockResolvedValue(null); // ownership filter excluded it
    sessionDocs.create.mockResolvedValue({ _id: OTHER_VALID_ID, user: "user-1" });

    const session = await sessionService.getOrCreateSession("user-1", OTHER_VALID_ID);

    expect(sessionDocs.create).toHaveBeenCalledWith({ user: "user-1" });
    expect(session._id).toBe(OTHER_VALID_ID);
  });

  it("silently creates a new session instead of throwing on a malformed sessionId", async () => {
    const { sessionService, sessionDocs } = loadSessionService();
    sessionDocs.create.mockResolvedValue({ _id: VALID_ID, user: "user-1" });

    const session = await sessionService.getOrCreateSession("user-1", "not-a-valid-object-id");

    expect(sessionDocs.findOne).not.toHaveBeenCalled();
    expect(sessionDocs.create).toHaveBeenCalledWith({ user: "user-1" });
    expect(session._id).toBe(VALID_ID);
  });
});

describe("sia/sessionService -- appendTurn", () => {
  it("creates exactly one user message and one assistant message, then increments the session counters", async () => {
    const { sessionService, sessionDocs, messageDocs } = loadSessionService();
    messageDocs.findOne.mockResolvedValue(null);
    messageDocs.create
      .mockResolvedValueOnce({ _id: "m1", role: "user" })
      .mockResolvedValueOnce({ _id: "m2", role: "assistant", createdAt: new Date("2026-08-08T00:00:00.000Z") });

    const result = await sessionService.appendTurn({
      sessionId: VALID_ID,
      userId: "user-1",
      question: "Why is my health score low?",
      intent: "HEALTH_EXPLANATION",
      answer: "Because X.",
      providerMetadata: { provider: "openai" },
      clientMessageId: undefined,
    });

    expect(messageDocs.create).toHaveBeenCalledTimes(2);
    expect(messageDocs.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      session: VALID_ID,
      user: "user-1",
      role: "user",
      content: "Why is my health score low?",
      intent: "HEALTH_EXPLANATION",
      clientMessageId: null, // no clientMessageId supplied in this test
    }));
    expect(messageDocs.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      session: VALID_ID,
      user: "user-1",
      role: "assistant",
      content: "Because X.",
      intent: "HEALTH_EXPLANATION",
      metadata: { provider: "openai" },
    }));
    expect(sessionDocs.updateOne).toHaveBeenCalledWith(
      { _id: VALID_ID, user: "user-1" },
      expect.objectContaining({ $inc: { messageCount: 2 } })
    );
    expect(result.deduplicated).toBe(false);
  });

  it("is idempotent: a repeated request with the same clientMessageId returns the prior pair without creating duplicates", async () => {
    const { sessionService, messageDocs, chainable } = loadSessionService();
    messageDocs.findOne
      .mockReturnValueOnce(chainable({ _id: "m1", role: "user", content: "Q" }))
      .mockReturnValueOnce(chainable({ _id: "m2", role: "assistant", content: "A" }));

    const result = await sessionService.appendTurn({
      sessionId: VALID_ID,
      userId: "user-1",
      question: "Q",
      intent: "HEALTH_EXPLANATION",
      answer: "A",
      clientMessageId: "retry-key-1",
    });

    expect(messageDocs.create).not.toHaveBeenCalled();
    expect(result.deduplicated).toBe(true);
    expect(result.userMessage.content).toBe("Q");
    expect(result.assistantMessage.content).toBe("A");
  });

  describe("race-safety: protected by the database unique index, not only the prior findOne", () => {
    it("a concurrent duplicate create() (E11000 on the user-message write) recovers the winner's pair instead of throwing or duplicating", async () => {
      const { sessionService, messageDocs, chainable } = loadSessionService();
      // Fast-path findOne sees nothing yet (simulates two requests racing
      // past the check at the same time).
      messageDocs.findOne.mockReturnValue(chainable(null));

      const duplicateKeyError = Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      messageDocs.create.mockRejectedValueOnce(duplicateKeyError);

      // After the collision, the recovery path re-queries for the pair a
      // concurrent winner already created.
      messageDocs.findOne
        .mockReturnValueOnce(chainable(null)) // fast-path: userMessage
        .mockReturnValueOnce(chainable(null)) // fast-path: assistantMessage
        .mockReturnValueOnce(chainable({ _id: "winner-user", role: "user", content: "Q" })) // recovery: userMessage
        .mockReturnValueOnce(chainable({ _id: "winner-assistant", role: "assistant", content: "A" })); // recovery: assistantMessage

      const result = await sessionService.appendTurn({
        sessionId: VALID_ID,
        userId: "user-1",
        question: "Q",
        intent: "HEALTH_EXPLANATION",
        answer: "A",
        clientMessageId: "race-key-1",
      });

      expect(result.deduplicated).toBe(true);
      expect(result.userMessage.content).toBe("Q");
      expect(result.assistantMessage.content).toBe("A");
      // Only the one doomed create() attempt was made -- no duplicate
      // successfully persisted.
      expect(messageDocs.create).toHaveBeenCalledTimes(1);
    });

    it("a genuine (non-duplicate) error on the second write rolls back the first and rethrows, so no lone user-only message is left behind", async () => {
      const { sessionService, messageDocs, chainable } = loadSessionService();
      messageDocs.findOne.mockReturnValue(chainable(null));
      messageDocs.create
        .mockResolvedValueOnce({ _id: "orphan-candidate", role: "user" })
        .mockRejectedValueOnce(new Error("real database failure"));
      messageDocs.deleteOne = jest.fn(async () => ({ deletedCount: 1 }));

      await expect(
        sessionService.appendTurn({
          sessionId: VALID_ID,
          userId: "user-1",
          question: "Q",
          intent: "HEALTH_EXPLANATION",
          answer: "A",
        })
      ).rejects.toThrow("real database failure");

      expect(messageDocs.deleteOne).toHaveBeenCalledWith({ _id: "orphan-candidate" });
    });

    it("different sessions may safely reuse the same clientMessageId (index is scoped per-session)", async () => {
      const { sessionService, messageDocs, chainable } = loadSessionService();
      messageDocs.findOne.mockReturnValue(chainable(null));
      messageDocs.create.mockResolvedValue({ _id: "m", role: "user" });

      await sessionService.appendTurn({
        sessionId: VALID_ID,
        userId: "user-1",
        question: "Q1",
        intent: "HEALTH_EXPLANATION",
        answer: "A1",
        clientMessageId: "shared-key",
      });
      await sessionService.appendTurn({
        sessionId: OTHER_VALID_ID,
        userId: "user-2",
        question: "Q2",
        intent: "HEALTH_EXPLANATION",
        answer: "A2",
        clientMessageId: "shared-key",
      });

      // Both proceeded to create() -- the fast-path lookup is scoped to
      // `session`, so the same raw clientMessageId in two different
      // sessions never collides.
      expect(messageDocs.create).toHaveBeenCalledTimes(4);
    });
  });
});

describe("sia/sessionService -- listSessions", () => {
  it("scopes the query to the caller's own userId and bounds the limit to the maximum", async () => {
    const { sessionService, sessionDocs, chainable } = loadSessionService();
    const chain = chainable([{ _id: VALID_ID }]);
    sessionDocs.find.mockReturnValue(chain);

    await sessionService.listSessions("user-1", { limit: 9999 });

    expect(sessionDocs.find).toHaveBeenCalledWith({ user: "user-1" });
    expect(chain.limit).toHaveBeenCalledWith(50); // MAX_SESSION_LIST_LIMIT
  });

  it("falls back to the default limit for a non-numeric/zero/negative request", async () => {
    const { sessionService, sessionDocs, chainable } = loadSessionService();
    const chain = chainable([]);
    sessionDocs.find.mockReturnValue(chain);

    await sessionService.listSessions("user-1", { limit: -5 });

    expect(chain.limit).toHaveBeenCalledWith(20); // DEFAULT_SESSION_LIST_LIMIT
  });
});

describe("sia/sessionService -- listMessages (ownership enforcement)", () => {
  it("returns null (not a throw) for a session that does not belong to this user", async () => {
    const { sessionService, sessionDocs, chainable } = loadSessionService();
    sessionDocs.findOne.mockReturnValue(chainable(null));

    const result = await sessionService.listMessages(VALID_ID, "user-1", {});

    expect(result).toBeNull();
  });

  it("returns null for a malformed sessionId without ever querying the session model", async () => {
    const { sessionService, sessionDocs } = loadSessionService();

    const result = await sessionService.listMessages("not-an-id", "user-1", {});

    expect(result).toBeNull();
    expect(sessionDocs.findOne).not.toHaveBeenCalled();
  });

  it("returns bounded, chronologically-sorted messages scoped to (session, user) when owned", async () => {
    const { sessionService, sessionDocs, messageDocs, chainable } = loadSessionService();
    sessionDocs.findOne.mockReturnValue(chainable({ _id: VALID_ID, user: "user-1" }));
    const chain = chainable([{ role: "user", content: "Q" }]);
    messageDocs.find.mockReturnValue(chain);

    const result = await sessionService.listMessages(VALID_ID, "user-1", { limit: 10 });

    expect(messageDocs.find).toHaveBeenCalledWith({ session: VALID_ID, user: "user-1" });
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: 1 });
    expect(result.messages).toEqual([{ role: "user", content: "Q" }]);
  });
});

describe("sia/sessionService -- deleteSession (ownership enforcement)", () => {
  it("returns false for a session that does not belong to this user, and never deletes messages", async () => {
    const { sessionService, sessionDocs, messageDocs } = loadSessionService();
    sessionDocs.findOneAndDelete.mockResolvedValue(null);

    const deleted = await sessionService.deleteSession(VALID_ID, "user-1");

    expect(deleted).toBe(false);
    expect(messageDocs.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes the owned session and cascades to its messages", async () => {
    const { sessionService, sessionDocs, messageDocs } = loadSessionService();
    sessionDocs.findOneAndDelete.mockResolvedValue({ _id: VALID_ID, user: "user-1" });

    const deleted = await sessionService.deleteSession(VALID_ID, "user-1");

    expect(deleted).toBe(true);
    expect(messageDocs.deleteMany).toHaveBeenCalledWith({ session: VALID_ID, user: "user-1" });
  });
});

describe("sia/sessionService -- loadRecentTurns", () => {
  it("loads at most MAX_RECENT_TURNS_FOR_LLM turns, oldest-loaded-first, with only role/content/intent", async () => {
    const { sessionService, messageDocs, chainable } = loadSessionService();
    const chain = chainable([
      { role: "assistant", content: "A2", intent: "HEALTH_EXPLANATION", _id: "leak1", metadata: { provider: "openai" } },
      { role: "user", content: "Q2", intent: "HEALTH_EXPLANATION", _id: "leak2" },
    ]);
    messageDocs.find.mockReturnValue(chain);

    const turns = await sessionService.loadRecentTurns(VALID_ID, "user-1");

    expect(chain.limit).toHaveBeenCalledWith(sessionService.MAX_RECENT_TURNS_FOR_LLM);
    expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
    // Reversed back to ascending order, and no id/metadata leakage.
    expect(turns).toEqual([
      { role: "user", content: "Q2", intent: "HEALTH_EXPLANATION" },
      { role: "assistant", content: "A2", intent: "HEALTH_EXPLANATION" },
    ]);
  });

  it("returns an empty array for a malformed sessionId", async () => {
    const { sessionService } = loadSessionService();
    const turns = await sessionService.loadRecentTurns("not-an-id", "user-1");
    expect(turns).toEqual([]);
  });
});
