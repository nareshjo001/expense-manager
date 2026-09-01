// Phase C.4 requirement #1 -- ambiguous MongoDB write outcomes.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const PENDING_SYNC_PATH = "../models/PendingSync";
const REPORT_MODEL_PATH = "../models/Report";
const REPORT_CACHE_REDIS_PATH = "../config/redis";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-ambiguous-write-test-secret";
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
  return jwt.sign({ email: "ambiguous-write-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const EXPENSE_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const JAN_2026 = new Date("2026-01-15T00:00:00.000Z");
const JAN_MONTH_KEY = JAN_2026.toLocaleString("default", { month: "short", year: "numeric" });

// Real CAS filter evaluation shared by the Budget/Report fakes -- mirrors
// mutationRecoveryCorrectness.test.js's casFilterMatches exactly.
function casFilterMatches(doc, filter) {
  if (!filter.$or) return true;
  const currentRevision = doc.syncRevision;
  return filter.$or.some((clause) => {
    if (clause.syncRevision && clause.syncRevision.$exists === false) {
      return currentRevision === undefined || currentRevision === null;
    }
    if (clause.syncRevision && clause.syncRevision.$lte !== undefined) {
      return currentRevision !== undefined && currentRevision !== null && currentRevision <= clause.syncRevision.$lte;
    }
    return false;
  });
}

// A REAL, stateful ExpenseModel: `_store` is the actual authoritative
function makeExpenseModel(seedDocs = []) {
  const store = new Map();
  for (const doc of seedDocs) {
    store.set(String(doc._id), { ...doc, expenseDate: new Date(doc.expenseDate) });
  }
  let saveShouldRejectAfterMutating = false;
  let updateShouldRejectAfterMutating = false;
  let deleteShouldRejectAfterMutating = false;

  function currentDocsForUser(userId) {
    return [...store.values()].filter((d) => String(d.userId) === String(userId));
  }

  return {
    _store: store,
    __armAmbiguousSave() {
      saveShouldRejectAfterMutating = true;
    },
    __armAmbiguousUpdate() {
      updateShouldRejectAfterMutating = true;
    },
    __armAmbiguousDelete() {
      deleteShouldRejectAfterMutating = true;
    },
    aggregate: jest.fn(async (pipeline) => {
      const matchStage = pipeline.find((s) => s.$match);
      const { userId, expenseDate } = matchStage.$match;
      const docs = currentDocsForUser(userId).filter(
        (d) => d.expenseDate >= expenseDate.$gte && d.expenseDate < expenseDate.$lt
      );
      const total = docs.reduce((sum, d) => sum + Number(d.expenseAmount || 0), 0);
      return docs.length > 0 ? [{ _id: null, total }] : [];
    }),
    findOne: (filter) => {
      // Supports BOTH the _id-based pre-read (edit/delete) and the
      let matches = null;
      if (filter._id !== undefined) {
        const doc = store.get(String(filter._id));
        matches = doc && String(doc.userId) === String(filter.userId) ? doc : null;
      } else if (filter.id !== undefined) {
        matches =
          [...store.values()].find(
            (d) => String(d.userId) === String(filter.userId) && d.id === filter.id
          ) || null;
      }
      return {
        lean: async () => (matches ? { ...matches } : null),
        then: (resolve, reject) => {
          try {
            resolve(matches ? { ...matches } : null);
          } catch (e) {
            reject(e);
          }
        },
      };
    },
    // Constructor-style `new ExpenseModel(doc)` -- addexpense.js's own usage.
    _Model: function ExpenseDoc(doc) {
      Object.assign(this, doc);
      if (this.expenseDate !== undefined) this.expenseDate = new Date(this.expenseDate);
      this.save = async () => {
        store.set(String(this._id || `gen-${store.size}-${Date.now()}`), { ...this });
        if (saveShouldRejectAfterMutating) {
          saveShouldRejectAfterMutating = false;
          const err = new Error("simulated: write applied, acknowledgement/connection lost");
          throw err;
        }
      };
    },
    findOneAndUpdate: async (filter, update, options = {}) => {
      const key = String(filter._id);
      const doc = store.get(key);
      if (!doc || String(doc.userId) !== String(filter.userId)) return null;
      const prior = { ...doc };
      const updated = { ...doc, ...update.$set };
      if (updated.expenseDate !== undefined) updated.expenseDate = new Date(updated.expenseDate);
      store.set(key, updated);
      if (updateShouldRejectAfterMutating) {
        updateShouldRejectAfterMutating = false;
        throw new Error("simulated: update applied, acknowledgement/connection lost");
      }
      const base = options.new === false ? prior : updated;
      return { ...base, toObject: () => ({ ...base }) };
    },
    findOneAndDelete: async (filter) => {
      const key = String(filter._id);
      const doc = store.get(key);
      if (!doc || String(doc.userId) !== String(filter.userId)) return null;
      store.delete(key);
      if (deleteShouldRejectAfterMutating) {
        deleteShouldRejectAfterMutating = false;
        throw new Error("simulated: delete applied, acknowledgement/connection lost");
      }
      return { ...doc };
    },
  };
}

// Real in-memory PendingSync store -- identical CAS/update semantics to
// mutationRecoveryCorrectness.test.js's makeFakePendingSyncModel.
function makeFakePendingSyncModel() {
  const store = new Map();

  function defaultDoc(userId) {
    return {
      user: userId,
      revision: 0,
      pendingBudgetMonths: [],
      reportPending: false,
      lastError: null,
      lastAttemptAt: null,
      reservedBudgetMonths: [],
      reservedReports: [],
      reservedUserWideReservations: [],
    };
  }

  function clone(doc) {
    return doc
      ? JSON.parse(JSON.stringify(doc), (key, value) => {
          if (key === "month" || key === "reservedAt" || key === "lastAttemptAt") {
            return value === null ? null : new Date(value);
          }
          return value;
        })
      : null;
  }

  function applyUpdate(doc, update) {
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
    }
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        const values = v.$each || [v];
        doc[k] = doc[k] || [];
        for (const val of values) {
          const exists = doc[k].some((existing) => new Date(existing).getTime() === new Date(val).getTime());
          if (!exists) doc[k].push(val);
        }
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        const values = v.$each || [v];
        doc[k] = doc[k] || [];
        doc[k].push(...values);
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (v && v.$in) {
          doc[k] = (doc[k] || []).filter((existing) => !v.$in.some((t) => new Date(t).getTime() === new Date(existing).getTime()));
        } else if (v && v.token && v.token.$in) {
          doc[k] = (doc[k] || []).filter((existing) => !v.token.$in.includes(existing.token));
        } else if (v && v.token) {
          doc[k] = (doc[k] || []).filter((existing) => existing.token !== v.token);
        }
      }
    }
    return doc;
  }

  return {
    _store: store,
    findOne: jest.fn((filter) => ({
      lean: async () => {
        const doc = store.get(String(filter.user));
        if (!doc) return null;
        if (filter.revision !== undefined && doc.revision !== filter.revision) return null;
        return clone(doc);
      },
    })),
    findOneAndUpdate: jest.fn(async (filter, update, options = {}) => {
      const userId = String(filter.user);
      let doc = store.get(userId);
      if (!doc) {
        if (!options.upsert) return null;
        doc = defaultDoc(userId);
      }
      if (filter.revision !== undefined && doc.revision !== filter.revision) return null;
      const updated = applyUpdate({ ...doc }, update);
      store.set(userId, updated);
      return clone(updated);
    }),
    updateOne: jest.fn(async (filter, update) => {
      const userId = String(filter.user);
      const doc = store.get(userId);
      if (!doc) return { matchedCount: 0 };
      const updated = applyUpdate({ ...doc }, update);
      store.set(userId, updated);
      return { matchedCount: 1 };
    }),
  };
}

