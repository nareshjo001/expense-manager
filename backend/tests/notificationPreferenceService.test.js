// NOT-003-T02/T03/T04/T07 -- Services/NotificationServices/
// notificationPreferenceService.js.
//
// Exercised against a small in-memory fake NotificationPreference model,
// the same fast pattern recurringLifecycleService.test.js uses -- no real
// Mongo, no requiring the full Express app.
"use strict";

const MODEL_PATH = "../models/NotificationPreference";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

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
  const service = require("../Services/NotificationServices/notificationPreferenceService");
  return { service, model };
}

afterEach(() => {
  jest.resetModules();
});

describe("getEffectivePreferences", () => {
  test("a user with no saved document gets every registered type at its default, and default quiet hours", async () => {
    const { service } = loadService([]);
    const prefs = await service.getEffectivePreferences(USER_ID);

    expect(prefs.types["recurring-expense"]).toEqual({ enabled: true, preview: "device" });
    expect(prefs.types["recurring-expense-ended"]).toEqual({ enabled: true, preview: "device" });
    expect(prefs.quietHours).toEqual({ enabled: false, start: "22:00", end: "07:00", timeZone: null });
  });

  test("a saved document's values override the default for types present in it", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "recurring-expense": { enabled: false, preview: "generic" } } },
    ]);
    const prefs = await service.getEffectivePreferences(USER_ID);

    expect(prefs.types["recurring-expense"]).toEqual({ enabled: false, preview: "generic" });
    // A type absent from the saved document still falls back to the default.
    expect(prefs.types["recurring-expense-ended"]).toEqual({ enabled: true, preview: "device" });
  });

  test("a garbage-shaped saved preference for a type falls back to the default rather than propagating bad data", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "recurring-expense": { enabled: "yes", preview: "loud" } } },
    ]);
    const prefs = await service.getEffectivePreferences(USER_ID);
    expect(prefs.types["recurring-expense"]).toEqual({ enabled: true, preview: "device" });
  });

  test("an unregistered type key in a saved document is ignored", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "totally-made-up": { enabled: false, preview: "generic" } } },
    ]);
    const prefs = await service.getEffectivePreferences(USER_ID);
    expect(prefs.types["totally-made-up"]).toBeUndefined();
  });
});

describe("savePreferences", () => {
  test("saving only types leaves quiet hours at defaults and does not require it", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, {
      types: { "recurring-expense": { enabled: false } },
    });

    expect(result.ok).toBe(true);
    expect(result.preferences.types["recurring-expense"]).toEqual({ enabled: false, preview: "device" });
    expect(result.preferences.quietHours.enabled).toBe(false);
  });

  test("saving only quietHours leaves previously saved types untouched", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "recurring-expense": { enabled: false, preview: "generic" } } },
    ]);
    const result = await service.savePreferences(USER_ID, {
      quietHours: { enabled: true, start: "23:00", end: "06:00" },
    });

    expect(result.ok).toBe(true);
    expect(result.preferences.types["recurring-expense"]).toEqual({ enabled: false, preview: "generic" });
    expect(result.preferences.quietHours).toEqual({ enabled: true, start: "23:00", end: "06:00", timeZone: null });
  });

  test("a partial types save merges onto the existing saved types, not the full registry-merged view", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "recurring-expense": { enabled: false, preview: "generic" } } },
    ]);
    await service.savePreferences(USER_ID, {
      types: { "recurring-expense-ended": { enabled: false } },
    });

    const prefs = await service.getEffectivePreferences(USER_ID);
    // The type from the first save is untouched...
    expect(prefs.types["recurring-expense"]).toEqual({ enabled: false, preview: "generic" });
    // ...and the newly-saved type took effect.
    expect(prefs.types["recurring-expense-ended"]).toEqual({ enabled: false, preview: "device" });
  });

  test("rejects a non-boolean enabled", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, {
      types: { "recurring-expense": { enabled: "nope" } },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_enabled", field: "recurring-expense" });
  });

  test("rejects an unrecognized preview mode", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, {
      types: { "recurring-expense": { preview: "loud" } },
    });
    expect(result).toEqual({ ok: false, reason: "invalid_preview", field: "recurring-expense" });
  });

  test("rejects a malformed quiet-hours start/end", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, { quietHours: { start: "9am" } });
    expect(result).toEqual({ ok: false, reason: "invalid_quiet_hours_start" });
  });

  test("rejects an invalid quiet-hours time zone", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, { quietHours: { timeZone: "Not/AZone" } });
    expect(result).toEqual({ ok: false, reason: "invalid_quiet_hours_time_zone" });
  });

  test("accepts an explicit null time zone (means: use the app default)", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, { quietHours: { timeZone: null } });
    expect(result.ok).toBe(true);
    expect(result.preferences.quietHours.timeZone).toBeNull();
  });

  test("rejects an empty payload (neither types nor quietHours provided)", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, {});
    expect(result).toEqual({ ok: false, reason: "no_fields_provided" });
  });

  test("an unrecognized type key in the payload is silently dropped, not rejected", async () => {
    const { service } = loadService([]);
    const result = await service.savePreferences(USER_ID, {
      types: { "totally-made-up": { enabled: false } },
    });
    expect(result.ok).toBe(true);
    expect(result.preferences.types["totally-made-up"]).toBeUndefined();
  });
});

describe("resolveSendPolicy", () => {
  test("an unknown/missing type defers entirely to the device (today's exact pre-NOT-003 behavior)", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "recurring-expense": { enabled: false, preview: "generic" } } },
    ]);
    expect(await service.resolveSendPolicy(USER_ID, null)).toEqual({
      enabled: true,
      preview: "device",
      quiet: false,
    });
    expect(await service.resolveSendPolicy(USER_ID, "unregistered-type")).toEqual({
      enabled: true,
      preview: "device",
      quiet: false,
    });
  });

  test("a disabled type resolves enabled:false", async () => {
    const { service } = loadService([
      { userId: USER_ID, types: { "recurring-expense": { enabled: false, preview: "device" } } },
    ]);
    const policy = await service.resolveSendPolicy(USER_ID, "recurring-expense");
    expect(policy.enabled).toBe(false);
  });

  test("quiet hours gate the send when active for the resolved zone", async () => {
    const { service } = loadService([
      {
        userId: USER_ID,
        quietHours: { enabled: true, start: "22:00", end: "07:00", timeZone: "UTC" },
      },
    ]);
    const insideQuiet = new Date("2026-01-01T23:00:00.000Z");
    const outsideQuiet = new Date("2026-01-01T12:00:00.000Z");

    expect((await service.resolveSendPolicy(USER_ID, "recurring-expense", insideQuiet)).quiet).toBe(true);
    expect((await service.resolveSendPolicy(USER_ID, "recurring-expense", outsideQuiet)).quiet).toBe(false);
  });

  test("quiet hours disabled never gates, regardless of the current time", async () => {
    const { service } = loadService([
      { userId: USER_ID, quietHours: { enabled: false, start: "00:00", end: "23:59", timeZone: "UTC" } },
    ]);
    const anyTime = new Date("2026-01-01T12:00:00.000Z");
    expect((await service.resolveSendPolicy(USER_ID, "recurring-expense", anyTime)).quiet).toBe(false);
  });
});
