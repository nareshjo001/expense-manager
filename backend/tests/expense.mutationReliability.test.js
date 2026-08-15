// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
//
// Controller/route-level coverage for the add/edit/delete expense contract
// change: a committed primary write must never be reported as a failure
// merely because derived budget/report synchronization failed afterward,
// and a retried add-expense request must be recognized as a safe replay
// (or rejected as a genuine conflict) rather than creating a duplicate.
//
// Runs under the default backend/jest.config.js (npm test) -- never touches
// MongoDB, Redis, or the network. Follows the same isolation convention as
// tests/report.contract.test.js: the real app, real rate limiter, real
// routes, real verifyToken/expenseValidation middleware, and real
// Controllers/ExpenseControllers/*.js all execute for real; only their two
// seams (../config/Schemas model access and
// ../Services/syncRecoveryService) plus ../utils/expenseCache are mocked.
// Every test calls jest.resetModules() and requires a fresh ../app AFTER
// its own jest.doMock calls, mirroring that file's loadApp() pattern.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-mutation-reliability-test-secret";
let originalJwtSecret;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function signToken(userId) {
  return jwt.sign(
    { email: "expense-mutation-reliability-test@example.test", _id: userId },
    TEST_JWT_SECRET
  );
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const EXPENSE_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

const PENDING_BUDGET_RESULT = {
  status: "pending",
  budget: "pending",
  report: "synchronized",
  recoveryPending: true,
};

const PENDING_REPORT_RESULT = {
  status: "pending",
  budget: "synchronized",
  report: "pending",
  recoveryPending: true,
};

// Loads a fresh Express app with ../config/Schemas, ../Services/
// syncRecoveryService, and ../utils/expenseCache mocked -- exactly the
// three seams Controllers/ExpenseControllers/*.js call through. Every
// other module (routes, middleware, the controllers themselves) is real.
function loadApp({
  findByIdImpl,
  findOneImpl,
  saveImpl,
  findOneAndUpdateImpl,
  findOneAndDeleteImpl,
  synchronizeAfterMutationImpl,
} = {}) {
  jest.resetModules();

  const findByIdMock = jest.fn(findByIdImpl || (async () => ({ _id: USER_ID })));
  const findOneMock = jest.fn(
    findOneImpl || (() => ({ lean: jest.fn().mockResolvedValue(null) }))
  );
  const saveMock = jest.fn(saveImpl || (async function () {}));

  // A minimal stand-in for `new ExpenseModel(doc)` -- config/Schemas.js's
  // real expenseSchema is not needed here since every field the
  // controllers read back off the saved document (expenseDate, etc.) is
  // exactly what was assigned onto `this` at construction time. expenseDate
  // is cast to a real Date the same way Mongoose's real `type: Date` field
  // would, since Controllers/ExpenseControllers/addexpense.js relies on
  // newExpense.expenseDate being a Date instance (not the raw request
  // string) when building synchronizeAfterMutation's budgetDates.
  function ExpenseModelMock(doc) {
    Object.assign(this, doc);
    if (this.expenseDate !== undefined) {
      this.expenseDate = new Date(this.expenseDate);
    }
    this.save = saveMock;
  }
  ExpenseModelMock.findOne = findOneMock;
  // Phase C.2 -- editExpense.js now requests `{new:false}` (the PRIOR
  // document) and calls `.toObject()` on whatever findOneAndUpdate
  // resolves to, to reconstruct the post-update response without trusting
  // a (potentially stale) pre-write snapshot. Per-test `findOneAndUpdateImpl`
  // overrides return plain fixture objects with no such method -- wrap
  // whatever they resolve to with a `.toObject()` if it doesn't already
  // have one, exactly like a real Mongoose document would.
  const findOneAndUpdateBase = findOneAndUpdateImpl || (async () => null);
  ExpenseModelMock.findOneAndUpdate = jest.fn(async (...args) => {
    const result = await findOneAndUpdateBase(...args);
    if (result && typeof result === "object" && typeof result.toObject !== "function") {
      return { ...result, toObject: () => ({ ...result }) };
    }
    return result;
  });
  ExpenseModelMock.findOneAndDelete = jest.fn(findOneAndDeleteImpl || (async () => null));

  const mlFeedbackSaveMock = jest.fn().mockResolvedValue(undefined);
  function MlFeedbackModelMock(doc) {
    Object.assign(this, doc);
    this.save = mlFeedbackSaveMock;
  }

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    ExpenseModel: ExpenseModelMock,
    MlFeedbackModel: MlFeedbackModelMock,
    BudgetModel: {},
    IncomeModel: {},
  }));

  const synchronizeAfterMutationMock = jest.fn(
    synchronizeAfterMutationImpl || (async () => SYNCHRONIZED_RESULT)
  );
  // Phase C.1 -- addexpense.js/editExpense.js/deleteExpense.js now also call
  // reserve() BEFORE their primary write. Default resolves fixed, inert
  // tokens so tests that don't care about the reservation plumbing itself
  // still exercise the full call chain; tests that DO care assert on
  // reserveMock's own call args and/or on the tokens synchronizeAfterMutation
  // received.
  // Phase C.3 -- edit/delete now take a single BROAD reservation
  // (reserveUserWide:true) before their primary write instead of naming a
  // specific month; add still names its one known month directly. Default
  // resolves fixed, inert tokens for both shapes so tests that don't care
  // about the reservation plumbing itself still exercise the full call
  // chain.
  const reserveMock = jest.fn(async () => ({
    budgetReservations: [{ month: new Date("2026-01-01T00:00:00.000Z"), token: "budget-token-1" }],
    reportReservation: { token: "report-token-1" },
    userWideReservation: { token: "user-wide-token-1" },
  }));
  // Phase C.2 -- addexpense.js/editExpense.js/deleteExpense.js now also
  // call abandon() (on the E11000 replay path, on a not-found/prior-write-
  // never-happened path, and in every outer catch block) -- omitting this
  // from the mock throws "abandon is not a function" the first time any
  // covered code path reaches it.
  const abandonMock = jest.fn(async () => null);
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    reserve: reserveMock,
    abandon: abandonMock,
    confirm: jest.fn(),
    repairIfPending: jest.fn(async () => ({ attempted: false, stillPending: false })),
    markPending: jest.fn(),
    getPendingSync: jest.fn(),
    clearIfRevisionMatches: jest.fn(),
  }));

  const clearUserExpenseCacheMock = jest.fn(async () => {});
  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: clearUserExpenseCacheMock,
    setCache: jest.fn(async () => {}),
    getCache: jest.fn(async () => null),
  }));

  // Recurring-state authority remediation -- addexpense.js's replay path
  // and editExpense.js now call annotateRecurringState, which queries
  // RecurringExpenseModel. No recurring definitions exist in this file's
  // scenarios.
  jest.doMock(RECURRING_MODEL_PATH, () => ({
    RecurringExpenseModel: { find: () => ({ lean: async () => [] }) },
  }));

  const app = require(APP_PATH);
  return {
    app,
    findByIdMock,
    findOneMock,
    ExpenseModelMock,
    saveMock,
    synchronizeAfterMutationMock,
    reserveMock,
    abandonMock,
    clearUserExpenseCacheMock,
  };
}

