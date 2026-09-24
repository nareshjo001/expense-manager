// PRV-001-T03 (ADR-0007) -- re-authenticated deletion request/cancel/status
// controller. Follows the exact controller-unit-test pattern already
// established in tests/auth.recoverySecurity.test.js (jest.doMock on
// Schemas/password.service, require the controller fresh per test, call it
// directly with a fake req/res) rather than a full supertest app, since
// that is the pattern this codebase already uses for AuthControllers.

const makeReq = (body, userId = "user-1") => ({
  body,
  userId,
  ip: "203.0.113.10",
  get: jest.fn(() => "request-prv-001"),
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const responseBody = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

// A minimal chainable query mock: supports both `await
// UserModel.findById(id)` directly (requestDeletion) and
// `UserModel.findById(id).select(...).lean()` (getDeletionStatus), both
// resolving to the same `user`.
const makeUserQuery = (user) => {
  const query = {
    select: jest.fn(() => query),
    lean: jest.fn(async () => user),
    then: (resolve, reject) => Promise.resolve(user).then(resolve, reject),
  };
  return query;
};

const loadController = ({ user, passwordMatches, findOneAndUpdateResult }) => {
  const UserModel = {
    findById: jest.fn(() => makeUserQuery(user)),
    findOneAndUpdate: jest.fn(async () => findOneAndUpdateResult),
  };
  const comparePasswordOrDummy = jest.fn(async () => passwordMatches);
  // PRV-001-T05 -- Tier A's own behaviour (session revocation, device-token
  // deletion, cache clear) is covered directly by
  // accountDeletionTierASteps.test.js; here it is mocked so this suite
  // stays focused on requestDeletion's OWN logic (and so it never touches
  // a real, unconnected Mongoose model via the real session.service.js).
  const runTierAImmediate = jest.fn(async () => {});
  jest.doMock("../config/Schemas", () => ({ UserModel }));
  jest.doMock("../Services/AuthServices/password.service", () => ({ comparePasswordOrDummy }));
  jest.doMock("../Services/PrivacyServices/accountDeletionTierASteps", () => ({ runTierAImmediate }));
  const controller = require("../Controllers/AuthControllers/accountDeletion");
  return { ...controller, UserModel, comparePasswordOrDummy, runTierAImmediate };
};

describe("PRV-001-T03 requestDeletion", () => {
  test("rejects an unknown user with the same response as a wrong password (enumeration-resistant)", async () => {
    const unknown = loadController({ user: null, passwordMatches: false, findOneAndUpdateResult: null });
    const unknownRes = makeRes();
    await unknown.requestDeletion(makeReq({ password: "password123" }), unknownRes);

    jest.resetModules();
    const wrong = loadController({
      user: { _id: "user-1", email: "known@example.com", password: "hash", deletionRequestedAt: null },
      passwordMatches: false,
      findOneAndUpdateResult: null,
    });
    const wrongRes = makeRes();
    await wrong.requestDeletion(makeReq({ password: "password123" }), wrongRes);

    expect(unknownRes.status).toHaveBeenCalledWith(401);
    expect(wrongRes.status).toHaveBeenCalledWith(401);
    expect(responseBody(unknownRes)).toEqual(responseBody(wrongRes));
    expect(responseBody(wrongRes).code).toBe("INVALID_CURRENT_PASSWORD");
  });

  test("schedules deletion 14 days out on a correct password with no prior pending request", async () => {
    const requestedUser = {
      _id: "user-1",
      email: "known@example.com",
      password: "hash",
      deletionRequestedAt: null,
    };
    const updated = {
      _id: "user-1",
      deletionRequestedAt: new Date("2026-09-20T00:00:00.000Z"),
      deletionScheduledPurgeAt: new Date("2026-10-04T00:00:00.000Z"),
    };
    const { requestDeletion, UserModel, DELETION_GRACE_PERIOD_MS, runTierAImmediate } = loadController({
      user: requestedUser,
      passwordMatches: true,
      findOneAndUpdateResult: updated,
    });

    expect(DELETION_GRACE_PERIOD_MS).toBe(14 * 24 * 60 * 60 * 1000);

    const res = makeRes();
    await requestDeletion(makeReq({ password: "correct-password" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = responseBody(res);
    expect(body.success).toBe(true);
    expect(body.scheduledPurgeAt).toEqual(updated.deletionScheduledPurgeAt);

    // The guard in the update filter must match the guard already checked
    // on the pre-read -- both null-check the same field, not just one.
    const [filter, update] = UserModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: "user-1", deletionRequestedAt: null });
    expect(update.$set.deletionRequestedAt).toBeInstanceOf(Date);
    expect(update.$set.deletionScheduledPurgeAt.getTime() - update.$set.deletionRequestedAt.getTime()).toBe(
      14 * 24 * 60 * 60 * 1000
    );

    // PRV-001-T05 -- Tier A fires once the write has succeeded, scoped to
    // the just-updated user's id.
    expect(runTierAImmediate).toHaveBeenCalledWith("user-1");
  });

  test("rejects with 409 when the pre-read already shows a pending deletion", async () => {
    const { requestDeletion, UserModel } = loadController({
      user: { _id: "user-1", email: "known@example.com", password: "hash", deletionRequestedAt: new Date() },
      passwordMatches: true,
      findOneAndUpdateResult: null,
    });

    const res = makeRes();
    await requestDeletion(makeReq({ password: "correct-password" }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(responseBody(res).code).toBe("DELETION_ALREADY_PENDING");
    // Never even attempted the write once the pre-read already showed pending.
    expect(UserModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("rejects with 409 when a concurrent request wins the race (findOneAndUpdate guard misses)", async () => {
    // Pre-read shows no pending deletion, but the guarded update returns
    // null because a concurrent request already set it between the read
    // and this write -- the atomic guard, not the pre-read, is what must
    // prevent a double-schedule.
    const { requestDeletion } = loadController({
      user: { _id: "user-1", email: "known@example.com", password: "hash", deletionRequestedAt: null },
      passwordMatches: true,
      findOneAndUpdateResult: null,
    });

    const res = makeRes();
    await requestDeletion(makeReq({ password: "correct-password" }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(responseBody(res).code).toBe("DELETION_ALREADY_PENDING");
  });

  test("never fires Tier A on any denied/rejected path (unknown user, wrong password, or already pending)", async () => {
    const scenarios = [
      { user: null, passwordMatches: false, findOneAndUpdateResult: null },
      {
        user: { _id: "user-1", email: "known@example.com", password: "hash", deletionRequestedAt: null },
        passwordMatches: false,
        findOneAndUpdateResult: null,
      },
      {
        user: { _id: "user-1", email: "known@example.com", password: "hash", deletionRequestedAt: new Date() },
        passwordMatches: true,
        findOneAndUpdateResult: null,
      },
    ];

    for (const scenario of scenarios) {
      const { requestDeletion, runTierAImmediate } = loadController(scenario);
      await requestDeletion(makeReq({ password: "whatever" }), makeRes());
      expect(runTierAImmediate).not.toHaveBeenCalled();
      jest.resetModules();
    }
  });
});

describe("PRV-001-T03 cancelDeletion", () => {
  test("returns 409 when nothing is pending", async () => {
    const { cancelDeletion, UserModel } = loadController({
      user: null,
      passwordMatches: false,
      findOneAndUpdateResult: null,
    });

    const res = makeRes();
    await cancelDeletion(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(responseBody(res).code).toBe("NO_DELETION_PENDING");
    expect(UserModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: "user-1",
      deletionRequestedAt: { $ne: null },
    });
  });

  test("clears both markers when a deletion is pending", async () => {
    const { cancelDeletion, UserModel } = loadController({
      user: null,
      passwordMatches: false,
      findOneAndUpdateResult: { email: "known@example.com", deletionRequestedAt: null, deletionScheduledPurgeAt: null },
    });

    const res = makeRes();
    await cancelDeletion(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res).success).toBe(true);
    const update = UserModel.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toEqual({ deletionRequestedAt: null, deletionScheduledPurgeAt: null });
  });
});

describe("PRV-001-T03 getDeletionStatus", () => {
  test("reports pending:false when no deletion is scheduled", async () => {
    const { getDeletionStatus } = loadController({
      user: { deletionRequestedAt: null, deletionScheduledPurgeAt: null },
      passwordMatches: false,
      findOneAndUpdateResult: null,
    });

    const res = makeRes();
    await getDeletionStatus(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual({
      success: true,
      pending: false,
      deletionRequestedAt: null,
      scheduledPurgeAt: null,
    });
  });

  test("reports pending:true with the scheduled purge date when a deletion is scheduled", async () => {
    const requestedAt = new Date("2026-09-20T00:00:00.000Z");
    const scheduledPurgeAt = new Date("2026-10-04T00:00:00.000Z");
    const { getDeletionStatus } = loadController({
      user: { deletionRequestedAt: requestedAt, deletionScheduledPurgeAt: scheduledPurgeAt },
      passwordMatches: false,
      findOneAndUpdateResult: null,
    });

    const res = makeRes();
    await getDeletionStatus(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = responseBody(res);
    expect(body.pending).toBe(true);
    expect(body.scheduledPurgeAt).toEqual(scheduledPurgeAt);
  });

  test("returns 401 when the user record is missing", async () => {
    const { getDeletionStatus } = loadController({
      user: null,
      passwordMatches: false,
      findOneAndUpdateResult: null,
    });

    const res = makeRes();
    await getDeletionStatus(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("PRV-001-T03 requestDeletionValidation", () => {
  test("rejects a missing password", () => {
    const { requestDeletionValidation } = require("../Middlewares/AuthValidation");
    const req = makeReq({});
    const res = makeRes();
    const next = jest.fn();

    requestDeletionValidation(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts a present password and calls next", () => {
    const { requestDeletionValidation } = require("../Middlewares/AuthValidation");
    const req = makeReq({ password: "anything" });
    const res = makeRes();
    const next = jest.fn();

    requestDeletionValidation(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
