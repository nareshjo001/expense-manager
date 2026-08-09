// Batch 3B.1: unit proof of sia/idempotencyService.js's own state machine
// and of models/SiaRequest.js's index declarations.
//
// models/SiaRequest.js is mocked here (same convention as
// tests/sia.sessionService.test.js) -- these tests prove the SERVICE's
// logic: which outcome each prior state produces, that ownership is a real
// compare-and-set, and that a fingerprint mismatch is a conflict. The
// controller-level consequences are proven separately in
// tests/sia.ask.idempotency.test.js.
"use strict";

const MODEL_PATH = "../models/SiaRequest";
const SERVICE_PATH = "../sia/idempotencyService";

const { REQUEST_STATUS } = jest.requireActual("../models/SiaRequest");

function loadService() {
  jest.resetModules();

  const requestDocs = {
    findOne: jest.fn(async () => null),
    create: jest.fn(async (attrs) => ({ _id: "req-1", ...attrs })),
    findOneAndUpdate: jest.fn(async () => null),
    deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
  };
  requestDocs.REQUEST_STATUS = REQUEST_STATUS;

  jest.doMock(MODEL_PATH, () => requestDocs);
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", timeoutMs: 8000 }));

  const service = require(SERVICE_PATH);
  return { service, requestDocs };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const BASE = { userId: "user-1", clientMessageId: "key-1", question: "Why is my financial health low?" };

describe("sia/idempotencyService -- question normalization and fingerprinting", () => {
  it("treats cosmetically identical questions as the same request", () => {
    const { service } = loadService();
    expect(service.fingerprintQuestion("  Why   is my  health low? ")).toBe(
      service.fingerprintQuestion("Why is my health low?")
    );
  });

  it("treats a materially different question as a different request", () => {
    const { service } = loadService();
    expect(service.fingerprintQuestion("Why is my health low?")).not.toBe(
      service.fingerprintQuestion("Why did my spending increase?")
    );
  });

  it("is case-sensitive -- a differently-cased question is never silently replayed", () => {
    const { service } = loadService();
    expect(service.fingerprintQuestion("Why is my health low?")).not.toBe(
      service.fingerprintQuestion("why is my health low?")
    );
  });

  it("never stores the question text itself, only a hex digest", () => {
    const { service } = loadService();
    const digest = service.fingerprintQuestion("Why is my health low?");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("health");
  });
});

describe("sia/idempotencyService -- reserveRequest outcomes", () => {
  it("OWNED with a fresh owner token when no prior request exists", async () => {
    const { service, requestDocs } = loadService();

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.OWNED);
    expect(typeof result.ownerToken).toBe("string");
    expect(requestDocs.create).toHaveBeenCalledTimes(1);
    const [attrs] = requestDocs.create.mock.calls[0];
    expect(attrs.status).toBe(REQUEST_STATUS.PROCESSING);
    expect(attrs.user).toBe("user-1");
    expect(attrs.processingExpiresAt instanceof Date).toBe(true);
  });

  it("REPLAY_COMPLETED when a completed record with the same fingerprint exists", async () => {
    const { service, requestDocs } = loadService();
    const { fingerprintQuestion } = service;
    requestDocs.findOne.mockResolvedValue({
      _id: "req-1",
      status: REQUEST_STATUS.COMPLETED,
      questionFingerprint: fingerprintQuestion(BASE.question),
      responseStatus: 200,
      responsePayload: { success: true, answer: "stored" },
      session: null,
    });

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.REPLAY_COMPLETED);
    expect(result.record.responsePayload.answer).toBe("stored");
    expect(requestDocs.create).not.toHaveBeenCalled();
  });

  it("CONFLICT when the fingerprint differs, regardless of prior state", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOne.mockResolvedValue({
      _id: "req-1",
      status: REQUEST_STATUS.COMPLETED,
      questionFingerprint: "a-totally-different-digest",
      session: null,
    });

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.CONFLICT);
    expect(requestDocs.create).not.toHaveBeenCalled();
  });

  it("CONFLICT when an explicit sessionId disagrees with the stored session", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOne.mockResolvedValue({
      _id: "req-1",
      status: REQUEST_STATUS.COMPLETED,
      questionFingerprint: service.fingerprintQuestion(BASE.question),
      session: "64f1a2b3c4d5e6f7a8b9c0d1",
    });

    const result = await service.reserveRequest({
      ...BASE,
      requestedSessionId: "64f1a2b3c4d5e6f7a8b9c0d2",
    });

    expect(result.outcome).toBe(service.OUTCOME.CONFLICT);
  });

  it("an OMITTED sessionId never conflicts with a stored session -- that is the recovery path", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOne.mockResolvedValue({
      _id: "req-1",
      status: REQUEST_STATUS.COMPLETED,
      questionFingerprint: service.fingerprintQuestion(BASE.question),
      session: "64f1a2b3c4d5e6f7a8b9c0d1",
      responseStatus: 200,
      responsePayload: { success: true },
    });

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.REPLAY_COMPLETED);
  });

  it("IN_PROGRESS when another owner holds an unexpired lease", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOne.mockResolvedValue({
      _id: "req-1",
      status: REQUEST_STATUS.PROCESSING,
      questionFingerprint: service.fingerprintQuestion(BASE.question),
      ownerToken: "someone-else",
      processingExpiresAt: new Date(Date.now() + 60000),
      session: null,
    });

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.IN_PROGRESS);
    // A follower must never take ownership while the lease is live.
    expect(requestDocs.findOneAndUpdate).not.toHaveBeenCalled();
    expect(requestDocs.create).not.toHaveBeenCalled();
  });

  it("OWNED via atomic takeover when the prior lease has EXPIRED", async () => {
    const { service, requestDocs } = loadService();
    const stale = {
      _id: "req-1",
      status: REQUEST_STATUS.PROCESSING,
      questionFingerprint: service.fingerprintQuestion(BASE.question),
      ownerToken: "crashed-owner",
      processingExpiresAt: new Date(Date.now() - 60000),
      session: null,
    };
    requestDocs.findOne.mockResolvedValue(stale);
    requestDocs.findOneAndUpdate.mockResolvedValue({ ...stale, ownerToken: "new-owner" });

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.OWNED);
    // The compare-and-set filter must pin the EXACT prior owner token, so
    // two racing takeovers cannot both succeed.
    const [filter] = requestDocs.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ _id: "req-1", ownerToken: "crashed-owner", status: REQUEST_STATUS.PROCESSING });
  });

  it("IN_PROGRESS when the takeover compare-and-set loses the race", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOne.mockResolvedValue({
      _id: "req-1",
      status: REQUEST_STATUS.PROCESSING,
      questionFingerprint: service.fingerprintQuestion(BASE.question),
      ownerToken: "crashed-owner",
      processingExpiresAt: new Date(Date.now() - 60000),
      session: null,
    });
    requestDocs.findOneAndUpdate.mockResolvedValue(null); // someone else won

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.IN_PROGRESS);
  });

  it("RESUME_ANSWER_READY takes ownership of a stored, validated answer", async () => {
    const { service, requestDocs } = loadService();
    const ready = {
      _id: "req-1",
      status: REQUEST_STATUS.ANSWER_READY,
      questionFingerprint: service.fingerprintQuestion(BASE.question),
      ownerToken: "prior-owner",
      answer: "Already validated.",
      intent: "HEALTH_EXPLANATION",
      session: null,
    };
    requestDocs.findOne.mockResolvedValue(ready);
    requestDocs.findOneAndUpdate.mockResolvedValue({ ...ready, ownerToken: "new-owner" });

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.RESUME_ANSWER_READY);
    expect(result.record.answer).toBe("Already validated.");
  });

  it("a concurrent E11000 on create makes this caller a follower, not a second owner", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOne
      .mockResolvedValueOnce(null) // nothing yet when we looked
      .mockResolvedValueOnce({
        _id: "req-winner",
        status: REQUEST_STATUS.PROCESSING,
        questionFingerprint: service.fingerprintQuestion(BASE.question),
        ownerToken: "winner",
        processingExpiresAt: new Date(Date.now() + 60000),
        session: null,
      });
    requestDocs.create.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
    );

    const result = await service.reserveRequest(BASE);

    expect(result.outcome).toBe(service.OUTCOME.IN_PROGRESS);
  });

  it("rethrows a genuine (non-duplicate) create failure instead of silently proceeding", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.create.mockRejectedValue(new Error("real database failure"));

    await expect(service.reserveRequest(BASE)).rejects.toThrow("real database failure");
  });
});