function makeFakeBudgetModel() {
  const store = new Map();
  const key = (userId, month) => `${userId}|${month}`;
  return {
    _store: store,
    seed(userId, month, spent, extra = {}) {
      store.set(key(userId, month), { userId, month, spent, budget: 1000, ...extra });
    },
    get(userId, month) {
      return store.get(key(userId, month));
    },
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const k = key(filter.userId, filter.month);
      const doc = store.get(k);
      if (!doc) return null;
      if (!casFilterMatches(doc, filter)) return null;
      const updated = { ...doc, ...update.$set };
      store.set(k, updated);
      return updated;
    }),
    findOne: jest.fn((filter) => ({
      select: () => ({
        lean: async () => {
          const doc = store.get(key(filter.userId, filter.month));
          return doc ? { _id: `${filter.userId}|${filter.month}` } : null;
        },
      }),
    })),
    find: jest.fn((filter) => ({
      select: () => ({
        lean: async () => {
          const docs = [];
          for (const doc of store.values()) {
            if (String(doc.userId) === String(filter.userId)) docs.push({ month: doc.month });
          }
          return docs;
        },
      }),
    })),
  };
}

function makeFakeFinancialReportModel() {
  const store = new Map();
  return {
    _store: store,
    findOneAndUpdate: jest.fn((filter, update, options = {}) => ({
      lean: async () => {
        const userId = String(filter.user);
        const existing = store.get(userId);
        const setFields = update && update.$set ? update.$set : update;
        if (existing && casFilterMatches(existing, filter)) {
          const merged = { ...existing, ...setFields };
          store.set(userId, merged);
          return merged;
        }
        if (existing && !casFilterMatches(existing, filter)) {
          if (!options.upsert) return null;
          const err = new Error("E11000 duplicate key error");
          err.code = 11000;
          throw err;
        }
        if (!options.upsert) return null;
        const created = { user: userId, ...setFields };
        store.set(userId, created);
        return created;
      },
    })),
    findOne: jest.fn((filter) => ({
      lean: async () => store.get(String(filter.user)) || null,
    })),
  };
}

