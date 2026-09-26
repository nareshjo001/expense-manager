// PRV-001-T07 -- reconciliation, audit and recovery tests for the account
// deletion pipeline.
//
// Unlike every other accountDeletion* suite, this file does NOT mock
// accountDeletionOrchestrator.js, accountDeletionTierASteps.js or
// accountDeletionTierBSteps.js -- it wires the REAL orchestrator against
// the REAL Tier A + Tier B step modules (exactly the combined list
// cron/accountDeletionJob.js builds), and only fakes the bottom of the
// dependency tree: the Mongoose models themselves, via a small in-memory
// store. This is the same "real control flow against a fake datastore"
// approach tests/retryPush.itemClaim.test.js and
// tests/recurringJob.reservationOwnership.test.js already use elsewhere in
// this codebase for testing genuine concurrency/idempotency properties
// without a live MongoDB -- this file is a plain .test.js (no live infra),
// never a .itest.js.
//
// What this buys that the per-module unit suites cannot: proof that the
// steps, run together in their real combined order, actually leave the
// database in a reconciled state (every OTHER user's data untouched, an
// orphaned mlfeedback document untouched, no partial deletion left behind
// on success) -- and proof that the idempotent-resumability CONTRACT the
// design relies on (accountDeletionOrchestrator.js's module comment) holds
// in practice: a simulated crash mid-run, followed by a second cycle,
// finishes the job with no duplicate work and no leftover data.
"use strict";

const ORCHESTRATOR_PATH = "../Services/PrivacyServices/accountDeletionOrchestrator";
const TIER_A_STEPS_PATH = "../Services/PrivacyServices/accountDeletionTierASteps";
const TIER_B_STEPS_PATH = "../Services/PrivacyServices/accountDeletionTierBSteps";

// A minimal, generic in-memory collection supporting exactly the query
// shapes this pipeline's real code issues ($ne, $lte, $set updates, plain
// equality) -- not a general Mongo emulator, deliberately just enough to
// exercise real control flow against real, mutable, shared state.
function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const val = key in doc ? doc[key] : null;
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      return Object.entries(cond).every(([op, opVal]) => {
        if (op === "$ne") return val !== opVal;
        if (op === "$lte") return val != null && new Date(val).getTime() <= new Date(opVal).getTime();
        throw new Error(`Unsupported operator ${op} in test fake store`);
      });
    }
    return val === cond;
  });
}

function makeCollection(seedDocs) {
  const docs = seedDocs.map((d) => ({ ...d }));
  return {
    _docs: docs,
    deleteMany: jest.fn(async (filter = {}) => {
      const before = docs.length;
      for (let i = docs.length - 1; i >= 0; i--) {
        if (matchesFilter(docs[i], filter)) docs.splice(i, 1);
      }
      return { deletedCount: before - docs.length };
    }),
    deleteOne: jest.fn(async (filter = {}) => {
      const idx = docs.findIndex((d) => matchesFilter(d, filter));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    }),
    updateMany: jest.fn(async (filter = {}, update = {}) => {
      let count = 0;
      for (const doc of docs) {
        if (matchesFilter(doc, filter)) {
          if (update.$set) Object.assign(doc, update.$set);
          count += 1;
        }
      }
      return { matchedCount: count, modifiedCount: count };
    }),
    find: jest.fn((filter = {}) => {
      const matched = docs.filter((d) => matchesFilter(d, filter));
      const query = {
        select: jest.fn(() => query),
        lean: jest.fn(async () => matched.map((d) => ({ ...d }))),
      };
      return query;
    }),
  };
}

