// BALENISA Firebase Startup Resilience -- GET /ping optional-capability field
"use strict";

const request = require("supertest");

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadApp({ mlUp, firebaseAvailable }) {
  jest.resetModules();

  jest.doMock("axios", () => ({
    get: jest.fn(async () => {
      if (!mlUp) throw new Error("ML unreachable");
      return { data: {} };
    }),
  }));

  jest.doMock("../config/firebaseAdmin", () => ({
    isFirebaseAvailable: () => firebaseAvailable,
    getAdmin: () => {
      throw new Error("getAdmin() is not exercised by this test");
    },
    FirebaseUnavailableError: class FirebaseUnavailableError extends Error {},
  }));

  return require("../app");
}

describe("GET /ping -- Firebase/push reported as an optional capability", () => {
  it("push:'up' is included without changing the existing 200 success contract when both ML and Firebase are healthy", async () => {
    const app = loadApp({ mlUp: true, firebaseAvailable: true });
    const res = await request(app).get("/ping");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, backend: "up", ml: "up", push: "up" });
  });

  it("push:'down' is included but does NOT flip the overall success/status when ML is up and Firebase is unavailable", async () => {
    const app = loadApp({ mlUp: true, firebaseAvailable: false });
    const res = await request(app).get("/ping");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, backend: "up", ml: "up", push: "down" });
  });

  it("the existing ML-down 503 contract is preserved in shape, with push appended -- no field removed or renamed", async () => {
    const app = loadApp({ mlUp: false, firebaseAvailable: false });
    const res = await request(app).get("/ping");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      success: false,
      backend: "up",
      ml: "down",
      push: "down",
      message: "Server Unavailable.",
    });
  });
});

describe("Unrelated routes remain fully functional when Firebase is unavailable", () => {
  it("GET / still responds normally", async () => {
    const app = loadApp({ mlUp: true, firebaseAvailable: false });
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
  });

  it("GET /report (unauthenticated) still returns its normal 401 contract, unaffected by Firebase state", async () => {
    const app = loadApp({ mlUp: true, firebaseAvailable: false });
    const res = await request(app).get("/report");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Authorization token missing" });
  });
});