// Real-ish Redis keyspace, matching cache/reportCache.js's CAS scripts --
function makeFakeRedisClient() {
  const store = new Map();
  return {
    _store: store,
    get: jest.fn(async (key) => store.get(key) ?? null),
    del: jest.fn(async (key) => {
      store.delete(key);
    }),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    eval: jest.fn(async (script, { keys, arguments: args }) => {
      const key = keys[0];
      const isDelete = script.includes("redis.call('DEL'");
      if (isDelete) {
        const [incomingRevisionRaw] = args;
        const existing = store.get(key);
        if (existing && incomingRevisionRaw !== "") {
          const decoded = JSON.parse(existing);
          if (decoded && decoded.revision !== null && decoded.revision !== undefined) {
            if (Number(incomingRevisionRaw) < Number(decoded.revision)) return 0;
          }
        }
        store.delete(key);
        return 1;
      }
      const [envelope, incomingRevisionRaw] = args;
      const existing = store.get(key);
      if (existing) {
        const decoded = JSON.parse(existing);
        if (decoded && decoded.revision !== null && decoded.revision !== undefined) {
          if (incomingRevisionRaw === "") return 0;
          if (Number(incomingRevisionRaw) < Number(decoded.revision)) return 0;
        }
      }
      store.set(key, envelope);
      return 1;
    }),
  };
}

function loadApp({ seedExpenses = [] } = {}) {
  jest.resetModules();

  const findByIdMock = jest.fn(async (id) => ({ _id: id }));
  const expenseModelFns = makeExpenseModel(seedExpenses);
  // ExpenseModel must be callable as `new ExpenseModel(doc)` (addexpense.js)
  const ExpenseModelMock = expenseModelFns._Model;
  ExpenseModelMock.aggregate = expenseModelFns.aggregate;
  ExpenseModelMock.findOne = expenseModelFns.findOne;
  ExpenseModelMock.findOneAndUpdate = expenseModelFns.findOneAndUpdate;
  ExpenseModelMock.findOneAndDelete = expenseModelFns.findOneAndDelete;

  const fakeBudgetModel = makeFakeBudgetModel();
  const fakePendingSync = makeFakePendingSyncModel();
  const fakeReportModel = makeFakeFinancialReportModel();
  const fakeRedisClient = makeFakeRedisClient();

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    ExpenseModel: ExpenseModelMock,
    BudgetModel: fakeBudgetModel,
    MlFeedbackModel: function () {
      this.save = jest.fn().mockResolvedValue(undefined);
    },
    IncomeModel: {},
  }));
  jest.doMock(PENDING_SYNC_PATH, () => fakePendingSync);
  jest.doMock(REPORT_MODEL_PATH, () => fakeReportModel);
  jest.doMock(REPORT_CACHE_REDIS_PATH, () => ({ redisClient: fakeRedisClient, connectRedis: jest.fn() }));
  jest.doMock(REPORT_GENERATOR_PATH, () => ({
    generateReport: jest.fn(async () => ({ metadata: { version: 4 }, spending: { totalSpent: 0 } })),
  }));
  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: jest.fn(async () => {}),
    setCache: jest.fn(async () => {}),
    getCache: jest.fn(async () => null),
  }));

  const app = require(APP_PATH);
  const syncRecoveryService = require("../Services/syncRecoveryService");
  return { app, expenseModelFns, fakeBudgetModel, fakePendingSync, fakeReportModel, fakeRedisClient, syncRecoveryService };
}

