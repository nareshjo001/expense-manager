// TST-001-T07 -- the deployment smoke test, tested.
//
// A smoke test that only ever executes during a deploy is untested code
// running at the worst possible moment. Worse, its failure mode is silent:
// a check that can no longer fail still prints PASS, and everyone reads that
// as "the deploy is fine".
//
// So this suite does two things. The healthy case runs the smoke test against
// the REAL Express app -- actual helmet, actual cors, actual requestId
// middleware, actual routes -- on a real port, so the assertions are pinned to
// what the application genuinely does rather than to a stub that agrees with
// them by construction. Remove helmet from app.js and this suite goes red.
//
// The failure cases then use stub servers, because the point there is to
// prove each check FAILS on the specific defect it exists to catch. A check
// that never fails is decoration.
"use strict";

const http = require("http");

const { runSmokeTest, report } = require("../scripts/smokeTest");

// --- helpers ---------------------------------------------------------------

async function listen(handlerOrApp) {
  const server = http.createServer(handlerOrApp);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function close(server) {
  await new Promise((resolve) => {
    server.close(resolve);
  });
}

function byId(results, id) {
  return results.find((r) => r.id === id);
}

// Loads the real app with its external dependencies stubbed at the module
// boundary -- the same technique tests/health.routes.test.js uses.
function loadRealApp({ mongoUp = true, redisUp = true, mlUp = true } = {}) {
  jest.resetModules();
  process.env.ML_ROUTE = "http://ml.test";

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
    isFirebaseAvailable: () => true,
    getAdmin: () => {
      throw new Error("not exercised");
    },
    FirebaseUnavailableError: class extends Error {},
  }));

  return require("../app");
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

// --- the healthy case, against the real app --------------------------------

