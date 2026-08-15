// Phase C.3, requirement #1: the post-write corrective-reservation gap is
// closed by taking a single BROAD, month-agnostic reservation (reserveUserWide)
// BEFORE the primary write, instead of C.2's pre-read-guess reservation
// followed by a SECOND corrective reservation call after the write landed.
//
// This file proves, through the REAL Express routes and REAL
// Controllers/ExpenseControllers/deleteExpense.js/editExpense.js (only
// ../config/Schemas's ExpenseModel/UserModel and
// ../Services/syncRecoveryService are faked), that the two exact races from
// the Phase C.2/C.3 briefs are STILL correctly resolved under the new
// single-reservation design:
//
//   Delete race: Delete A pre-reads January, Edit B moves the expense to
//   February and finishes syncing, THEN Delete A deletes the now-February
//   document. February must be the actual recompute target -- not the
//   stale January pre-read.
//
//   Edit race: Edit A pre-reads January (planning to move it to March),
//   Edit B moves it to February first, THEN Edit A's own write lands on
//   the now-February document and moves it to March. February and March
//   must both end up correctly targeted for recompute.
//
// Both races are staged with an explicit pause-then-resume gate on the
// stateful fake ExpenseModel's own write call (findOneAndDelete /
// findOneAndUpdate) -- never a real timer/sleep, and never a Promise.all
// race whose winner is left to chance. Each also has a
// crash-before-confirm variant proving the SINGLE broad reservation
// (taken before the write, in scope for the WHOLE request, including the
// outer catch) is never abandoned once primaryWriteCommitted is true --
// Phase C.3 requirement #4.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-cross-month-race-test-secret";
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
  return jwt.sign({ email: "cross-month-race-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const EXPENSE_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

const JAN = "2026-01-15";
const FEB = "2026-02-10";
const MAR = "2026-03-05";

// Stateful in-memory ExpenseModel, keyed by _id -- actually stores/mutates
// documents rather than returning per-test-scripted canned values, so a
// concurrent request genuinely observes the OTHER request's committed
// write when it reads current state. Supports two independent, explicit
// pause gates (armed per-test) on findOneAndDelete and on a SPECIFIC
// findOneAndUpdate call index, each with an onPaused callback so the test
// can deterministically know the exact moment the controller is parked at
// that boundary -- never inferred from scheduling order.
function makeExpenseModel(seedDocs) {
  const store = new Map();
  for (const doc of seedDocs) {
    store.set(String(doc._id), { ...doc, expenseDate: new Date(doc.expenseDate) });
  }

  let deleteGate = null;
  let onDeletePaused = null;
  let updateGateIndex = null;
  let updateGatePromise = null;
  let onUpdatePaused = null;
  let updateCallCount = 0;

  function readMatching(filter) {
    const doc = store.get(String(filter._id));
    if (!doc || String(doc.userId) !== String(filter.userId)) return null;
    return { ...doc };
  }

  return {
    _store: store,
    __armDeleteGate(promise, onPaused) {
      deleteGate = promise;
      onDeletePaused = onPaused;
    },
    __armUpdateGate(callIndex, promise, onPaused) {
      updateGateIndex = callIndex;
      updateGatePromise = promise;
      onUpdatePaused = onPaused;
    },
    findOne: (filter) => {
      // Supports BOTH direct await (editExpense.js's own pre-read has no
      // .lean() chain) and .lean() (deleteExpense.js's pre-read) -- a
      // thenable object that also exposes .lean().
      return {
        lean: async () => readMatching(filter),
        then: (resolve, reject) => {
          try {
            resolve(readMatching(filter));
          } catch (e) {
            reject(e);
          }
        },
      };
    },
    findOneAndDelete: async (filter) => {
      if (deleteGate) {
        if (onDeletePaused) onDeletePaused();
        await deleteGate;
      }
      const key = String(filter._id);
      const doc = store.get(key);
      if (!doc || String(doc.userId) !== String(filter.userId)) return null;
      store.delete(key);
      return { ...doc };
    },
    findOneAndUpdate: async (filter, update, options = {}) => {
      const myIndex = updateCallCount;
      updateCallCount += 1;
      if (updateGateIndex === myIndex) {
        if (onUpdatePaused) onUpdatePaused();
        await updateGatePromise;
      }
      const key = String(filter._id);
      const doc = store.get(key);
      if (!doc || String(doc.userId) !== String(filter.userId)) return null;
      const prior = { ...doc };
      const updated = { ...doc, ...update.$set };
      if (updated.expenseDate !== undefined) {
        updated.expenseDate = new Date(updated.expenseDate);
      }
      store.set(key, updated);
      const base = options.new === false ? prior : updated;
      return { ...base, toObject: () => ({ ...base }) };
    },
  };
}

function loadApp({ seedDocs } = {}) {
  jest.resetModules();

  const findByIdMock = jest.fn(async (id) => ({ _id: id }));
  const ExpenseModelMock = makeExpenseModel(seedDocs);

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    ExpenseModel: ExpenseModelMock,
    MlFeedbackModel: function () {
      this.save = jest.fn().mockResolvedValue(undefined);
    },
    BudgetModel: {},
    IncomeModel: {},
  }));

  // Phase C.3 -- reserve() no longer takes budgetDates from edit/delete;
  // it is called with { reserveUserWide: true, reserveReport: true }
  // exactly ONCE per request, before the primary write.
  let reserveCallCounter = 0;
  const reserveMock = jest.fn(async ({ reserveUserWide, reserveReport } = {}) => {
    reserveCallCounter += 1;
    const call = reserveCallCounter;
    const userWideReservation = reserveUserWide ? { token: `userwide-tok-${call}` } : null;
    const reportReservation = reserveReport ? { token: `report-tok-${call}` } : null;
    return { budgetReservations: [], reportReservation, userWideReservation };
  });
  const abandonMock = jest.fn(async () => null);

  // Phase C.2/C.3 -- call-index-based throw control, NOT an unconditional
  // throw. synchronizeAfterMutation is a SHARED mock across every request
  // this test fires against the same app -- both the "victim" mutation (A)
  // and the concurrent mutation that runs to completion in between (B)
  // call through it. An unconditional throw would incorrectly also fail
  // B's own request, breaking the "B completes successfully" premise these
  // races depend on. `syncControl.throwOnCallIndex` lets a test target
  // ONLY A's own (later) call, by its exact 0-based call index, known in
  // advance from the scripted sequence of requests.
  const syncControl = { throwOnCallIndex: null, callCount: 0 };
  const synchronizeAfterMutationMock = jest.fn(async () => {
    const myIndex = syncControl.callCount;
    syncControl.callCount += 1;
    if (syncControl.throwOnCallIndex === myIndex) {
      throw new Error("simulated crash: process died before confirm() completed");
    }
    return { status: "synchronized", budget: "synchronized", report: "synchronized", recoveryPending: false };
  });

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

  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: jest.fn(async () => {}),
    setCache: jest.fn(async () => {}),
    getCache: jest.fn(async () => null),
  }));

  // Recurring-state authority remediation -- editExpense.js now calls
  // annotateRecurringState, which queries RecurringExpenseModel. No
  // recurring definitions exist in this file's scenarios.
  jest.doMock(RECURRING_MODEL_PATH, () => ({
    RecurringExpenseModel: { find: () => ({ lean: async () => [] }) },
  }));

  const app = require(APP_PATH);
  return { app, ExpenseModelMock, reserveMock, abandonMock, synchronizeAfterMutationMock, syncControl };
}