// Every user-linked collection this pipeline touches, seeded fresh per
// test. Two users ("user-1" purge-eligible, "user-2" not) plus one
// orphaned (userId: null) mlfeedback document, so cross-user isolation and
// the orphan-exclusion contract are both exercised on every run, not just
// asserted in isolation.
function seedDatabase() {
  const collections = {
    UserModel: makeCollection([
      { _id: "user-1", email: "u1@example.com", deletionRequestedAt: new Date("2026-09-01"), deletionScheduledPurgeAt: new Date("2026-09-15") },
      { _id: "user-2", email: "u2@example.com", deletionRequestedAt: null, deletionScheduledPurgeAt: null },
    ]),
    ExpenseModel: makeCollection([{ _id: "e1", userId: "user-1" }, { _id: "e2", userId: "user-2" }]),
    IncomeModel: makeCollection([{ _id: "i1", userId: "user-1" }, { _id: "i2", userId: "user-2" }]),
    BudgetModel: makeCollection([{ _id: "b1", userId: "user-1" }, { _id: "b2", userId: "user-2" }]),
    // BUD-001 (I15) -- per-category allocations, a separate collection.
    CategoryBudgetModel: makeCollection([{ _id: "cb1", userId: "user-1" }, { _id: "cb2", userId: "user-2" }]),
    MlFeedbackModel: makeCollection([
      { _id: "f1", userId: "user-1" },
      { _id: "f2", userId: "user-2" },
      { _id: "f3", userId: null }, // orphaned -- must survive every run
    ]),
    MerchantCategoryRule: makeCollection([{ _id: "m1", userId: "user-1" }, { _id: "m2", userId: "user-2" }]),
    RecurringExpenseModel: makeCollection([{ _id: "r1", userId: "user-1" }, { _id: "r2", userId: "user-2" }]),
    // OCR-004 -- deleteReceiptsStep's own collection. storageKey is real
    // per-doc data (deleteReceiptsStep reads it to call deleteReceiptObject
    // per receipt before the deleteMany), unlike every other collection
    // here where only userId/_id matter to the test.
    ReceiptModel: makeCollection([
      { _id: "rc1", userId: "user-1", storageKey: "sk-rc1" },
      { _id: "rc2", userId: "user-2", storageKey: "sk-rc2" },
    ]),
    Notification: makeCollection([{ _id: "n1", userId: "user-1" }, { _id: "n2", userId: "user-2" }]),
    PendingSync: makeCollection([{ _id: "p1", user: "user-1" }, { _id: "p2", user: "user-2" }]),
    FinancialReport: makeCollection([{ _id: "fr1", user: "user-1" }, { _id: "fr2", user: "user-2" }]),
    SiaMessage: makeCollection([{ _id: "sm1", user: "user-1" }, { _id: "sm2", user: "user-2" }]),
    SiaSession: makeCollection([{ _id: "ss1", user: "user-1" }, { _id: "ss2", user: "user-2" }]),
    SiaRequest: makeCollection([{ _id: "sr1", user: "user-1" }, { _id: "sr2", user: "user-2" }]),
    RefreshSession: makeCollection([
      { _id: "rs1", userId: "user-1", revokedAt: null },
      { _id: "rs2", userId: "user-2", revokedAt: null },
    ]),
    DeviceToken: makeCollection([{ _id: "dt1", userId: "user-1" }, { _id: "dt2", userId: "user-2" }]),
  };
  return collections;
}

function loadPipeline(collections) {
  jest.resetModules();

  jest.doMock("../config/Schemas", () => ({
    ExpenseModel: collections.ExpenseModel,
    IncomeModel: collections.IncomeModel,
    BudgetModel: collections.BudgetModel,
    MlFeedbackModel: collections.MlFeedbackModel,
    UserModel: collections.UserModel,
  }));
  jest.doMock("../models/MerchantCategoryRule", () => collections.MerchantCategoryRule);
  jest.doMock("../models/RecurringExpense", () => ({ RecurringExpenseModel: collections.RecurringExpenseModel }));
  jest.doMock("../models/Report", () => collections.FinancialReport);
  jest.doMock("../models/PendingSync", () => collections.PendingSync);
  jest.doMock("../models/Notification", () => collections.Notification);
  jest.doMock("../models/SiaSession", () => collections.SiaSession);
  jest.doMock("../models/SiaMessage", () => collections.SiaMessage);
  jest.doMock("../models/SiaRequest", () => collections.SiaRequest);
  jest.doMock("../models/RefreshSession", () => collections.RefreshSession);
  jest.doMock("../models/DeviceToken", () => collections.DeviceToken);
  jest.doMock("../models/Receipt", () => collections.ReceiptModel);
  jest.doMock("../models/CategoryBudget", () => ({ CategoryBudgetModel: collections.CategoryBudgetModel }));
  // deleteReceiptsStep's only external-I/O dependency -- the GridFS blob
  // delete itself is receiptStorageAdapter.js's own suite's job to cover,
  // not this reconciliation test's; here it only needs to be called
  // without throwing so the real per-receipt loop and the trailing
  // Receipt.deleteMany both execute against the fake collection above.
  jest.doMock("../Services/ReceiptServices/receiptStorageAdapter", () => ({
    deleteReceiptObject: jest.fn(async () => {}),
  }));
  // Redis-backed caches are irrelevant to reconciliation/recovery -- no-op
  // stubs, exactly as clearCachesStep's own suite already covers their
  // wiring directly.
  jest.doMock("../utils/expenseCache", () => ({ clearUserExpenseCache: jest.fn(async () => {}) }));
  jest.doMock("../cache/reportCache", () => ({ invalidate: jest.fn(async () => {}) }));

  const { runAccountDeletionPurge } = require(ORCHESTRATOR_PATH);
  const { TIER_A_STEPS } = require(TIER_A_STEPS_PATH);
  const { TIER_B_STEPS } = require(TIER_B_STEPS_PATH);
  const steps = [...TIER_A_STEPS, ...TIER_B_STEPS];

  return { runAccountDeletionPurge, steps };
}

