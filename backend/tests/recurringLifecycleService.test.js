// REC-002-T02/T03/T04 -- Services/RecurringServices/recurringLifecycleService.js.
//
// Exercised directly against a small in-memory fake RecurringExpenseModel
// (find/findOne/findOneAndUpdate), the same fast pattern
// recurringStateService.test.js and recurringUpcomingProjection.test.js use
// -- no real Mongo, and deliberately NOT going through `require("../app")`
// (supertest route-level tests for this codebase's recurring endpoints
// currently take 70s+ just to load the real Express app in this sandbox --
// confirmed directly, not assumed -- so this service's own logic is proven
// here, fast and exhaustively, while the thin controller/route wiring is
// covered separately by direct-invocation controller tests).
"use strict";

const RECURRING_MODEL_PATH = "../models/RecurringExpense";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

function makeFakeModel(seedDocs = []) {
  const store = new Map();
  for (const doc of seedDocs) store.set(String(doc._id), { ...doc });

  function matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
      const value = doc[key];
      if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if ("$in" in cond) return cond.$in.includes(value);
        if ("$ne" in cond) return value !== cond.$ne;
      }
      return String(value) === String(cond);
    });
  }

  return {
    __store: store,
    find: (filter) => {
      const docs = [...store.values()].filter((d) => matches(d, filter));
      return {
        sort: () => ({
          lean: async () => docs.map((d) => ({ ...d })),
        }),
      };
    },
    findOne: (filter) => ({
      lean: async () => {
        const doc = [...store.values()].find((d) => matches(d, filter));
        return doc ? { ...doc } : null;
      },
    }),
    findOneAndUpdate: (filter, update, options) => ({
      lean: async () => {
        const doc = [...store.values()].find((d) => matches(d, filter));
        if (!doc) return null;
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$inc) {
          for (const [field, amount] of Object.entries(update.$inc)) {
            doc[field] = (doc[field] || 0) + amount;
          }
        }
        return options && options.new ? { ...doc } : null;
      },
    }),
  };
}

function loadService(seedDocs) {
  jest.resetModules();
  const model = makeFakeModel(seedDocs);
  jest.doMock(RECURRING_MODEL_PATH, () => ({ RecurringExpenseModel: model }));
  const service = require("../Services/RecurringServices/recurringLifecycleService");
  return { service, model };
}

