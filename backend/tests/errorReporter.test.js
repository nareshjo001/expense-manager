// OBS-001-T04 -- backend/utils/errorReporter.js: vendor-agnostic error
// aggregation, environment tagging, no-op-by-default behavior, and the
// never-throws / redaction-only-allowlisted-fields safety properties.
const {
  reportError,
  resolveEnvironmentTag,
  buildSafeContext,
  createNoopTransport,
  createSentryTransport,
  NOOP_PROVIDER,
  SENTRY_PROVIDER,
  _resetTransportForTesting,
  _setTransportForTesting,
  _getTransportForTesting,
} = require("../utils/errorReporter");

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const key of Object.keys(ORIGINAL_ENV)) {
    process.env[key] = ORIGINAL_ENV[key];
  }
}

describe("errorReporter.resolveEnvironmentTag", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("defaults to 'development' when NODE_ENV is unset", () => {
    delete process.env.NODE_ENV;
    expect(resolveEnvironmentTag()).toBe("development");
  });

  test("reuses the app's existing NODE_ENV value, lowercased", () => {
    process.env.NODE_ENV = "Production";
    expect(resolveEnvironmentTag()).toBe("production");
  });

  test("falls back to 'development' for a blank NODE_ENV", () => {
    process.env.NODE_ENV = "   ";
    expect(resolveEnvironmentTag()).toBe("development");
  });
});

describe("errorReporter.buildSafeContext (redaction / allowlist)", () => {
  afterEach(() => {
    restoreEnv();
  });

  test("only ever produces the allowlisted field set, regardless of extra input keys", () => {
    process.env.NODE_ENV = "test";
    const context = buildSafeContext({
      requestId: "req-1",
      route: "/expense",
      method: "POST",
      statusCode: 500,
      errorCode: "E1",
      scope: "http",
      event: "unhandled_request_error",
      // The fields below are exactly the kind of raw sensitive data the
      // OBS-001-T01 redaction policy forbids sending to any transport --
      // buildSafeContext must never read or forward them.
      amount: 4999.5,
      currency: "USD",
      email: "user@example.com",
      password: "hunter2",
      authorization: "Bearer sometoken",
      requestBody: { card: "4111111111111111" },
      ssn: "123-45-6789",
      userId: "u-1",
    });

    const actualKeys = Object.keys(context).sort();
    const expectedKeys = ["environment", "requestId", "route", "method", "statusCode", "errorCode", "scope", "event"].sort();
    expect(actualKeys).toEqual(expectedKeys);

    expect(context.requestId).toBe("req-1");
    expect(context.route).toBe("/expense");
    expect(context.method).toBe("POST");
    expect(context.statusCode).toBe(500);
    expect(context.errorCode).toBe("E1");
    expect(context.environment).toBe("test");
  });

  test("drops an invalid/malformed requestId rather than forwarding it raw", () => {
    const context = buildSafeContext({ requestId: "not a valid id\ncontains newline" });
    expect(context.requestId).toBeNull();
  });

  test("handles a missing/undefined context without throwing", () => {
    const context = buildSafeContext(undefined);
    expect(context.route).toBeNull();
    expect(context.requestId).toBeNull();
    expect(context.scope).toBe("app");
    expect(context.event).toBe("unhandled_error");
  });
});