describe("against the real Express app, fully healthy", () => {
  let server;
  let baseUrl;
  let outcome;

  beforeAll(async () => {
    const app = loadRealApp();
    ({ server, baseUrl } = await listen(app));
    outcome = await runSmokeTest({ baseUrl });
  });

  afterAll(async () => {
    await close(server);
  });

  test("every required check passes", () => {
    const failures = outcome.requiredFailures.map((f) => `${f.id}: ${f.detail}`);
    expect(failures).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  test("the only advisory is HSTS, which this suite runs without", () => {
    // Jest sets NODE_ENV=test, and httpSecurity.js enables HSTS only in
    // production -- so its absence here is correct, and the smoke test
    // classifying it as an advisory rather than a failure is exactly why
    // that distinction exists. The CI deployment-smoke job runs with
    // NODE_ENV=production, where this advisory should not appear.
    expect(outcome.advisories.map((a) => a.id)).toEqual(["sec.hsts"]);
    expect(outcome.ok).toBe(true);
  });

  test("the security-header check is pinned to what helmet actually sends", () => {
    // If someone removes or reconfigures helmet in app.js, this fails here --
    // in a unit test on every PR -- rather than in a smoke run against a
    // deployment that has already shipped.
    expect(byId(outcome.results, "sec.headers").ok).toBe(true);
  });

  test("the correlation-ID checks are pinned to the real middleware", () => {
    expect(byId(outcome.results, "obs.requestId.echo").ok).toBe(true);
    expect(byId(outcome.results, "obs.requestId.generated").ok).toBe(true);
    expect(byId(outcome.results, "obs.requestId.hostile").ok).toBe(true);
  });

  test("auth enforcement is checked against the real route stack", () => {
    expect(byId(outcome.results, "auth.enforced").ok).toBe(true);
  });
});

// --- degraded, but still serving -------------------------------------------

describe("against the real app with optional dependencies down", () => {
  test("Redis and ML down are advisories, not failures -- the run still passes", async () => {
    // This is the distinction that makes the output trustworthy. If a Redis
    // outage failed the smoke test, people would learn to ignore a red run.
    const app = loadRealApp({ redisUp: false, mlUp: false });
    const { server, baseUrl } = await listen(app);
    try {
      const outcome = await runSmokeTest({ baseUrl });

      expect(outcome.ok).toBe(true);
      expect(outcome.advisories.map((a) => a.id).sort()).toEqual([
        "deps.ml",
        "deps.redis",
        // Present because this suite runs with NODE_ENV=test; see the
        // healthy-case suite above.
        "sec.hsts",
      ]);
      // /ping returns 503 when ML is down. That is its documented meaning and
      // must not read as a deployment failure.
      expect(byId(outcome.results, "ping.compat").ok).toBe(true);
    } finally {
      await close(server);
    }
  });

  test("MongoDB down fails the run", async () => {
    const app = loadRealApp({ mongoUp: false });
    const { server, baseUrl } = await listen(app);
    try {
      const outcome = await runSmokeTest({ baseUrl });

      expect(outcome.ok).toBe(false);
      expect(outcome.requiredFailures.map((f) => f.id)).toEqual(
        expect.arrayContaining(["health.ready", "health.deps"])
      );
      // Liveness still passes: the process is fine, the database is not, and
      // restarting the process would not change that.
      expect(byId(outcome.results, "health.live").ok).toBe(true);
    } finally {
      await close(server);
    }
  });
});

// --- each check actually fails on its own defect ---------------------------

describe("each check fails on the defect it exists to catch", () => {
  // A stub that is healthy by default, with one thing broken per test.
  function stub({ omitSecurityHeaders = false, echoAnyId = false, wildcardCors = false, serveWithoutAuth = false } = {}) {
    return (req, res) => {
      const url = req.url.split("?")[0];

      if (!omitSecurityHeaders) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'");
        res.setHeader("Referrer-Policy", "no-referrer");
      }
      if (wildcardCors && req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      }

      // Mirrors requestId.js: reuse a caller's ID only when it is safely
      // shaped, otherwise generate one. `echoAnyId` is the defect -- echoing
      // whatever arrived, which is the log-injection bug.
      const incoming = req.headers["x-request-id"];
      const safe = typeof incoming === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(incoming);
      res.setHeader(
        "X-Request-ID",
        incoming && (echoAnyId || safe) ? incoming : "generated-id-12345"
      );

      const send = (status, body) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };

      if (url === "/health/live") return send(200, { status: "live", role: "web", uptimeSeconds: 5 });
      if (url === "/health/ready") return send(200, { success: true, status: "ready", mongo: "up" });
      if (url === "/health/deps") {
        return send(200, { dependencies: { mongo: "up", redis: "up", ml: "up", push: "up" } });
      }
      if (url === "/ping") return send(200, { backend: "up", ml: "up", push: "up" });
      if (["/report", "/expense", "/income"].includes(url)) {
        return serveWithoutAuth ? send(200, { data: ["private"] }) : send(401, { message: "Authorization token missing" });
      }
      return send(404, {});
    };
  }

  async function runAgainst(handler) {
    const { server, baseUrl } = await listen(handler);
    try {
      return await runSmokeTest({ baseUrl });
    } finally {
      await close(server);
    }
  }

  test("a clean stub passes, so the failures below are attributable", async () => {
    const outcome = await runAgainst(stub());
    expect(outcome.requiredFailures).toEqual([]);
  });

  test("missing security headers fail sec.headers", async () => {
    const outcome = await runAgainst(stub({ omitSecurityHeaders: true }));
    expect(byId(outcome.results, "sec.headers").ok).toBe(false);
    expect(outcome.ok).toBe(false);
  });

  test("a wildcard CORS origin fails sec.cors", async () => {
    const outcome = await runAgainst(stub({ wildcardCors: true }));
    const check = byId(outcome.results, "sec.cors");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("*");
  });

  test("echoing a malformed correlation ID verbatim fails obs.requestId.hostile", async () => {
    // The log-injection defect: a server that reflects whatever arrived in
    // X-Request-ID puts caller-controlled text straight into log lines.
    const outcome = await runAgainst(stub({ echoAnyId: true }));

    const hostile = byId(outcome.results, "obs.requestId.hostile");
    expect(hostile.ok).toBe(false);
    expect(hostile.detail).toContain("verbatim");
    expect(outcome.ok).toBe(false);

    // The two ID checks are independent: a well-formed ID still round-trips,
    // so this failure is attributable to the guard and not to echoing itself.
    expect(byId(outcome.results, "obs.requestId.echo").ok).toBe(true);
  });

  test("serving data without authentication fails auth.enforced", async () => {
    // The single most important check in the script. If it cannot fail, it is
    // worthless.
    const outcome = await runAgainst(stub({ serveWithoutAuth: true }));
    const check = byId(outcome.results, "auth.enforced");
    expect(check.ok).toBe(false);
    expect(check.detail).toContain("SERVING WITHOUT AUTH");
    expect(outcome.ok).toBe(false);
  });

  test("an unreachable host fails every check without crashing the run", async () => {
    // Nothing listens on this port. A smoke test pointed at a dead deployment
    // must report that clearly, not throw a stack trace.
    const outcome = await runSmokeTest({ baseUrl: "http://127.0.0.1:1" });

    expect(outcome.ok).toBe(false);
    expect(outcome.results.every((r) => !r.ok)).toBe(true);
    expect(outcome.results[0].detail).toContain("request failed");
  });
});

describe("--expect-role", () => {
  test("a web service reporting role 'all' fails when web is expected", async () => {
    // Catches the deploy where PROCESS_ROLE did not get set, so the web tier
    // is also running every scheduled job (OPS-004-T05).
    const handler = (req, res) => {
      res.setHeader("X-Request-ID", "x");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "live", role: "all", uptimeSeconds: 1 }));
    };
    const { server, baseUrl } = await listen(handler);
    try {
      const outcome = await runSmokeTest({ baseUrl, expectRole: "web" });
      const check = byId(outcome.results, "process.role");
      expect(check.ok).toBe(false);
      expect(check.detail).toContain('expected role "web"');
    } finally {
      await close(server);
    }
  });

  test("without --expect-role the role is reported, not asserted", async () => {
    const outcome = await runSmokeTest({ baseUrl: "http://127.0.0.1:1" });
    expect(byId(outcome.results, "process.role").required).toBe(false);
  });
});

describe("report()", () => {
  test("names the failing checks and says why each matters", async () => {
    const outcome = await runSmokeTest({ baseUrl: "http://127.0.0.1:1" });
    const text = report(outcome, "http://127.0.0.1:1");

    expect(text).toContain("FAILED:");
    expect(text).toContain("why it matters:");
    // The operator reading this during an incident should not have to open
    // the source to find out which check failed.
    expect(text).toContain("health.ready");
  });
});