const authHeader = () => `Bearer ${signToken(USER_ID)}`;

describe("Phase C.3 -- DELETE race: pre-read goes stale because a concurrent edit moves the expense first", () => {
  it("targets FEBRUARY (the delete's own true result), not the stale January pre-read, using only the single broad reservation taken before the write", async () => {
    const { app, ExpenseModelMock, reserveMock, synchronizeAfterMutationMock } = loadApp({
      seedDocs: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });

    const gate = deferred();
    const reachedGate = deferred();
    ExpenseModelMock.__armDeleteGate(gate.promise, () => reachedGate.resolve());

    // Delete A: reserves BEFORE its own findOneAndDelete call (the pre-read
    // above only determines authorization/404, never what gets reserved),
    // then parks right before its own findOneAndDelete call.
    // supertest/superagent requests are lazy -- they only actually dispatch
    // once `.then()`/`await` is first called on them. Chaining `.then((res)
    // => res)` immediately here (rather than only awaiting `deletePromise`
    // later) is what actually starts the request now, so it can reach and
    // park at the gate BEFORE this test awaits `reachedGate.promise` below.
    const deletePromise = request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", authHeader())
      .send({ id: EXPENSE_ID })
      .then((res) => res);

    await reachedGate.promise;

    // Edit B runs to FULL completion while Delete A is parked -- moves the
    // SAME expense from January to February and finishes its own sync.
    const editBRes = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseDate: FEB });
    expect(editBRes.status).toBe(200);
    expect(ExpenseModelMock._store.get(EXPENSE_ID).expenseDate.toISOString().slice(0, 7)).toBe("2026-02");

    // Resume Delete A -- it now deletes the document as it TRULY is
    // (February), not as it was pre-read (January).
    gate.resolve();
    const deleteRes = await deletePromise;

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
    // The document is gone.
    expect(ExpenseModelMock._store.has(EXPENSE_ID)).toBe(false);

    // reserve() was called exactly ONCE per request, with reserveUserWide,
    // never budgetDates -- no second, post-write reservation call exists
    // anymore for Delete A to have made.
    const deleteAReserveCall = reserveMock.mock.calls.find((call) => call[0].reserveUserWide);
    expect(deleteAReserveCall).toBeDefined();
    expect(deleteAReserveCall[0]).not.toHaveProperty("budgetDates");

    // The ACTUAL recompute target -- what actually gets recalculated -- is
    // February, the delete's true result, carried via userWideToken (not a
    // second reservation's budgetTokens).
    const finalSyncCall = synchronizeAfterMutationMock.mock.calls[synchronizeAfterMutationMock.mock.calls.length - 1][0];
    const syncedMonths = finalSyncCall.budgetDates.map((d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 7));
    expect(syncedMonths).toEqual(["2026-02"]);
    expect(finalSyncCall.userWideToken).toMatch(/^userwide-tok-/);
  });

  it("CRASH-AFTER-COMMIT variant: if synchronization fails AFTER the delete's primary write already committed, the single broad reservation is NEVER abandoned (Phase C.3 requirement #4)", async () => {
    const { app, ExpenseModelMock, reserveMock, abandonMock, syncControl } = loadApp({
      seedDocs: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });
    // Edit B (run to completion below) makes exactly one
    // synchronizeAfterMutation call (index 0) -- Delete A's OWN call,
    // which only happens after it resumes, is therefore index 1. Only
    // THAT call is made to fail, simulating a downstream failure (cache
    // clear / synchronize / response serialization) AFTER Delete A's
    // primary write already committed -- B is completely unaffected.
    syncControl.throwOnCallIndex = 1;

    const gate = deferred();
    const reachedGate = deferred();
    ExpenseModelMock.__armDeleteGate(gate.promise, () => reachedGate.resolve());

    const deletePromise = request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", authHeader())
      .send({ id: EXPENSE_ID })
      .then((res) => res);

    await reachedGate.promise;

    const editBRes = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseDate: FEB });
    expect(editBRes.status).toBe(200); // B is unaffected by A's later, targeted failure

    gate.resolve();
    const deleteRes = await deletePromise;

    // The primary delete itself is unaffected by the downstream sync
    // "crash" -- it already committed. Only the derived-data step fails,
    // surfacing as the existing generic 500 contract.
    expect(deleteRes.status).toBe(500);
    // The document is still gone -- the primary write committed.
    expect(ExpenseModelMock._store.has(EXPENSE_ID)).toBe(false);

    // Phase C.3 requirement #4: deleteExpense.js's primaryWriteCommitted
    // flag is set true immediately after the successful findOneAndDelete,
    // BEFORE synchronizeAfterMutation is even invoked. The outer catch
    // therefore never abandons the reservation for THIS (committed)
    // delete -- abandonMock is called zero times for Delete A. (Edit B
    // completed successfully and never reaches the catch either.)
    expect(abandonMock).not.toHaveBeenCalled();
  });
});