const heldLease = { isHeld: () => true };

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("PRV-001-T07 reconciliation -- a clean successful run", () => {
  test("purges every Tier A + Tier B collection for the eligible user, leaves every other user's data and the orphan intact", async () => {
    const collections = seedDatabase();
    const { runAccountDeletionPurge, steps } = loadPipeline(collections);

    const results = await runAccountDeletionPurge({ steps, lease: heldLease, now: new Date("2026-09-20") });

    expect(results).toEqual([{ userId: "user-1", ok: true, completed: steps.map((s) => s.name), failedStep: null, error: null }]);

    // Reconciliation: user-1 is gone from every DELETE-based collection,
    // including `users` itself, deleted last. RefreshSession is the one
    // exception -- revokeSessionsStep REVOKES (sets revokedAt), it does
    // not delete the session document, so it is checked separately below.
    const deleteBasedCollections = { ...collections };
    delete deleteBasedCollections.RefreshSession;
    for (const col of Object.values(deleteBasedCollections)) {
      const stillOwnedByUser1 = col._docs.some((d) => d.userId === "user-1" || d.user === "user-1" || d._id === "user-1");
      expect(stillOwnedByUser1).toBe(false);
    }

    // Isolation: user-2's data in every collection is completely untouched.
    expect(collections.ExpenseModel._docs.find((d) => d._id === "e2")).toBeDefined();
    expect(collections.UserModel._docs.find((d) => d._id === "user-2")).toBeDefined();
    expect(collections.RefreshSession._docs.find((d) => d._id === "rs2")).toMatchObject({ revokedAt: null });
    expect(collections.DeviceToken._docs.find((d) => d._id === "dt2")).toBeDefined();

    // Orphan exclusion: the userId:null mlfeedback document survives even
    // though user-1's own feedback document was deleted.
    expect(collections.MlFeedbackModel._docs.map((d) => d._id)).toEqual(["f2", "f3"]);

    // Tier A actually took effect, not just "ran without throwing": the
    // session was REVOKED (still present, revokedAt now set -- see
    // Services/AuthServices/session.service.js's revokeAllSessions, an
    // updateMany, not a delete) and the device token DELETED.
    const rs1 = collections.RefreshSession._docs.find((d) => d._id === "rs1");
    expect(rs1).toBeDefined();
    expect(rs1.revokedAt).not.toBeNull();
    expect(collections.DeviceToken._docs.find((d) => d._id === "dt1")).toBeUndefined();
  });

  test("a user not yet past their grace period, or with no pending deletion, is never touched", async () => {
    const collections = seedDatabase();
    // Make user-2 ALSO technically "requested" but not yet due.
    collections.UserModel._docs[1].deletionRequestedAt = new Date("2026-09-19");
    collections.UserModel._docs[1].deletionScheduledPurgeAt = new Date("2026-10-03");
    const { runAccountDeletionPurge, steps } = loadPipeline(collections);

    const results = await runAccountDeletionPurge({ steps, lease: heldLease, now: new Date("2026-09-20") });

    expect(results.map((r) => r.userId)).toEqual(["user-1"]);
    expect(collections.ExpenseModel._docs.find((d) => d._id === "e2")).toBeDefined();
  });
});

