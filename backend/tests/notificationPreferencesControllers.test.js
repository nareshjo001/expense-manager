// NOT-003-T02/T07 -- Controllers/NotificationPreferences/{get,update}.js.
// Same fast controller-unit-test pattern as
// recurringLifecycleControllers.test.js -- the service is mocked so this
// file proves only the HTTP mapping (status codes, response shape), not
// the business rules (already covered by
// notificationPreferenceService.test.js).
"use strict";

const SERVICE_PATH = "../Services/NotificationServices/notificationPreferenceService";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

const makeReq = (body = {}, userId = USER_ID) => ({ body, userId });

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const responseBody = (res) => res.json.mock.calls[0][0];

function loadControllers(serviceMock) {
  jest.resetModules();
  jest.doMock(SERVICE_PATH, () => ({
    getEffectivePreferences: jest.fn(),
    savePreferences: jest.fn(),
    ...serviceMock,
  }));
  return {
    get: require("../Controllers/NotificationPreferences/get"),
    update: require("../Controllers/NotificationPreferences/update"),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getNotificationPreferences", () => {
  test("200s with the service's preferences plus type metadata", async () => {
    const preferences = { types: { "recurring-expense": { enabled: true, preview: "device" } }, quietHours: {} };
    const { get } = loadControllers({
      getEffectivePreferences: jest.fn().mockResolvedValue(preferences),
    });
    const res = makeRes();

    await get.getNotificationPreferences(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = responseBody(res);
    expect(body.success).toBe(true);
    expect(body.data.types).toEqual(preferences.types);
    expect(body.data.typeMeta).toBeDefined();
  });

  test("500s on an unexpected service error", async () => {
    const { get } = loadControllers({
      getEffectivePreferences: jest.fn().mockRejectedValue(new Error("db down")),
    });
    const res = makeRes();

    await get.getNotificationPreferences(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res).success).toBe(false);
  });
});

describe("updateNotificationPreferences", () => {
  test("200s with the saved preferences on success", async () => {
    const saved = { types: {}, quietHours: {} };
    const { update } = loadControllers({
      savePreferences: jest.fn().mockResolvedValue({ ok: true, preferences: saved }),
    });
    const res = makeRes();

    await update.updateNotificationPreferences(makeReq({ types: {} }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual(
      expect.objectContaining({ success: true, data: saved })
    );
  });

  test("400s with a mapped message and errorCode on a validation failure", async () => {
    const { update } = loadControllers({
      savePreferences: jest.fn().mockResolvedValue({ ok: false, reason: "invalid_preview", field: "recurring-expense" }),
    });
    const res = makeRes();

    await update.updateNotificationPreferences(makeReq({ types: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = responseBody(res);
    expect(body.success).toBe(false);
    expect(body.errorCode).toBe("INVALID_PREVIEW");
    expect(body.field).toBe("recurring-expense");
  });

  test("400s for no_fields_provided", async () => {
    const { update } = loadControllers({
      savePreferences: jest.fn().mockResolvedValue({ ok: false, reason: "no_fields_provided" }),
    });
    const res = makeRes();

    await update.updateNotificationPreferences(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).errorCode).toBe("NO_FIELDS_PROVIDED");
  });

  test("500s on an unexpected service error", async () => {
    const { update } = loadControllers({
      savePreferences: jest.fn().mockRejectedValue(new Error("db down")),
    });
    const res = makeRes();

    await update.updateNotificationPreferences(makeReq({ types: {} }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res).success).toBe(false);
  });
});