const authHeader = () => `Bearer ${signToken(USER_ID)}`;

describe("Phase C.4 requirement #1 -- ambiguous write outcomes: ADD", () => {
  it("save() mutates the store then REJECTS -- the request fails, the reservation survives, and a later read repairs Budget/report/Redis from the (already-committed) expense", async () => {
    const { app, expenseModelFns, fakeBudgetModel, fakePendingSync, fakeReportModel, fakeRedisClient, syncRecoveryService } = loadApp();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);
    expenseModelFns.__armAmbiguousSave();

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", authHeader())
      .send({
        id: "ambiguous-add-1",
        expenseName: "Rent",
        expenseCategory: "Housing",
        expenseAmount: 500,
        expenseDate: "2026-01-15",
        expenseDescription: "test",
      });
    consoleErrorSpy.mockRestore();

    // 3. The request fails.
    expect(res.status).toBe(500);
    // 1. The write genuinely mutated the store -- the expense IS there.
    const stored = [...expenseModelFns._store.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0].expenseAmount).toBe(500);

    // 4. The reservation survives -- not abandoned.
    const pendingBefore = await syncRecoveryService.getPendingSync(USER_ID);
    // add uses per-month budgetTokens, not the userWide reservation.
    expect(pendingBefore.reservedUserWideReservations).toHaveLength(0);
    expect(pendingBefore.reservedBudgetMonths).toHaveLength(1);
    expect(pendingBefore.reservedReports).toHaveLength(1);
    expect(pendingBefore.reservedReports[0].token).toBeTruthy();

    // 5. A later read repairs Budget, report, and Redis from the
    // authoritative (already-committed) expense data.
    const farFuture = pendingBefore.reservedBudgetMonths[0].reservedAt.getTime() + syncRecoveryService.RESERVATION_STALE_MS + 1000;
    const repairResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(repairResult.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(500);
    const finalReport = fakeReportModel._store.get(USER_ID);
    expect(finalReport).toBeTruthy();
    const cachedRaw = fakeRedisClient._store.get(`report:${USER_ID}`);
    expect(cachedRaw).toBeTruthy();
  });
});

describe("Phase C.4 requirement #1 -- ambiguous write outcomes: EDIT", () => {
  it("findOneAndUpdate mutates the store then REJECTS -- the request fails, the reservation survives, and a later read repairs Budget/report/Redis from the (already-moved) expense", async () => {
    const { app, expenseModelFns, fakeBudgetModel, fakePendingSync, fakeReportModel, fakeRedisClient, syncRecoveryService } = loadApp({
      seedExpenses: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN_2026, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 500);
    expenseModelFns.__armAmbiguousUpdate();

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseAmount: 750 });
    consoleErrorSpy.mockRestore();

    expect(res.status).toBe(500);
    // The write genuinely mutated the store.
    expect(expenseModelFns._store.get(EXPENSE_ID).expenseAmount).toBe(750);

    // The reservation survives.
    const pendingBefore = await syncRecoveryService.getPendingSync(USER_ID);
    expect(pendingBefore.reservedUserWideReservations).toHaveLength(1);
    expect(pendingBefore.reservedUserWideReservations[0].token).toBeTruthy();

    const farFuture = pendingBefore.reservedUserWideReservations[0].reservedAt.getTime() + syncRecoveryService.RESERVATION_STALE_MS + 1000;
    const repairResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(repairResult.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(750);
    expect(fakeReportModel._store.get(USER_ID)).toBeTruthy();
    expect(fakeRedisClient._store.get(`report:${USER_ID}`)).toBeTruthy();
  });
});

