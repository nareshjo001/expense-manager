// SIA-001-T06 -- sia/siaPreferenceService.js. Exercised against a small
// in-memory fake SiaPreference model, the same fast pattern
// sia.aiSummaryPreferenceService.test.js uses for its structurally-similar
// sibling -- no real Mongo, no Express app.
"use strict";

const MODEL_PATH = "../models/SiaPreference";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

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
  const service = require("../sia/siaPreferenceService");
  return { service, model };
}

afterEach(() => {
  jest.resetModules();
});

describe("getPreference", () => {
  test("a user with no saved document is enabled (opt-OUT default, not opt-in)", async () => {
    const { service } = loadService([]);
    const pref = await service.getPreference(USER_ID);
    expect(pref).toEqual({ enabled: true });
  });

  test("a user with enabled: true is enabled", async () => {
    const { service } = loadService([{ userId: USER_ID, enabled: true }]);
    const pref = await service.getPreference(USER_ID);
    expect(pref).toEqual({ enabled: true });
  });

  test("a user with enabled: false is disabled", async () => {
    const { service } = loadService([{ userId: USER_ID, enabled: false }]);
    const pref = await service.getPreference(USER_ID);
    expect(pref).toEqual({ enabled: false });
  });
});

describe("isEnabledForUser", () => {
  test("returns true for a user with no saved document", async () => {
    const { service } = loadService([]);
    expect(await service.isEnabledForUser(USER_ID)).toBe(true);
  });

  test("returns false for a user who disabled SIA", async () => {
    const { service } = loadService([{ userId: USER_ID, enabled: false }]);
    expect(await service.isEnabledForUser(USER_ID)).toBe(false);
  });
});

describe("setEnabled", () => {
  test("rejects a non-boolean value without writing anything", async () => {
    const { service, model } = loadService([]);
    const result = await service.setEnabled(USER_ID, "yes");
    expect(result).toEqual({ ok: false, reason: "invalid_enabled" });
    expect(model.__store.size).toBe(0);
  });

  test("creates a new document for a first-time toggle", async () => {
    const { service, model } = loadService([]);
    const result = await service.setEnabled(USER_ID, false);
    expect(result.ok).toBe(true);
    expect(result.preference).toEqual({ enabled: false });
    expect(model.__store.get(USER_ID).enabled).toBe(false);
  });

  test("updates an existing document's enabled flag only", async () => {
    const { service, model } = loadService([{ userId: USER_ID, enabled: false, someOtherField: "kept" }]);
    const result = await service.setEnabled(USER_ID, true);
    expect(result.ok).toBe(true);
    expect(result.preference).toEqual({ enabled: true });
    expect(model.__store.get(USER_ID)).toMatchObject({ enabled: true, someOtherField: "kept" });
  });
});
