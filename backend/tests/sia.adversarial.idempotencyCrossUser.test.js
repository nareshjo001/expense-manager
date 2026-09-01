// Adversarial security tests (Workstream 5 review) -- proves
"use strict";

const REQUEST_STATUS = Object.freeze({
  PROCESSING: "processing",
  ANSWER_READY: "answer_ready",
  COMPLETED: "completed",
});

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `fake-object-id-${idCounter}`;
}

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, expected]) => {
    if (expected === null || expected === undefined) {
      return doc[key] === null || doc[key] === undefined;
    }
    return String(doc[key]) === String(expected);
  });
}

function createFakeSiaRequestModel() {
  const store = [];

  const model = {
    async findOne(filter) {
      return store.find((doc) => matchesFilter(doc, filter)) || null;
    },
    async create(attrs) {
      // Faithfully enforces the REAL model's unique index on
      const collision = store.find(
        (doc) => String(doc.user) === String(attrs.user) && doc.clientMessageId === attrs.clientMessageId
      );
      if (collision) {
        const err = new Error("E11000 duplicate key error");
        err.code = 11000;
        throw err;
      }
      const doc = {
        _id: nextId(),
        status: REQUEST_STATUS.PROCESSING,
        ownerToken: null,
        processingExpiresAt: null,
        session: null,
        answer: null,
        intent: null,
        grounding: undefined,
        planCheckpoint: null,
        responseStatus: null,
        responsePayload: null,
        ...attrs,
      };
      store.push(doc);
      return doc;
    },
    async findOneAndUpdate(filter, update, _opts) {
      const doc = store.find((d) => matchesFilter(d, filter));
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      return doc;
    },
    async deleteOne(filter) {
      const idx = store.findIndex((d) => matchesFilter(d, filter));
      if (idx === -1) return { deletedCount: 0 };
      store.splice(idx, 1);
      return { deletedCount: 1 };
    },
    __store: store,
  };
  return model;
}

function loadIdempotencyServiceWithFakeModel() {
  jest.resetModules();
  const fakeModel = createFakeSiaRequestModel();
  jest.doMock("../models/SiaRequest", () => {
    const m = fakeModel;
    m.REQUEST_STATUS = REQUEST_STATUS;
    return m;
  });
  jest.doMock("../sia/config", () => ({ timeoutMs: 8000 }));
  const idempotencyService = require("../sia/idempotencyService");
  return { idempotencyService, fakeModel };
}

afterEach(() => {
  jest.resetModules();
});

const USER_A = "user-a-000000000000000000000001";
const USER_B = "user-b-000000000000000000000002";
const SHARED_CLIENT_MESSAGE_ID = "shared-retry-key-attacker-reuses";

describe("idempotency keys are scoped per-user, never global", () => {
  it("two different users using the SAME clientMessageId each get their OWN OWNED reservation (no CONFLICT, no cross-user coupling)", async () => {
    const { idempotencyService } = loadIdempotencyServiceWithFakeModel();

    const resA = await idempotencyService.reserveRequest({
      userId: USER_A,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });
    const resB = await idempotencyService.reserveRequest({
      userId: USER_B,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      // Deliberately a DIFFERENT question -- if the key were global, this
      question: "What is my top spending category?",
    });

    expect(resA.outcome).toBe(idempotencyService.OUTCOME.OWNED);
    expect(resB.outcome).toBe(idempotencyService.OUTCOME.OWNED);
    expect(String(resA.record._id)).not.toBe(String(resB.record._id));
    expect(resA.ownerToken).not.toBe(resB.ownerToken);
  });

  it("user B can NEVER replay user A's completed answer for the same clientMessageId", async () => {
    const { idempotencyService } = loadIdempotencyServiceWithFakeModel();

    const resA = await idempotencyService.reserveRequest({
      userId: USER_A,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });
    await idempotencyService.markCompleted({
      requestId: resA.record._id,
      ownerToken: resA.ownerToken,
      responseStatus: 200,
      responsePayload: { success: true, answer: "You spent ₹4250 this month (USER A's private answer)." },
      sessionId: null,
    });

    // User B retries with the SAME clientMessageId (an attacker who
    const resB = await idempotencyService.reserveRequest({
      userId: USER_B,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });

    expect(resB.outcome).toBe(idempotencyService.OUTCOME.OWNED);
    expect(resB.record.responsePayload).toBeNull();
    // Never leaks user A's answer text into user B's reservation record.
    expect(JSON.stringify(resB.record)).not.toContain("USER A's private answer");
  });

  it("user B is never blocked as IN_PROGRESS by user A's active, unexpired lease on the same clientMessageId", async () => {
    const { idempotencyService } = loadIdempotencyServiceWithFakeModel();

    // User A reserves and never completes (simulates an in-flight request).
    await idempotencyService.reserveRequest({
      userId: USER_A,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });

    const resB = await idempotencyService.reserveRequest({
      userId: USER_B,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });

    // Must be OWNED (a fresh reservation for B), never IN_PROGRESS (which
    // would mean B is waiting on A's lease) and never CONFLICT.
    expect(resB.outcome).toBe(idempotencyService.OUTCOME.OWNED);
  });

  it("the underlying fake model enforces the real per-(user, clientMessageId) unique index -- same user really is deduplicated", async () => {
    const { idempotencyService } = loadIdempotencyServiceWithFakeModel();

    const first = await idempotencyService.reserveRequest({
      userId: USER_A,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });
    expect(first.outcome).toBe(idempotencyService.OUTCOME.OWNED);

    // Same user, same key, same (fingerprint-normalized) question, while
    const second = await idempotencyService.reserveRequest({
      userId: USER_A,
      clientMessageId: SHARED_CLIENT_MESSAGE_ID,
      question: "How much did I spend this month?",
    });
    expect(second.outcome).toBe(idempotencyService.OUTCOME.IN_PROGRESS);
  });

  it("fingerprintQuestion()/normalizeQuestion() never include the userId -- the fingerprint alone could never be reused to correlate across users", () => {
    const { idempotencyService } = loadIdempotencyServiceWithFakeModel();
    const fp1 = idempotencyService.fingerprintQuestion("How much did I spend this month?");
    const fp2 = idempotencyService.fingerprintQuestion("How much did I spend this month?");
    // Same question -> same fingerprint regardless of which user asks --
    expect(fp1).toBe(fp2);
    expect(typeof fp1).toBe("string");
    expect(fp1).not.toContain(USER_A);
    expect(fp1).not.toContain(USER_B);
  });
});