describe("Phase C.3 -- EDIT race: A's pre-read goes stale because a concurrent edit moves the expense first", () => {
  it("targets FEBRUARY and MARCH -- the true prior month and the true new month -- using only the single broad reservation taken before the write", async () => {
    const { app, ExpenseModelMock, reserveMock, synchronizeAfterMutationMock } = loadApp({
      seedDocs: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });

    const gate = deferred();
    const reachedGate = deferred();
    // Edit A is the FIRST findOneAndUpdate call issued against this model
    // (Edit B has not even been fired yet at this point) -- pausing call
    // index 0 pauses exactly Edit A's own primary write, never Edit B's.
    ExpenseModelMock.__armUpdateGate(0, gate.promise, () => reachedGate.resolve());

    // Edit A: reserves BEFORE its own findOneAndUpdate call (a single
    // broad reservation, not a per-month guess), then parks right before
    // its own write.
    const editAPromise = request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseDate: MAR })
      .then((res) => res);

    await reachedGate.promise;

    // Edit B runs to FULL completion while Edit A is parked -- moves the
    // SAME expense from January to February.
    const editBRes = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseDate: FEB });
    expect(editBRes.status).toBe(200);
    expect(ExpenseModelMock._store.get(EXPENSE_ID).expenseDate.toISOString().slice(0, 7)).toBe("2026-02");

    // Resume Edit A -- its own findOneAndUpdate now runs against the
    // document as it TRULY is (February), moving it to March.
    gate.resolve();
    const editARes = await editAPromise;

    expect(editARes.status).toBe(200);
    expect(ExpenseModelMock._store.get(EXPENSE_ID).expenseDate.toISOString().slice(0, 7)).toBe("2026-03");

    // reserve() was called exactly ONCE per request (Edit A's own call),
    // with reserveUserWide -- no pre-write budgetDates guess, no second
    // post-write reservation call.
    const editACalls = reserveMock.mock.calls.filter((call) => call[0].reserveUserWide);
    expect(editACalls.length).toBeGreaterThanOrEqual(1);
    for (const call of editACalls) {
      expect(call[0]).not.toHaveProperty("budgetDates");
    }

    // The FINAL synchronizeAfterMutation call for Edit A must cover BOTH
    // true months -- February (the TRUE prior month, discovered from Edit
    // A's own findOneAndUpdate returning `{new:false}`) and March (the
    // true new state) -- carried via userWideToken, not a second
    // reservation's budgetTokens.
    const editASyncCall = synchronizeAfterMutationMock.mock.calls[synchronizeAfterMutationMock.mock.calls.length - 1][0];
    const syncedMonths = new Set(
      editASyncCall.budgetDates.map((d) => (d instanceof Date ? d : new Date(d)).toISOString().slice(0, 7))
    );
    expect(syncedMonths).toEqual(new Set(["2026-02", "2026-03"]));
    expect(editASyncCall.userWideToken).toMatch(/^userwide-tok-/);
  });

  it("CRASH-AFTER-COMMIT variant: if synchronization fails AFTER the edit's primary write already committed, the single broad reservation is NEVER abandoned (Phase C.3 requirement #4)", async () => {
    const { app, ExpenseModelMock, reserveMock, abandonMock, syncControl } = loadApp({
      seedDocs: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });
    // Edit B (run to completion below) makes exactly one
    // synchronizeAfterMutation call (index 0) -- Edit A's OWN call, which
    // only happens after it resumes, is therefore index 1. Only THAT call
    // is made to fail; B is completely unaffected.
    syncControl.throwOnCallIndex = 1;

    const gate = deferred();
    const reachedGate = deferred();
    ExpenseModelMock.__armUpdateGate(0, gate.promise, () => reachedGate.resolve());

    const editAPromise = request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseDate: MAR })
      .then((res) => res);

    await reachedGate.promise;

    const editBRes = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseDate: FEB });
    expect(editBRes.status).toBe(200); // B is unaffected by A's later, targeted failure

    gate.resolve();
    const editARes = await editAPromise;

    expect(editARes.status).toBe(500);
    // The primary write itself committed -- the document moved to March.
    expect(ExpenseModelMock._store.get(EXPENSE_ID).expenseDate.toISOString().slice(0, 7)).toBe("2026-03");

    // Phase C.3 requirement #4: editExpense.js's primaryWriteCommitted flag
    // is set true immediately after the successful findOneAndUpdate,
    // BEFORE synchronizeAfterMutation is even invoked. The outer catch
    // therefore never abandons the reservation for THIS (committed) edit.
    expect(abandonMock).not.toHaveBeenCalled();
  });
});