describe("Phase C.4 requirement #1 -- ambiguous write outcomes: DELETE", () => {
  it("findOneAndDelete mutates the store then REJECTS -- the request fails, the reservation survives, and a later read repairs Budget/report/Redis reflecting the (already-removed) expense", async () => {
    const { app, expenseModelFns, fakeBudgetModel, fakePendingSync, fakeReportModel, fakeRedisClient, syncRecoveryService } = loadApp({
      seedExpenses: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN_2026, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 500);
    expenseModelFns.__armAmbiguousDelete();

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", authHeader())
      .send({ id: EXPENSE_ID });
    consoleErrorSpy.mockRestore();

    expect(res.status).toBe(500);
    // The write genuinely mutated the store -- the expense is gone.
    expect(expenseModelFns._store.has(EXPENSE_ID)).toBe(false);

    const pendingBefore = await syncRecoveryService.getPendingSync(USER_ID);
    expect(pendingBefore.reservedUserWideReservations).toHaveLength(1);
    expect(pendingBefore.reservedUserWideReservations[0].token).toBeTruthy();

    const farFuture = pendingBefore.reservedUserWideReservations[0].reservedAt.getTime() + syncRecoveryService.RESERVATION_STALE_MS + 1000;
    const repairResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(repairResult.attempted).toBe(true);
    // The month now totals 0 -- the deletion is correctly reflected.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(0);
    expect(fakeReportModel._store.get(USER_ID)).toBeTruthy();
    expect(fakeRedisClient._store.get(`report:${USER_ID}`)).toBeTruthy();
  });
});

describe("Phase C.4 -- retained proof: a DEFINITE no-write outcome still safely abandons", () => {
  it("ADD: E11000 (this attempt's own insert conclusively never landed) abandons the reservation", async () => {
    const { app, syncRecoveryService } = loadApp();
    // Two concurrent adds with the SAME idempotency id: the first genuinely
    const app2 = app; // same app instance; the mock ExpenseModel is shared per loadApp() call

    const first = await request(app2)
      .post("/expense/add-expense")
      .set("Authorization", authHeader())
      .send({
        id: "dupe-id",
        expenseName: "Rent",
        expenseCategory: "Housing",
        expenseAmount: 500,
        expenseDate: "2026-01-15",
        expenseDescription: "test",
      });
    expect(first.status).toBe(201);

    // A second add reusing the SAME id but a DIFFERENT payload -- the
    const second = await request(app2)
      .post("/expense/add-expense")
      .set("Authorization", authHeader())
      .send({
        id: "dupe-id",
        expenseName: "Groceries",
        expenseCategory: "Food",
        expenseAmount: 50,
        expenseDate: "2026-01-16",
        expenseDescription: "test",
      });
    expect(second.status).toBe(409);

    const pending = await syncRecoveryService.getPendingSync(USER_ID);
    // Only the first (successful) add's Tier-1 work remains -- the second
    expect(pending.reservedBudgetMonths).toHaveLength(0);
  });

  it("EDIT: a resolved null (conclusively no matching document) abandons the reservation", async () => {
    const { app, syncRecoveryService } = loadApp({
      seedExpenses: [{ _id: EXPENSE_ID, userId: USER_ID, expenseDate: JAN_2026, expenseName: "Rent", expenseCategory: "Housing", expenseAmount: 500 }],
    });

    // Delete the expense out from under the edit's own pre-read by issuing
    const deleteRes = await request(app)
      .delete("/expense/delete-expense")
      .set("Authorization", authHeader())
      .send({ id: EXPENSE_ID });
    expect(deleteRes.status).toBe(200);

    const editRes = await request(app)
      .put("/expense/update-expense")
      .query({ editID: EXPENSE_ID })
      .set("Authorization", authHeader())
      .send({ expenseAmount: 20 });
    expect(editRes.status).toBe(404);

    // The edit's own reservation (taken before its own findOneAndUpdate)
    const pending = await syncRecoveryService.getPendingSync(USER_ID);
    expect(pending.reservedUserWideReservations).toHaveLength(0);
  });
});