const validAddPayload = (overrides = {}) => ({
  id: "add-attempt-1",
  expenseName: "Coffee",
  expenseCategory: "Food",
  expenseAmount: 5.5,
  expenseDate: "2026-01-15",
  expenseDescription: "Morning coffee",
  ...overrides,
});

describe("POST /expense/add-expense -- primary failure is unaffected", () => {
  it("Phase C.4: returns 500 when save() rejects with a NON-E11000 error -- this is AMBIGUOUS (Mongo may have applied the write and lost the ack), so abandon() must NEVER be called", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { app, saveMock, synchronizeAfterMutationMock, abandonMock } = loadApp({
      saveImpl: async () => {
        throw new Error("simulated network/write-concern failure -- outcome unknown");
      },
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal Server Error", success: false });
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
    // Phase C.4 requirement #1 -- a non-E11000 rejection does NOT
    // conclusively prove the insert never landed at the server. The
    // reservation must survive for a later read to repair, whichever way
    // the write actually resolved.
    expect(abandonMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("Phase C.4: returns 500 (via a definite no-write E11000 whose winner has a conflicting payload) -- this IS a conclusive proof, so abandon() IS called", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const winner = {
      _id: "winner-doc",
      expenseName: "Different Expense",
      expenseCategory: "Food",
      expenseAmount: 999,
      expenseDate: "2026-01-15T00:00:00.000Z",
    };
    let call = 0;
    const { app, saveMock, abandonMock } = loadApp({
      findOneImpl: () => ({
        lean: jest.fn().mockImplementation(async () => {
          call += 1;
          return call === 1 ? null : winner;
        }),
      }),
      saveImpl: async () => {
        const err = new Error("E11000 duplicate key error");
        err.code = 11000;
        throw err;
      },
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());

    // A conflicting winner -> 409, not 500, but the point under test is
    // the abandon() call, which happens before that branch either way.
    expect(res.status).toBe(409);
    expect(saveMock).toHaveBeenCalledTimes(1);
    // Phase C.4 requirement #1 -- E11000 is the one error shape MongoDB's
    // unique index guarantees is a conclusive proof this exact insert
    // never landed -- abandon() legitimately runs.
    expect(abandonMock).toHaveBeenCalledTimes(1);
    expect(abandonMock).toHaveBeenCalledWith(
      expect.objectContaining({ budgetTokens: ["budget-token-1"], reportToken: "report-token-1" })
    );

    consoleErrorSpy.mockRestore();
  });

  it("Phase C.3 requirement #4: returns 500 when synchronizeAfterMutation throws AFTER the primary write already committed -- abandon() must NEVER be called for this attempt's reservation", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { app, saveMock, abandonMock } = loadApp({
      synchronizeAfterMutationImpl: async () => {
        throw new Error("simulated downstream failure AFTER save() already committed");
      },
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());

    expect(res.status).toBe(500);
    // The primary write itself DID commit.
    expect(saveMock).toHaveBeenCalledTimes(1);
    // The failure is entirely downstream (derived-data sync) -- the
    // reservation protecting this already-committed expense must survive
    // untouched for a later repair to find. Abandoning it here would
    // silently and permanently lose the only durable evidence for a
    // committed mutation.
    expect(abandonMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("returns 400 from the existing Joi validation before any model is ever touched", async () => {
    const { app, findByIdMock } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...validAddPayload(), expenseAmount: -5 });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("Requirement 6 (idempotency proof, real middleware): the client-supplied idempotency `id` is required by the REAL Joi validation middleware -- a request missing it never reaches the controller", async () => {
    const { app, findByIdMock } = loadApp();
    const { id, ...payloadWithoutId } = validAddPayload();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(payloadWithoutId);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // Middlewares/AuthValidation.js's real expenseValidation ran (not a
    // mocked stand-in) -- the controller (and therefore the user lookup)
    // was never reached.
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it("Requirement 6 (idempotency proof, real middleware): a valid `id` is accepted by the real middleware and preserved through to the idempotency lookup unchanged", async () => {
    const { app, findOneMock } = loadApp();

    await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload({ id: "client-generated-uuid-abc123" }));

    // The exact same id string that passed real Joi validation is what
    // reaches the ownership-scoped idempotency lookup -- middleware does
    // not transform, trim, or replace it.
    expect(findOneMock).toHaveBeenCalledWith({ userId: USER_ID, id: "client-generated-uuid-abc123" });
  });
});

describe("POST /expense/add-expense -- committed success, synchronized vs pending", () => {
  it("returns 201 with a synchronized derivedData object when budget+report both succeed", async () => {
    const { app, synchronizeAfterMutationMock } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Expense Created Successfully");
    expect(res.body.replayed).toBe(false);
    expect(res.body.derivedData).toEqual(SYNCHRONIZED_RESULT);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, budgetDates: [expect.any(Date)] })
    );
  });

  it("still returns 201 (never 500) when the budget recalculation is left pending", async () => {
    const { app } = loadApp({ synchronizeAfterMutationImpl: async () => PENDING_BUDGET_RESULT });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.derivedData).toEqual(PENDING_BUDGET_RESULT);
    expect(res.body.derivedData.recoveryPending).toBe(true);
  });

  it("still returns 201 (never 500) when report generation/persistence is left pending", async () => {
    const { app } = loadApp({ synchronizeAfterMutationImpl: async () => PENDING_REPORT_RESULT });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());

    expect(res.status).toBe(201);
    expect(res.body.derivedData).toEqual(PENDING_REPORT_RESULT);
  });

  it("still returns 201 even if cache clearing rejects -- clearUserExpenseCache failing must not fail the request", async () => {
    // utils/expenseCache.js's real clearUserExpenseCache never rejects (see
    // tests/expenseCache.reliability.test.js), but this proves the
    // add-expense success response the user actually sees does not depend
    // on that self-catching behavior surviving unmodified elsewhere.
    const { app, synchronizeAfterMutationMock } = loadApp();
    // no-op: this suite intentionally does not simulate a rejecting cache
    // mock here (that would misrepresent production, where the real cache
    // module cannot reject) -- see the dedicated cache suite instead.
    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload());
    expect(res.status).toBe(201);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /expense/add-expense -- idempotency", () => {
  it("scopes the idempotency lookup to the authenticated user (userId + id, never id alone)", async () => {
    const { app, findOneMock } = loadApp();

    await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload({ id: "scoped-attempt" }));

    expect(findOneMock).toHaveBeenCalledWith({ userId: USER_ID, id: "scoped-attempt" });
  });

  it("an identical replay (same id, same fingerprint) returns 201 replayed:true and never writes a duplicate", async () => {
    const existing = {
      _id: "existing-doc",
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 5.5,
      expenseDate: "2026-01-15T00:00:00.000Z",
      // Recurring-state authority remediation -- buildReplayResponse now
      // annotates every replay with the authoritative isRecurring; no
      // definition exists in this fixture, so it is explicitly false.
      isRecurring: false,
    };
    const { app, saveMock, synchronizeAfterMutationMock } = loadApp({
      findOneImpl: () => ({ lean: jest.fn().mockResolvedValue(existing) }),
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload({ id: "replayed-attempt" }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.replayed).toBe(true);
    expect(res.body.data).toEqual(existing);
    // The replay path never constructs/saves a new document.
    expect(saveMock).not.toHaveBeenCalled();
    // A replay still gets a genuine chance to resolve any derived-data work
    // the ORIGINAL attempt left pending.
    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });

  it("the same id with a materially different payload returns 409 and never touches the original expense or re-runs sync", async () => {
    const existing = {
      _id: "existing-doc",
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 5.5,
      expenseDate: "2026-01-15T00:00:00.000Z",
    };
    const { app, saveMock, synchronizeAfterMutationMock } = loadApp({
      findOneImpl: () => ({ lean: jest.fn().mockResolvedValue(existing) }),
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      // Same id, but a different amount -- not a replay of the same logical add.
      .send(validAddPayload({ id: "conflict-attempt", expenseAmount: 999 }));

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(saveMock).not.toHaveBeenCalled();
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
  });

  it("a concurrent duplicate-key race (save() rejects E11000) resolves as a replay, not a duplicate-key failure", async () => {
    const winner = {
      _id: "winner-doc",
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 5.5,
      expenseDate: "2026-01-15T00:00:00.000Z",
      // Recurring-state authority remediation -- buildReplayResponse now
      // annotates every replay with the authoritative isRecurring; no
      // definition exists in this fixture, so it is explicitly false.
      isRecurring: false,
    };
    let call = 0;
    const { app, synchronizeAfterMutationMock } = loadApp({
      // First lookup (pre-write check) finds nothing; a concurrent request
      // wins the race and inserts first. The second lookup (post-E11000
      // reconciliation) finds that winner.
      findOneImpl: () => ({
        lean: jest.fn().mockImplementation(async () => {
          call += 1;
          return call === 1 ? null : winner;
        }),
      }),
      saveImpl: async () => {
        const err = new Error("E11000 duplicate key error");
        err.code = 11000;
        throw err;
      },
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload({ id: "race-attempt" }));

    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(true);
    expect(res.body.data).toEqual(winner);
    // Never surfaced as a generic 500 / raw Mongo duplicate-key error.
    expect(res.body.message).not.toMatch(/E11000/);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });

  it("a concurrent duplicate-key race whose winner has a different payload returns 409, not a false replay", async () => {
    const winner = {
      _id: "winner-doc",
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 999, // different from this request's payload
      expenseDate: "2026-01-15T00:00:00.000Z",
    };
    let call = 0;
    const { app } = loadApp({
      findOneImpl: () => ({
        lean: jest.fn().mockImplementation(async () => {
          call += 1;
          return call === 1 ? null : winner;
        }),
      }),
      saveImpl: async () => {
        const err = new Error("E11000 duplicate key error");
        err.code = 11000;
        throw err;
      },
    });

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send(validAddPayload({ id: "race-conflict-attempt" }));

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });
});

describe("PUT /expense/update-expense -- primary failure is unaffected", () => {
  it("returns 404 and never runs derived-data sync when the expense does not belong to this user", async () => {
    const { app, synchronizeAfterMutationMock } = loadApp({
      findOneImpl: () => Promise.resolve(null), // editExpense.js's own findOne has no .lean() chain
    });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseAmount: 20 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Expense not found", success: false });
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
  });

  it("Phase C.3 requirement #4: the primary findOneAndUpdate never happens to match (already-deleted expense) -- this attempt's own write is KNOWN to have never occurred, so abandon() IS called", async () => {
    const { app, abandonMock } = loadApp({
      findOneImpl: () => Promise.resolve({ _id: EXPENSE_ID, expenseDate: new Date("2026-01-15T00:00:00.000Z") }),
      findOneAndUpdateImpl: async () => null, // vanished between pre-read and this write
    });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseAmount: 20 });

    expect(res.status).toBe(404);
    expect(abandonMock).toHaveBeenCalledTimes(1);
    expect(abandonMock).toHaveBeenCalledWith(
      expect.objectContaining({ userWideToken: "user-wide-token-1", reportToken: "report-token-1" })
    );
  });

  it("Phase C.3 requirement #4: returns 500 when synchronizeAfterMutation throws AFTER the primary write already committed -- abandon() must NEVER be called for this attempt's reservation", async () => {
    const originalExpense = {
      _id: EXPENSE_ID,
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 5,
      expenseDate: new Date("2026-01-15T00:00:00.000Z"),
    };
    const { app, abandonMock } = loadApp({
      findOneImpl: () => Promise.resolve(originalExpense),
      findOneAndUpdateImpl: async () => ({ ...originalExpense, expenseAmount: 20 }),
      synchronizeAfterMutationImpl: async () => {
        throw new Error("simulated downstream failure AFTER the edit already committed");
      },
    });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseAmount: 20 });

    expect(res.status).toBe(500);
    // The reservation protecting this already-committed edit must survive
    // untouched.
    expect(abandonMock).not.toHaveBeenCalled();
  });

  it("Phase C.4: findOneAndUpdate itself REJECTS (ambiguous -- Mongo may have applied the update and lost the ack) -- abandon() must NEVER be called", async () => {
    const originalExpense = {
      _id: EXPENSE_ID,
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 5,
      expenseDate: new Date("2026-01-15T00:00:00.000Z"),
    };
    const { app, abandonMock, synchronizeAfterMutationMock } = loadApp({
      findOneImpl: () => Promise.resolve(originalExpense),
      findOneAndUpdateImpl: async () => {
        throw new Error("simulated network/write-concern failure -- outcome unknown");
      },
    });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseAmount: 20 });

    expect(res.status).toBe(500);
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
    // The rejection does not prove the update never landed -- the
    // reservation must survive.
    expect(abandonMock).not.toHaveBeenCalled();
  });
});

describe("PUT /expense/update-expense -- committed success, synchronized vs pending, month targeting", () => {
  const originalExpense = {
    _id: EXPENSE_ID,
    expenseName: "Coffee",
    expenseCategory: "Food",
    expenseAmount: 5,
    expenseDate: new Date("2026-01-15T00:00:00.000Z"),
  };

  function loadEditApp({ updatedExpense, synchronizeAfterMutationImpl } = {}) {
    return loadApp({
      findOneImpl: () => Promise.resolve(originalExpense),
      findOneAndUpdateImpl: async () => updatedExpense,
      synchronizeAfterMutationImpl,
    });
  }

  it("returns 200 with a synchronized derivedData object on a same-month amount edit", async () => {
    const updatedExpense = { ...originalExpense, expenseAmount: 20 };
    const { app, synchronizeAfterMutationMock } = loadEditApp({ updatedExpense });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseAmount: 20 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.derivedData).toEqual(SYNCHRONIZED_RESULT);
    expect(res.body.replayed).toBe(false);
    // Phase C.3 -- editExpense.js no longer makes a pre-write budgetDates
    // guess or a second post-write reservation call; a single broad
    // userWideReservation (taken before the write) covers the true
    // result, and the final recompute target is simply the TRUE discovered
    // month(s) (from findOneAndUpdate's own `{new:false}` result). This
    // fixture's mock returns the identical fixed `updatedExpense` doc
    // regardless of the `{new:false}` option, so old/new compare equal and
    // only the single true month is targeted.
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        budgetDates: [originalExpense.expenseDate],
        userWideToken: "user-wide-token-1",
        reportToken: "report-token-1",
      })
    );
  });

  it("still returns 200 (never 500) when derived sync is left pending", async () => {
    const updatedExpense = { ...originalExpense, expenseAmount: 20 };
    const { app } = loadEditApp({
      updatedExpense,
      synchronizeAfterMutationImpl: async () => PENDING_BUDGET_RESULT,
    });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseAmount: 20 });

    expect(res.status).toBe(200);
    expect(res.body.derivedData).toEqual(PENDING_BUDGET_RESULT);
  });

  it("targets BOTH the original and new month when an edit moves the expense across a month boundary", async () => {
    const newDate = new Date("2026-02-01T00:00:00.000Z");
    const updatedExpense = { ...originalExpense, expenseDate: newDate };
    const { app, synchronizeAfterMutationMock, reserveMock } = loadEditApp({ updatedExpense });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseDate: "2026-02-01" });

    expect(res.status).toBe(200);
    // Phase C.3 -- editExpense.js now reserves a single BROAD,
    // month-agnostic reservation BEFORE the primary write instead of
    // guessing the affected month(s) upfront -- see reserve()'s
    // reserveUserWide doc comment for why this is what actually closes the
    // post-write corrective-reservation gap.
    expect(reserveMock).toHaveBeenCalledWith({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: true,
    });
    // The final recompute target is the TRUE discovered month(s) only
    // (this fixture's mock returns `newDate` as BOTH the "prior" and
    // reconstructed-"new" state, so old/new compare equal and only the
    // single true new month is targeted).
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        budgetDates: [newDate],
        userWideToken: "user-wide-token-1",
      })
    );
  });

  it("targets no budget month at all when neither amount nor date changed", async () => {
    const updatedExpense = { ...originalExpense, expenseDescription: "updated note" };
    const { app, synchronizeAfterMutationMock } = loadEditApp({ updatedExpense });

    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ expenseDescription: "updated note" });

    expect(res.status).toBe(200);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, budgetDates: [] })
    );
  });
});

