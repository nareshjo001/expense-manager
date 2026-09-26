// OBS-001-T07 -- the request-ID middleware must run before body parsing.
//
// It used to be registered after express.json(), so a request whose JSON
// body failed to parse went straight to the error handler without ever
// getting an ID: the error log line said requestId null, the response had
// no X-Request-ID, and the request never reached the metrics counters.
// scripts/verifyObservability.js found this against a real server; this
// pins it at unit level.
"use strict";

const request = require("supertest");

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadApp() {
  jest.resetModules();
  jest.doMock("../config/redis", () => ({
    isRedisAvailable: () => false,
    redisClient: { isReady: false },
    connectRedis: jest.fn(),
  }));
  jest.doMock("../config/firebaseAdmin", () => ({
    isFirebaseAvailable: () => false,
    getAdmin: () => {
      throw new Error("not exercised");
    },
    FirebaseUnavailableError: class FirebaseUnavailableError extends Error {},
  }));
  return require("../app");
}

const parsedLines = (spy) =>
  spy.mock.calls
    .map((c) => {
      try {
        return JSON.parse(c[0]);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

describe("malformed JSON body", () => {
  test("still gets the client's X-Request-ID on the response and on its error log line", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    const app = loadApp();

    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .set("X-Request-ID", "order-test-1")
      .send('{"email":"a@b.test","password":');

    expect(res.status).toBe(400);
    expect(res.headers["x-request-id"]).toBe("order-test-1");
    expect(parsedLines(errorSpy)).toContainEqual(
      expect.objectContaining({ event: "unhandled_request_error", statusCode: 400, requestId: "order-test-1" })
    );
  });

  test("gets a server-generated ID when the client sends none", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});
    const app = loadApp();

    const res = await request(app)
      .post("/auth/login")
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
    expect(res.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._-]{1,128}$/);
  });
});