function baseDefinition(overrides = {}) {
  return {
    _id: "rec1",
    userId: USER_ID,
    expenseId: "exp1",
    expenseName: "Netflix",
    expenseCategory: "Entertainment",
    expenseAmount: 649,
    lastLoggedDate: new Date("2026-09-01T00:00:00.000Z"),
    nextDueDate: new Date("2026-10-01T00:00:00.000Z"),
    status: "active",
    recurrenceFrequency: "monthly",
    pausedAt: null,
    resumedAt: null,
    endedAt: null,
    endDate: null,
    scheduleVersion: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("listDefinitions / getDefinition", () => {
  test("list returns only the requesting user's definitions, in public shape", async () => {
    const { service } = loadService([
      baseDefinition(),
      baseDefinition({ _id: "rec2", userId: OTHER_USER_ID }),
    ]);

    const list = await service.listDefinitions(USER_ID);

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("rec1");
    expect(list[0].expenseAmountMinor).toBe(64900);
    expect(list[0]).not.toHaveProperty("_id");
    expect(list[0]).not.toHaveProperty("userId");
  });

  test("getDefinition returns null for another user's definition (non-disclosing)", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.getDefinition(OTHER_USER_ID, "rec1");
    expect(result).toBeNull();
  });

  test("getDefinition returns the public shape including scheduleVersion", async () => {
    const { service } = loadService([baseDefinition({ scheduleVersion: 4 })]);
    const result = await service.getDefinition(USER_ID, "rec1");
    expect(result.scheduleVersion).toBe(4);
    expect(result.status).toBe("active");
  });
});

describe("pauseDefinition", () => {
  test("pauses an active definition, sets pausedAt, bumps scheduleVersion", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.pauseDefinition(USER_ID, "rec1", 0);

    expect(result.ok).toBe(true);
    expect(result.definition.status).toBe("paused");
    expect(result.definition.pausedAt).toBeInstanceOf(Date);
    expect(result.definition.scheduleVersion).toBe(1);
  });

  test("rejects with not_found for a nonexistent id", async () => {
    const { service } = loadService([]);
    const result = await service.pauseDefinition(USER_ID, "missing", 0);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  test("rejects with not_found for another user's definition (non-disclosing)", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.pauseDefinition(OTHER_USER_ID, "rec1", 0);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  test("rejects already-paused with a distinct reason, not a generic conflict", async () => {
    const { service } = loadService([baseDefinition({ status: "paused" })]);
    const result = await service.pauseDefinition(USER_ID, "rec1", 0);
    expect(result).toEqual({ ok: false, reason: "already_paused" });
  });

  test("rejects an ended definition -- terminal state, cannot be paused", async () => {
    const { service } = loadService([baseDefinition({ status: "ended" })]);
    const result = await service.pauseDefinition(USER_ID, "rec1", 0);
    expect(result).toEqual({ ok: false, reason: "already_ended" });
  });

  test("a stale scheduleVersion is a version_conflict, returning the current definition", async () => {
    const { service } = loadService([baseDefinition({ scheduleVersion: 2 })]);
    const result = await service.pauseDefinition(USER_ID, "rec1", 0); // stale: real version is 2

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("version_conflict");
    expect(result.current.scheduleVersion).toBe(2);
    expect(result.current.status).toBe("active"); // untouched
  });
});

describe("resumeDefinition", () => {
  test("resumes a paused definition, sets resumedAt, bumps scheduleVersion", async () => {
    const { service } = loadService([baseDefinition({ status: "paused", pausedAt: new Date(), scheduleVersion: 1 })]);
    const result = await service.resumeDefinition(USER_ID, "rec1", 1);

    expect(result.ok).toBe(true);
    expect(result.definition.status).toBe("active");
    expect(result.definition.resumedAt).toBeInstanceOf(Date);
    expect(result.definition.scheduleVersion).toBe(2);
  });

  test("rejects resuming an already-active definition", async () => {
    const { service } = loadService([baseDefinition({ status: "active" })]);
    const result = await service.resumeDefinition(USER_ID, "rec1", 0);
    expect(result).toEqual({ ok: false, reason: "already_active" });
  });

  test("rejects resuming an ended definition", async () => {
    const { service } = loadService([baseDefinition({ status: "ended" })]);
    const result = await service.resumeDefinition(USER_ID, "rec1", 0);
    expect(result).toEqual({ ok: false, reason: "already_ended" });
  });
});

describe("endDefinition", () => {
  test("ends an active definition immediately", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.endDefinition(USER_ID, "rec1", 0);

    expect(result.ok).toBe(true);
    expect(result.definition.status).toBe("ended");
    expect(result.definition.endedAt).toBeInstanceOf(Date);
  });

  test("ends a paused definition too -- both active and paused are valid predecessors", async () => {
    const { service } = loadService([baseDefinition({ status: "paused", scheduleVersion: 1 })]);
    const result = await service.endDefinition(USER_ID, "rec1", 1);
    expect(result.ok).toBe(true);
    expect(result.definition.status).toBe("ended");
  });

  test("rejects an already-ended definition", async () => {
    const { service } = loadService([baseDefinition({ status: "ended" })]);
    const result = await service.endDefinition(USER_ID, "rec1", 0);
    expect(result).toEqual({ ok: false, reason: "already_ended" });
  });

  test("ending is terminal -- a subsequent pause/resume/edit on the same id all fail", async () => {
    const { service } = loadService([baseDefinition()]);
    await service.endDefinition(USER_ID, "rec1", 0);

    const pause = await service.pauseDefinition(USER_ID, "rec1", 1);
    const resume = await service.resumeDefinition(USER_ID, "rec1", 1);
    const edit = await service.editDefinition(USER_ID, "rec1", { expenseName: "x" }, 1);

    expect(pause.reason).toBe("already_ended");
    expect(resume.reason).toBe("already_ended");
    expect(edit.reason).toBe("already_ended");
  });
});

describe("editDefinition -- validation", () => {
  test("edits name/category/amount together in one call", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(
      USER_ID,
      "rec1",
      { expenseName: "Netflix Premium", expenseCategory: "entertainment", expenseAmount: 799 },
      0
    );

    expect(result.ok).toBe(true);
    expect(result.definition.expenseName).toBe("Netflix Premium");
    expect(result.definition.expenseCategory).toBe("Entertainment"); // normalized
    expect(result.definition.expenseAmount).toBe(799);
    expect(result.definition.scheduleVersion).toBe(1);
  });

  test("rejects an empty/whitespace-only name", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(USER_ID, "rec1", { expenseName: "   " }, 0);
    expect(result).toEqual({ ok: false, reason: "invalid_name" });
  });

  test("rejects a non-positive amount", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(USER_ID, "rec1", { expenseAmount: 0 }, 0);
    expect(result).toEqual({ ok: false, reason: "invalid_amount" });
  });

  test("rejects a negative amount", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(USER_ID, "rec1", { expenseAmount: -5 }, 0);
    expect(result).toEqual({ ok: false, reason: "invalid_amount" });
  });

  test("rejects a nextDueDate in the past -- the job only ever advances forward", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(
      USER_ID,
      "rec1",
      { nextDueDate: "2020-01-01T00:00:00.000Z" },
      0
    );
    expect(result).toEqual({ ok: false, reason: "next_due_date_in_past" });
  });

  test("accepts a future nextDueDate", async () => {
    const { service } = loadService([baseDefinition()]);
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await service.editDefinition(USER_ID, "rec1", { nextDueDate: future }, 0);
    expect(result.ok).toBe(true);
    expect(new Date(result.definition.nextDueDate).toISOString()).toBe(future);
  });

  test("rejects an unparseable date", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(USER_ID, "rec1", { nextDueDate: "not-a-date" }, 0);
    expect(result).toEqual({ ok: false, reason: "invalid_next_due_date" });
  });

  test("sets an endDate", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(
      USER_ID,
      "rec1",
      { endDate: "2027-01-01T00:00:00.000Z" },
      0
    );
    expect(result.ok).toBe(true);
    expect(new Date(result.definition.endDate).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("explicit null clears a previously set endDate", async () => {
    const { service } = loadService([baseDefinition({ endDate: new Date("2027-01-01") })]);
    const result = await service.editDefinition(USER_ID, "rec1", { endDate: null }, 0);
    expect(result.ok).toBe(true);
    expect(result.definition.endDate).toBeNull();
  });

  test("rejects a call with no editable fields provided", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(USER_ID, "rec1", {}, 0);
    expect(result).toEqual({ ok: false, reason: "no_fields_provided" });
  });

  test("a partial edit (amount only) leaves other fields untouched", async () => {
    const { service } = loadService([baseDefinition()]);
    const result = await service.editDefinition(USER_ID, "rec1", { expenseAmount: 500 }, 0);
    expect(result.definition.expenseAmount).toBe(500);
    expect(result.definition.expenseName).toBe("Netflix");
    expect(result.definition.expenseCategory).toBe("Entertainment");
  });

  test("validation runs BEFORE the CAS write -- an invalid payload never touches scheduleVersion", async () => {
    const { service, model } = loadService([baseDefinition()]);
    await service.editDefinition(USER_ID, "rec1", { expenseAmount: -1 }, 0);
    expect(model.__store.get("rec1").scheduleVersion).toBe(0);
  });

  test("editing does not touch expenseId or any historical-expense-shaped field (REC-002-T03 separation)", async () => {
    const { service, model } = loadService([baseDefinition()]);
    await service.editDefinition(USER_ID, "rec1", { expenseName: "New Name" }, 0);
    expect(model.__store.get("rec1").expenseId).toBe("exp1"); // unchanged
  });
});