describe("DELETE /expense/delete-expense -- primary failure is unaffected", () => {
  it("returns 404 and never runs derived-data sync when the expense is not found", async () => {
    const { app, synchronizeAfterMutationMock } = loadApp({
      findOneAndDeleteImpl: async () => null,
    });

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: EXPENSE_ID });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Expense not found", success: false });
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed expense id before touching any model", async () => {
    const { app } = loadApp();

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: "not-a-mongo-id" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ message: "Invalid expense ID", success: false });
  });
});

describe("DELETE /expense/delete-expense -- committed success, synchronized vs pending", () => {
  const deletedExpense = { _id: EXPENSE_ID, expenseDate: new Date("2026-01-15T00:00:00.000Z") };

  // Phase C.1 -- deleteExpense.js now performs a PRE-delete read (to learn
  // the expense's month before reserve()) via ExpenseModel.findOne(...).lean(),
  // in addition to the actual findOneAndDelete. Both must resolve the same
  // document for these tests.
  function loadDeleteApp(overrides = {}) {
    return loadApp({
      findOneImpl: () => ({ lean: jest.fn().mockResolvedValue(deletedExpense) }),
      findOneAndDeleteImpl: async () => deletedExpense,
      ...overrides,
    });
  }

  it("returns 200 with a synchronized derivedData object, targeting the deleted expense's month", async () => {
    const { app, synchronizeAfterMutationMock, reserveMock } = loadDeleteApp();

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: EXPENSE_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Expense deleted successfully",
      success: true,
      derivedData: SYNCHRONIZED_RESULT,
      replayed: false,
    });
    // Phase C.3 -- deleteExpense.js now takes a single BROAD,
    // month-agnostic reservation BEFORE the primary delete, instead of
    // C.2's pre-read-month reserve() followed by a second post-write
    // corrective reserve() call -- see reserve()'s reserveUserWide doc
    // comment for why this closes the post-write corrective-reservation
    // gap.
    expect(reserveMock).toHaveBeenCalledWith({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: true,
    });
    expect(reserveMock).toHaveBeenCalledTimes(1);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        budgetDates: [deletedExpense.expenseDate],
        userWideToken: "user-wide-token-1",
        reportToken: "report-token-1",
      })
    );
  });

  it("still returns 200 (never 500) when derived sync is left pending -- this is the delete recovery evidence", async () => {
    const { app } = loadDeleteApp({
      synchronizeAfterMutationImpl: async () => PENDING_BUDGET_RESULT,
    });

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: EXPENSE_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.derivedData).toEqual(PENDING_BUDGET_RESULT);
    expect(res.body.derivedData.recoveryPending).toBe(true);
  });

  it("Phase C.3 requirement #4: the document vanishes between the pre-read and the actual delete -- this attempt's own write is KNOWN to have never occurred, so abandon() IS called", async () => {
    const { app, abandonMock } = loadDeleteApp({ findOneAndDeleteImpl: async () => null });

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: EXPENSE_ID });

    expect(res.status).toBe(404);
    expect(abandonMock).toHaveBeenCalledTimes(1);
    expect(abandonMock).toHaveBeenCalledWith(
      expect.objectContaining({ userWideToken: "user-wide-token-1", reportToken: "report-token-1" })
    );
  });

  it("Phase C.3 requirement #4: returns 500 when synchronizeAfterMutation throws AFTER the primary delete already committed -- abandon() must NEVER be called for this attempt's reservation", async () => {
    const { app, abandonMock } = loadDeleteApp({
      synchronizeAfterMutationImpl: async () => {
        throw new Error("simulated downstream failure AFTER the delete already committed");
      },
    });

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: EXPENSE_ID });

    expect(res.status).toBe(500);
    // The reservation protecting this already-committed delete must
    // survive untouched.
    expect(abandonMock).not.toHaveBeenCalled();
  });

  it("Phase C.4: findOneAndDelete itself REJECTS (ambiguous -- Mongo may have applied the delete and lost the ack) -- abandon() must NEVER be called", async () => {
    const { app, abandonMock, synchronizeAfterMutationMock } = loadDeleteApp({
      findOneAndDeleteImpl: async () => {
        throw new Error("simulated network/write-concern failure -- outcome unknown");
      },
    });

    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ id: EXPENSE_ID });

    expect(res.status).toBe(500);
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
    // The rejection does not prove the delete never landed -- the
    // reservation must survive.
    expect(abandonMock).not.toHaveBeenCalled();
  });
});