describe("sia/idempotencyService -- state transitions are ownership-gated", () => {
  it("markAnswerReady compare-and-sets on the owner token", async () => {
    const { service, requestDocs } = loadService();

    await service.markAnswerReady({
      requestId: "req-1",
      ownerToken: "owner-a",
      answer: "A",
      intent: "HEALTH_EXPLANATION",
      sessionId: null,
    });

    const [filter, update] = requestDocs.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: "req-1", ownerToken: "owner-a" });
    expect(update.$set.status).toBe(REQUEST_STATUS.ANSWER_READY);
    expect(update.$set.answer).toBe("A");
  });

  it("markCompleted stores the exact payload and clears the lease", async () => {
    const { service, requestDocs } = loadService();
    const payload = { success: true, answer: "A", intent: "HEALTH_EXPLANATION", basedOn: ["financialHealth"] };

    await service.markCompleted({
      requestId: "req-1",
      ownerToken: "owner-a",
      responseStatus: 200,
      responsePayload: payload,
      sessionId: "64f1a2b3c4d5e6f7a8b9c0d1",
    });

    const [filter, update] = requestDocs.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: "req-1", ownerToken: "owner-a" });
    expect(update.$set.status).toBe(REQUEST_STATUS.COMPLETED);
    expect(update.$set.responsePayload).toEqual(payload);
    expect(update.$set.ownerToken).toBeNull();
    expect(update.$set.processingExpiresAt).toBeNull();
  });

  it("releaseRequest only deletes a reservation this caller actually owns", async () => {
    const { service, requestDocs } = loadService();

    await service.releaseRequest({ requestId: "req-1", ownerToken: "owner-a" });

    expect(requestDocs.deleteOne).toHaveBeenCalledWith({ _id: "req-1", ownerToken: "owner-a" });
  });
});