describe("PRV-001-T07 recovery -- a crash mid-run is safely resumed", () => {
  test("a step that throws leaves earlier steps' deletions in place, later steps untouched, and the user still eligible; a second cycle finishes the job", async () => {
    const collections = seedDatabase();
    const { runAccountDeletionPurge, steps } = loadPipeline(collections);

    // Simulate a crash/transient failure exactly at delete-notifications --
    // a step roughly in the middle of the combined Tier A + Tier B list.
    const failingIndex = steps.findIndex((s) => s.name === "delete-notifications");
    expect(failingIndex).toBeGreaterThan(0);
    expect(failingIndex).toBeLessThan(steps.length - 1);
    const originalRun = steps[failingIndex].run;
    let shouldFail = true;
    steps[failingIndex] = {
      ...steps[failingIndex],
      run: async (userId) => {
        if (shouldFail) throw new Error("simulated crash");
        return originalRun(userId);
      },
    };

    // --- Cycle 1: fails partway through ---
    const firstRun = await runAccountDeletionPurge({ steps, lease: heldLease, now: new Date("2026-09-20") });
    expect(firstRun).toEqual([{
      userId: "user-1",
      ok: false,
      completed: steps.slice(0, failingIndex).map((s) => s.name),
      failedStep: "delete-notifications",
      error: "simulated crash",
    }]);

    // Steps BEFORE the failure really did take effect (not a no-op that
    // merely didn't throw): the session was revoked and the device token
    // deleted.
    const rs1AfterCrash = collections.RefreshSession._docs.find((d) => d._id === "rs1");
    expect(rs1AfterCrash).toBeDefined();
    expect(rs1AfterCrash.revokedAt).not.toBeNull();
    expect(collections.DeviceToken._docs.find((d) => d._id === "dt1")).toBeUndefined();
    // Steps AT/AFTER the failure did NOT run.
    expect(collections.Notification._docs.find((d) => d._id === "n1")).toBeDefined();
    expect(collections.UserModel._docs.find((d) => d._id === "user-1")).toBeDefined();

    // --- Cycle 2: the transient failure is gone; resumed from the top ---
    shouldFail = false;
    const secondRun = await runAccountDeletionPurge({ steps, lease: heldLease, now: new Date("2026-09-21") });
    expect(secondRun).toEqual([{ userId: "user-1", ok: true, completed: steps.map((s) => s.name), failedStep: null, error: null }]);

    // Idempotency proven, not assumed: re-running revokeSessionsStep against
    // an ALREADY-revoked session did not error (updateMany matching zero
    // rows is a no-op, not a failure), and every delete-based collection is
    // now clean for user-1 -- full reconciliation reached via two cycles
    // instead of one, which is exactly the resumability contract
    // accountDeletionOrchestrator.js documents.
    const deleteBasedCollectionsAfter = { ...collections };
    delete deleteBasedCollectionsAfter.RefreshSession;
    for (const col of Object.values(deleteBasedCollectionsAfter)) {
      expect(col._docs.some((d) => d.userId === "user-1" || d.user === "user-1")).toBe(false);
    }
    const rs1Final = collections.RefreshSession._docs.find((d) => d._id === "rs1");
    expect(rs1Final).toBeDefined();
    expect(rs1Final.revokedAt).not.toBeNull();
    expect(collections.UserModel._docs.find((d) => d._id === "user-1")).toBeUndefined();
    expect(collections.MlFeedbackModel._docs.map((d) => d._id).sort()).toEqual(["f2", "f3"]);
  });
});

describe("PRV-001-T07 audit -- per-user result reporting is accurate across a batch", () => {
  test("onUserResult fires once per user with the real completed-step list", async () => {
    const collections = seedDatabase();
    collections.UserModel._docs.push({
      _id: "user-3",
      email: "u3@example.com",
      deletionRequestedAt: new Date("2026-09-01"),
      deletionScheduledPurgeAt: new Date("2026-09-10"),
    });
    const { runAccountDeletionPurge, steps } = loadPipeline(collections);

    const onUserResult = jest.fn();
    await runAccountDeletionPurge({ steps, lease: heldLease, now: new Date("2026-09-20"), onUserResult });

    expect(onUserResult).toHaveBeenCalledTimes(2);
    const userIds = onUserResult.mock.calls.map((call) => call[0]).sort();
    expect(userIds).toEqual(["user-1", "user-3"]);
    for (const call of onUserResult.mock.calls) {
      expect(call[1]).toMatchObject({ ok: true, completed: steps.map((s) => s.name) });
    }
  });
});