describe("errorReporter transports", () => {
  beforeEach(() => {
    _resetTransportForTesting();
    delete process.env.ERROR_AGGREGATION_PROVIDER;
    delete process.env.SENTRY_DSN;
  });

  afterEach(() => {
    _resetTransportForTesting();
    restoreEnv();
  });

  test("NoopTransport is the default transport when ERROR_AGGREGATION_PROVIDER is unset", () => {
    const transport = _getTransportForTesting();
    expect(transport.name).toBe(NOOP_PROVIDER);
  });

  test("NoopTransport.send() never throws and reportError reports a clean, non-failed attempt", () => {
    const noop = createNoopTransport();
    noop.send({ name: "Error", message: "irrelevant" }, buildSafeContext({}));

    const result = reportError(new Error("something broke"), { requestId: "req-2", route: "/report" });
    expect(result.attempted).toBe(true);
    expect(result.provider).toBe(NOOP_PROVIDER);
    expect(result.failed).toBe(false);
  });

  test("falls back to NoopTransport when ERROR_AGGREGATION_PROVIDER=sentry but SENTRY_DSN is unset", () => {
    process.env.ERROR_AGGREGATION_PROVIDER = "sentry";
    delete process.env.SENTRY_DSN;

    const transport = _getTransportForTesting();
    expect(transport.name).toBe(NOOP_PROVIDER);
  });

  test("falls back to NoopTransport when ERROR_AGGREGATION_PROVIDER=sentry and SENTRY_DSN is set but @sentry/node is not installed", () => {
    process.env.ERROR_AGGREGATION_PROVIDER = "sentry";
    process.env.SENTRY_DSN = "https://fake@fake.ingest.sentry.io/1";

    const transport = _getTransportForTesting();
    expect(transport.name).toBe(NOOP_PROVIDER);

    const result = reportError(new Error("boom"), { requestId: "req-3" });
    expect(result.failed).toBe(false);
    expect(result.provider).toBe(NOOP_PROVIDER);
  });

  test("createSentryTransport throws a clear error when SENTRY_DSN is unset (caller must catch)", () => {
    delete process.env.SENTRY_DSN;
    expect(() => createSentryTransport()).toThrow(/SENTRY_DSN/);
  });
});

describe("errorReporter.reportError never-throws guarantee", () => {
  beforeEach(() => {
    _resetTransportForTesting();
  });

  afterEach(() => {
    _resetTransportForTesting();
    restoreEnv();
  });

  test("does not throw and reports a failed attempt when the configured transport's send() throws", () => {
    _setTransportForTesting({
      name: "faketransport",
      send() {
        throw new Error("vendor network down");
      },
    });

    const result = reportError(new Error("real application error"), { requestId: "req-4" });

    expect(result.attempted).toBe(true);
    expect(result.provider).toBe("faketransport");
    expect(result.failed).toBe(true);
  });

  test("does not throw when the configured transport's send() throws a non-Error value", () => {
    _setTransportForTesting({
      name: "faketransport2",
      send() {
        // eslint-disable-next-line no-throw-literal
        throw "a plain string, not an Error instance";
      },
    });

    const result = reportError(new Error("real application error"), {});
    expect(result.failed).toBe(true);
  });

  test("does not throw for a non-Error thrown value passed as `error`", () => {
    _resetTransportForTesting();
    const result = reportError("just a string, not an Error", { requestId: "req-5" });
    expect(result.attempted).toBe(true);
    expect(result.failed).toBe(false);
  });
});

describe("errorReporter environment tagging end-to-end", () => {
  beforeEach(() => {
    _resetTransportForTesting();
  });

  afterEach(() => {
    _resetTransportForTesting();
    restoreEnv();
  });

  test("every report the configured transport receives carries the current environment tag", () => {
    process.env.NODE_ENV = "staging";
    const received = [];
    _setTransportForTesting({
      name: "capture",
      send(safeError, safeContext) {
        received.push(safeContext);
      },
    });

    reportError(new Error("tagged error"), { requestId: "req-6", route: "/income" });

    expect(received.length).toBe(1);
    expect(received[0].environment).toBe("staging");
    expect(received[0].requestId).toBe("req-6");
    expect(received[0].route).toBe("/income");
  });

  test("only the error's name/message reach the transport -- never the raw stack or custom properties", () => {
    const received = [];
    _setTransportForTesting({
      name: "capture2",
      send(safeError) {
        received.push(safeError);
      },
    });

    const err = new Error("bad amount: 4999.50 for card 4111111111111111");
    err.rawRequestBody = { amount: 4999.5, cardNumber: "4111111111111111" };
    err.stack = "Error: bad amount\n    at /home/app/very/sensitive/internal/path.js:42:9";

    reportError(err, {});

    expect(received.length).toBe(1);
    expect(Object.keys(received[0]).sort()).toEqual(["message", "name"]);
    expect(received[0].name).toBe("Error");
  });
});
