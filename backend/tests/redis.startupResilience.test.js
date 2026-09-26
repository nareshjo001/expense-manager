// OPS-004-T04 -- an unreachable Redis degrades the backend, it does not stop it.
//
// THIS SUITE WAS WRONG AND PASSED ANYWAY. Its first version mocked
// `connect()` as rejecting immediately and asserted connectRedis() swallowed
// the rejection. node-redis does not reject when there is no server: the
// default reconnect strategy retries indefinitely and the promise stays
// PENDING. So the test verified a failure mode that does not occur, went
// green, and the real behaviour -- startup hanging forever before
// app.listen() -- shipped.
//
// It was caught by the OPS-002-T06 drill job, the first thing that ever
// booted this backend with no Redis at all. The log was unmistakable in
// hindsight: "DB Connected", then an endless run of connection errors, and
// no "Server running on port" line.
//
// So the central test here is the one that models a connect() which NEVER
// SETTLES, and asserts connectRedis() resolves regardless. Everything else is
// secondary to that.
"use strict";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  jest.useRealTimers();
  delete process.env.REDIS_URL;
});

// `connectBehaviour`:
//   "resolves" -- a healthy Redis.
//   "pending"  -- no Redis at all. This is what actually happens, and the
//                 case the previous suite failed to model.
//   "rejects"  -- kept because a bad URL or auth failure can still reject,
//                 and that path must not throw either.
function loadRedisModule({ connectBehaviour = "resolves", isReady = true } = {}) {
  jest.resetModules();

  const connect = jest.fn(() => {
    if (connectBehaviour === "resolves") return Promise.resolve();
    if (connectBehaviour === "rejects") return Promise.reject(new Error("ECONNREFUSED"));
    // Never settles.
    return new Promise(() => {});
  });

  const client = {
    connect,
    on: jest.fn(),
    get isReady() {
      return connectBehaviour === "resolves" ? isReady : false;
    },
    isOpen: false,
  };

  jest.doMock("redis", () => ({ createClient: () => client }));

  return { module: require("../config/redis"), client, connect };
}

describe("connectRedis -- the startup hang", () => {
  test("resolves even when connect() never settles", async () => {
    // The assertion the previous suite did not make, and the whole feature.
    // If this hangs, startup hangs, and the process never binds a port.
    jest.useFakeTimers();
    const { module } = loadRedisModule({ connectBehaviour: "pending" });

    const pending = module.connectRedis();
    jest.advanceTimersByTime(5000);

    await expect(pending).resolves.toEqual(
      expect.objectContaining({ connected: false, timedOut: true })
    );
  });

  test("does not wait indefinitely -- the wait is bounded by a timer", async () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(global, "setTimeout");
    const { module } = loadRedisModule({ connectBehaviour: "pending" });

    const pending = module.connectRedis();
    expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

    jest.advanceTimersByTime(5000);
    await pending;
  });

  test("the abandoned attempt cannot become an unhandled rejection", async () => {
    // server.js's process-level unhandledRejection handler calls
    // process.exit(1). An attempt that outlives connectRedis() and later
    // rejects with nobody awaiting it would therefore reintroduce "Redis
    // takes the backend down" by the back door.
    jest.useFakeTimers();
    const onUnhandled = jest.fn();
    process.on("unhandledRejection", onUnhandled);

    try {
      const { module } = loadRedisModule({ connectBehaviour: "rejects" });
      await module.connectRedis();
      jest.useRealTimers();
      // Give the microtask queue a turn -- an unhandled rejection is reported
      // asynchronously, so asserting synchronously would always pass.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("connectRedis -- outcomes", () => {
  test("reports connected:true on success", async () => {
    const { module } = loadRedisModule();
    await expect(module.connectRedis()).resolves.toEqual({ connected: true });
  });

  test("does not throw when the connection is refused", async () => {
    const { module } = loadRedisModule({ connectBehaviour: "rejects" });
    await expect(module.connectRedis()).resolves.toEqual(
      expect.objectContaining({ connected: false })
    );
  });

  test("reports connected:false when connect() resolves but the client is not ready", async () => {
    // A resolved connect with isReady false would otherwise be reported as a
    // working cache, and /health/deps would disagree with startup.
    const { module } = loadRedisModule({ connectBehaviour: "resolves", isReady: false });
    await expect(module.connectRedis()).resolves.toEqual(
      expect.objectContaining({ connected: false })
    );
  });

  test("registers an 'error' listener on the client", async () => {
    // Not decoration: an EventEmitter with no "error" listener rethrows as an
    // uncaught exception, which server.js's handler turns into an exit.
    const { client } = loadRedisModule();
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  test("no custom retry timer is scheduled -- node-redis owns retrying", async () => {
    // The previous version scheduled its own 30s retry interval, which was
    // both redundant (node-redis retries the initial connection itself) and
    // unsafe (calling connect() again while an attempt is pending throws).
    jest.useFakeTimers();
    const spy = jest.spyOn(global, "setInterval");

    const { module } = loadRedisModule({ connectBehaviour: "pending" });
    const pending = module.connectRedis();
    jest.advanceTimersByTime(5000);
    await pending;

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("isRedisAvailable", () => {
  test("reads the client's live state rather than a remembered flag", () => {
    // A boolean set once at connect time goes stale the moment the connection
    // drops, and would make /health/deps confidently wrong. It is also what
    // lets a late-arriving Redis start reporting as available on its own.
    const { module } = loadRedisModule({ isReady: true });
    expect(module.isRedisAvailable()).toBe(true);
  });

  test("reports false when the client is not ready", () => {
    const { module } = loadRedisModule({ connectBehaviour: "pending" });
    expect(module.isRedisAvailable()).toBe(false);
  });
});

describe("error logging", () => {
  // The handler writes one structured JSON line through utils/logger.js
  // (OBS-001-T03), so assert on the parsed record rather than on a raw
  // console.error("Redis Error:", ...) argument list.
  const loggedEvents = (spy) =>
    spy.mock.calls
      .map((c) => { try { return JSON.parse(c[0]); } catch { return null; } })
      .filter(Boolean);

  test("logs something identifiable when the error has no message", () => {
    // A plain connection refusal arrives with an empty `message`, which is
    // how this file produced twenty consecutive lines reading "Redis Error:"
    // and nothing else -- naming neither the host nor the reason.
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { client } = loadRedisModule();

    const handler = client.on.mock.calls.find((c) => c[0] === "error")[1];
    handler({ message: "", code: "ECONNREFUSED" });

    expect(loggedEvents(errorSpy)).toContainEqual(
      expect.objectContaining({ scope: "redis", event: "redis_client_error", detail: "ECONNREFUSED" })
    );
  });

  test("falls back to aggregated causes when there is neither message nor code", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { client } = loadRedisModule();

    const handler = client.on.mock.calls.find((c) => c[0] === "error")[1];
    handler({ errors: [{ code: "ECONNREFUSED" }, { code: "EAI_AGAIN" }] });

    expect(loggedEvents(errorSpy)).toContainEqual(
      expect.objectContaining({ scope: "redis", event: "redis_client_error", detail: "ECONNREFUSED,EAI_AGAIN" })
    );
  });

  test("never logs 'undefined' for an unrecognizable error", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { client } = loadRedisModule();

    const handler = client.on.mock.calls.find((c) => c[0] === "error")[1];
    handler(undefined);

    expect(loggedEvents(errorSpy)).toContainEqual(
      expect.objectContaining({ scope: "redis", event: "redis_client_error", detail: "unknown" })
    );
  });
});
