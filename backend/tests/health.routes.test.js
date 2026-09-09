// OPS-004-T03 -- liveness / readiness / dependency health.
//
// The regression these tests exist to prevent is specific and was live in
// this codebase: /ping returns 503 when the ML service is down, so wiring a
// platform health check to it makes the platform restart a healthy backend
// because an optional service is unavailable.
"use strict";

const request = require("supertest");

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

// mongoose.connection.readyState: 1 = connected, 0 = disconnected.
function loadApp({ mongoUp = true, redisUp = true, mlUp = true, firebase = true, mlRoute = "http://ml.test" } = {}) {
  jest.resetModules();

  process.env.ML_ROUTE = mlRoute;

  jest.doMock("mongoose", () => {
    const actual = jest.requireActual("mongoose");
    return { ...actual, connection: { readyState: mongoUp ? 1 : 0 } };
  });

  jest.doMock("axios", () => ({
    get: jest.fn(async () => {
      if (!mlUp) throw new Error("ML unreachable");
      return { data: {} };
    }),
  }));

  jest.doMock("../config/redis", () => ({
    isRedisAvailable: () => redisUp,
    redisClient: { isReady: redisUp },
    connectRedis: jest.fn(),
  }));

  jest.doMock("../config/firebaseAdmin", () => ({
    isFirebaseAvailable: () => firebase,
    getAdmin: () => {
      throw new Error("getAdmin() is not exercised by this test");
    },
    FirebaseUnavailableError: class FirebaseUnavailableError extends Error {},
  }));

  return require("../app");
}

describe("GET /health/live -- liveness", () => {
  test("returns 200 when every dependency is down", async () => {
    // This is the whole point of a separate liveness probe. The only action
    // a platform takes on a failed liveness check is "restart this process",
    // and restarting cannot fix Mongo, Redis or the ML service. Answering
    // anything but 200 here converts a dependency outage into a crash loop.
    const app = loadApp({ mongoUp: false, redisUp: false, mlUp: false, firebase: false });
    const res = await request(app).get("/health/live");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("live");
  });

  test("reports the process role and uptime", async () => {
    const app = loadApp();
    const res = await request(app).get("/health/live");

    expect(res.body.role).toBe("all");
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });

  test("performs no dependency I/O", async () => {
    // A liveness probe runs every few seconds per instance. One that calls
    // out to a dependency both slows down under load and starts failing for
    // reasons that are not about liveness.
    const app = loadApp();
    const axios = require("axios");
    await request(app).get("/health/live");

    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("GET /health/ready -- readiness", () => {
  test("200 when MongoDB is reachable", async () => {
    const app = loadApp({ mongoUp: true });
    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, status: "ready", mongo: "up" });
  });

  test("503 when MongoDB is unreachable", async () => {
    // Mongo is the authoritative store (ADR-0002); without it nearly every
    // route errors, so this instance should stop receiving traffic. Note it
    // should be drained, not restarted -- which is why this is /ready and
    // not /live.
    const app = loadApp({ mongoUp: false });
    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
  });

  test("stays 200 when Redis is down", async () => {
    // Redis is disposable (ADR-0002): caching falls through to Mongo and
    // scheduled jobs fail closed (REC-001-T03). An instance in that state
    // still returns correct responses and must keep its traffic.
    const app = loadApp({ mongoUp: true, redisUp: false });
    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
  });

  test("stays 200 when the ML service is down -- the /ping bug, not repeated", async () => {
    const app = loadApp({ mongoUp: true, mlUp: false });

    const ready = await request(app).get("/health/ready");
    const ping = await request(app).get("/ping");

    expect(ready.status).toBe(200);
    // /ping's 503 is preserved deliberately: the frontend and existing
    // monitoring read that status code, and silently redefining it would
    // break whoever relied on the old meaning. The fix is a probe that does
    // not have that meaning, not a change to this one.
    expect(ping.status).toBe(503);
  });

  test("does not call the ML service at all", async () => {
    const app = loadApp();
    const axios = require("axios");
    await request(app).get("/health/ready");

    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("GET /health/deps -- dependency reporting", () => {
  test("returns 200 even when dependencies are down, with the truth in the body", async () => {
    // Always 200 on purpose: this endpoint's job is to report accurately for
    // a human or a dashboard. A non-200 invites someone to attach automation
    // to it, which is how /ping became a trap.
    const app = loadApp({ mongoUp: false, redisUp: false, mlUp: false, firebase: false });
    const res = await request(app).get("/health/deps");

    expect(res.status).toBe(200);
    expect(res.body.dependencies).toEqual({
      mongo: "down",
      redis: "down",
      ml: "down",
      push: "not_configured",
    });
    expect(res.body.status).toBe("degraded");
  });

  test("reports every dependency up when they are", async () => {
    const app = loadApp();
    const res = await request(app).get("/health/deps");

    expect(res.body.dependencies).toEqual({
      mongo: "up",
      redis: "up",
      ml: "up",
      push: "up",
    });
    expect(res.body.status).toBe("serving");
  });

  test("distinguishes an unconfigured ML service from an unreachable one", async () => {
    // "not_configured" and "down" call for different responses: one is a
    // deployment that never enabled the capability, the other is an
    // incident. Collapsing them into "down" pages someone for the former.
    const app = loadApp({ mlRoute: "" });
    const res = await request(app).get("/health/deps");

    expect(res.body.dependencies.ml).toBe("not_configured");
  });

  test("bounds the ML probe so a hung dependency cannot hang the probe", async () => {
    const app = loadApp();
    const axios = require("axios");
    await request(app).get("/health/deps");

    expect(axios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: expect.any(Number) })
    );
  });

  test("Mongo up with Redis down is 'serving', not 'degraded'", async () => {
    const app = loadApp({ mongoUp: true, redisUp: false, mlUp: false });
    const res = await request(app).get("/health/deps");

    expect(res.body.status).toBe("serving");
  });
});

describe("health probes are not rate limited", () => {
  test("repeated liveness probes all succeed", async () => {
    // The platform probes every few seconds from its own network, so a
    // limiter would eventually return 429 and take a healthy instance out of
    // rotation for being healthy too consistently.
    const app = loadApp();

    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).get("/health/live");
      expect(res.status).toBe(200);
    }
  });
});
