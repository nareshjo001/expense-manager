// AI-001-T05 -- sia/aiSummaryPreferenceService.js.
//
// Exercised against a small in-memory fake AiSummaryPreference model, the
// same fast pattern tests/notificationPreferenceService.test.js uses for
// its structurally-identical sibling -- no real Mongo, no Express app.
"use strict";

const MODEL_PATH = "../models/AiSummaryPreference";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

// currentPeriodKey/MAX_REGENERATIONS_PER_MONTH are pure (no DB touch), so
// they're read once from the REAL module, before any jest.doMock below --
// this lets seed-data fixtures below reference them directly instead of
// reaching into a `service` that isn't bound yet in its own initializer.
const { currentPeriodKey: realCurrentPeriodKey, MAX_REGENERATIONS_PER_MONTH: MAX } = require("../sia/aiSummaryPreferenceService");

function makeFakeModel(seedDocs = []) {
  const store = new Map();
  for (const doc of seedDocs) store.set(String(doc.userId), { ...doc });

  return {
    __store: store,
    findOne: (filter) => ({
      lean: async () => {
        const doc = [...store.values()].find((d) => String(d.userId) === String(filter.userId));
        return doc ? { ...doc } : null;
      },
    }),
    findOneAndUpdate: async (filter, update) => {
      let doc = [...store.values()].find((d) => String(d.userId) === String(filter.userId));
      if (!doc) {
        doc = { userId: filter.userId, ...(update.$setOnInsert || {}) };
        store.set(String(filter.userId), doc);
      }
      if (update.$set) Object.assign(doc, update.$set);
      return { ...doc };
    },
  };
}

function loadService(seedDocs) {
  jest.resetModules();
  const model = makeFakeModel(seedDocs);
  jest.doMock(MODEL_PATH, () => model);
  const service = require("../sia/aiSummaryPreferenceService");
  return { service, model };
}

afterEach(() => {
  jest.resetModules();
});

describe("currentPeriodKey", () => {
  test("formats as zero-padded YYYY-MM", () => {
    const { service } = loadService([]);
    expect(service.currentPeriodKey(new Date("2026-09-24T10:00:00Z"))).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("getPreference", () => {
  test("a user with no saved document is not opted in and has full regenerations remaining", async () => {
    const { service } = loadService([]);
    const pref = await service.getPreference(USER_ID);
    expect(pref.optedIn).toBe(false);
    expect(pref.regenerationsUsed).toBe(0);
    expect(pref.regenerationsRemaining).toBe(service.MAX_REGENERATIONS_PER_MONTH);
  });

  test("usage from a PAST period reads as 0 (stale counter, read-time reset)", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const { service } = loadService([
      { userId: USER_ID, optedIn: true, regenerationPeriod: "2026-08", regenerationCount: 4 },
    ]);
    const pref = await service.getPreference(USER_ID, now);
    expect(pref.regenerationsUsed).toBe(0);
    expect(pref.regenerationsRemaining).toBe(service.MAX_REGENERATIONS_PER_MONTH);
  });

  test("usage from the CURRENT period is reported as-is", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const { service } = loadService([
      { userId: USER_ID, optedIn: true, regenerationPeriod: realCurrentPeriodKey(now), regenerationCount: 2 },
    ]);
    const pref = await service.getPreference(USER_ID, now);
    expect(pref.regenerationsUsed).toBe(2);
    expect(pref.regenerationsRemaining).toBe(MAX - 2);
  });
});

describe("setOptIn", () => {
  test("rejects a non-boolean value", async () => {
    const { service } = loadService([]);
    const result = await service.setOptIn(USER_ID, "yes");
    expect(result).toEqual({ ok: false, reason: "invalid_opted_in" });
  });

  test("upserts optedIn for a brand-new user", async () => {
    const { service, model } = loadService([]);
    const result = await service.setOptIn(USER_ID, true);
    expect(result.ok).toBe(true);
    expect(result.preference.optedIn).toBe(true);
    expect(model.__store.get(USER_ID).optedIn).toBe(true);
  });

  test("never touches the regeneration counter", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const { service } = loadService([
      { userId: USER_ID, optedIn: true, regenerationPeriod: realCurrentPeriodKey(now), regenerationCount: 3 },
    ]);
    await service.setOptIn(USER_ID, false);
    const pref = await service.getPreference(USER_ID, now);
    expect(pref.regenerationsUsed).toBe(3);
  });
});

describe("recordRegeneration", () => {
  test("rejects a user who has not opted in, without touching the counter", async () => {
    const { service, model } = loadService([]);
    const result = await service.recordRegeneration(USER_ID);
    expect(result).toEqual({ allowed: false, reasonCode: "NOT_OPTED_IN" });
    expect(model.__store.has(USER_ID)).toBe(false);
  });

  test("allows and increments usage for an opted-in user under the cap", async () => {
    const { service } = loadService([{ userId: USER_ID, optedIn: true }]);
    const result = await service.recordRegeneration(USER_ID);
    expect(result.allowed).toBe(true);
    expect(result.regenerationsUsed).toBe(1);
    expect(result.regenerationsRemaining).toBe(MAX - 1);
  });

  test("rejects once the monthly cap is reached, without incrementing further", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const { service, model } = loadService([
      {
        userId: USER_ID,
        optedIn: true,
        regenerationPeriod: realCurrentPeriodKey(now),
        regenerationCount: MAX,
      },
    ]);
    const result = await service.recordRegeneration(USER_ID, now);
    expect(result).toEqual({
      allowed: false,
      reasonCode: "REGENERATION_LIMIT_EXCEEDED",
      regenerationsUsed: MAX,
      regenerationLimit: MAX,
      regenerationsRemaining: 0,
    });
    expect(model.__store.get(USER_ID).regenerationCount).toBe(MAX);
  });

  test("resets the counter to 1 when the stored period has rolled over", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const { service } = loadService([
      { userId: USER_ID, optedIn: true, regenerationPeriod: "2026-08", regenerationCount: MAX },
    ]);
    const result = await service.recordRegeneration(USER_ID, now);
    expect(result.allowed).toBe(true);
    expect(result.regenerationsUsed).toBe(1);
  });
});