describe("compare-and-set concurrency (REC-002-T04)", () => {
  test("two concurrent edits: the first with a stale version wins nothing, the second (fresh) succeeds", async () => {
    const { service } = loadService([baseDefinition()]);

    // Simulate: client A read version 0, client B read version 0 and
    // already committed an edit (server is now at version 1), THEN client
    // A's edit arrives with its now-stale version=0.
    const bResult = await service.editDefinition(USER_ID, "rec1", { expenseAmount: 700 }, 0);
    expect(bResult.ok).toBe(true);
    expect(bResult.definition.scheduleVersion).toBe(1);

    const aResult = await service.editDefinition(USER_ID, "rec1", { expenseAmount: 999 }, 0);
    expect(aResult.ok).toBe(false);
    expect(aResult.reason).toBe("version_conflict");
    // The server's actual value is B's, not A's rejected write.
    expect(aResult.current.expenseAmount).toBe(700);
  });

  test("a pause followed by an edit using the pre-pause version is a version_conflict, not silently applied", async () => {
    const { service } = loadService([baseDefinition()]);
    const paused = await service.pauseDefinition(USER_ID, "rec1", 0);
    expect(paused.ok).toBe(true);

    const staleEdit = await service.editDefinition(USER_ID, "rec1", { expenseAmount: 1 }, 0);
    expect(staleEdit.ok).toBe(false);
    expect(staleEdit.reason).toBe("version_conflict");
  });
});