describe("sia/idempotencyService -- lease bounds", () => {
  it("the processing lease is derived from the ACTUAL provider timeout, not a hard-coded constant", () => {
    const { service } = loadService();
    // config.timeoutMs is mocked to 8000 above.
    expect(service.LEASE_MS()).toBe(8000 + 7000);
  });

  it("a follower's bounded wait never exceeds the provider timeout", () => {
    const { service } = loadService();
    expect(service.FOLLOWER_WAIT_MS()).toBeLessThanOrEqual(8000);
  });
});

describe("models/SiaRequest -- index declarations", () => {
  it("declares the UNIQUE user-scoped idempotency index", () => {
    const SiaRequest = jest.requireActual("../models/SiaRequest");
    const indexes = SiaRequest.schema.indexes();
    const idempotencyIndex = indexes.find(([spec]) => "user" in spec && "clientMessageId" in spec);

    expect(idempotencyIndex).toBeDefined();
    const [spec, options] = idempotencyIndex;
    expect(spec).toEqual({ user: 1, clientMessageId: 1 });
    expect(options.unique).toBe(true);
  });

  it("declares a bounded-retention TTL index far longer than any processing lease", () => {
    const SiaRequest = jest.requireActual("../models/SiaRequest");
    const indexes = SiaRequest.schema.indexes();
    const ttlIndex = indexes.find(([, options]) => options && options.expireAfterSeconds);

    expect(ttlIndex).toBeDefined();
    const [, options] = ttlIndex;
    // Hours, not seconds -- so it can never delete an actively processing
    // request, whose lease is bounded by the provider timeout.
    expect(options.expireAfterSeconds).toBeGreaterThan(60 * 60);
  });
});
