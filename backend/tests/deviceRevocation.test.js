// NOT-003-T06/T07 -- Controllers/PushNotifications/deviceRevocation.js.
"use strict";

const DEVICE_TOKEN_PATH = "../models/DeviceToken";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

const makeReq = (body = {}, userId = USER_ID) => ({ body, userId });
const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const responseBody = (res) => res.json.mock.calls[0][0];

function loadController({ deleteOneImpl } = {}) {
  jest.resetModules();
  const deleteOneMock = jest.fn(deleteOneImpl || (async () => ({ deletedCount: 1 })));
  jest.doMock(DEVICE_TOKEN_PATH, () => ({ deleteOne: deleteOneMock }));
  const { revokeDeviceToken } = require("../Controllers/PushNotifications/deviceRevocation");
  return { revokeDeviceToken, deleteOneMock };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("revokeDeviceToken", () => {
  test("400s when token is missing", async () => {
    const { revokeDeviceToken } = loadController();
    const res = makeRes();

    await revokeDeviceToken(makeReq({}), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("400s when token is an empty/whitespace string", async () => {
    const { revokeDeviceToken } = loadController();
    const res = makeRes();

    await revokeDeviceToken(makeReq({ token: "   " }), res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("deletes ONLY this user's copy of the token (scoped by token AND userId)", async () => {
    const { revokeDeviceToken, deleteOneMock } = loadController();
    const res = makeRes();

    await revokeDeviceToken(makeReq({ token: "  abc123  " }), res);

    expect(deleteOneMock).toHaveBeenCalledWith({ token: "abc123", userId: USER_ID });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res).success).toBe(true);
  });

  test("is idempotent: deleting an already-gone token still returns 200 success", async () => {
    const { revokeDeviceToken } = loadController({ deleteOneImpl: async () => ({ deletedCount: 0 }) });
    const res = makeRes();

    await revokeDeviceToken(makeReq({ token: "gone" }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res).success).toBe(true);
  });

  test("500s on an unexpected DB error", async () => {
    const { revokeDeviceToken } = loadController({
      deleteOneImpl: async () => { throw new Error("db down"); },
    });
    const res = makeRes();

    await revokeDeviceToken(makeReq({ token: "abc123" }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res).success).toBe(false);
  });
});
