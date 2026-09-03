// OBS-001-T05 -- backend/utils/metrics.js
const {
  requestMetricsMiddleware,
  snapshotAndReset,
  recordRequest,
  resetMetricsForTests,
} = require("../utils/metrics");

describe("metrics", () => {
  let consoleLogSpy;

  beforeEach(() => {
    resetMetricsForTests();
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test("recordRequest aggregates count, error count and latency", () => {
    recordRequest({ route: "/expense", statusCode: 200, latencyMs: 10 });
    recordRequest({ route: "/expense", statusCode: 500, latencyMs: 20 });
    recordRequest({ route: "/api", statusCode: 200, latencyMs: 30 });

    snapshotAndReset();

    const record = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(record.event).toBe("metrics_snapshot");
    expect(record.requestCount).toBe(3);
    expect(record.errorCount).toBe(1);
    expect(record.avgLatencyMs).toBe(20);
    expect(record.distinctRoutes).toBe(2);
  });

  test("snapshotAndReset clears the window afterward", () => {
    recordRequest({ route: "/expense", statusCode: 200, latencyMs: 10 });
    snapshotAndReset();
    consoleLogSpy.mockClear();

    snapshotAndReset();
    const record = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(record.requestCount).toBe(0);
    expect(record.avgLatencyMs).toBe(0);
  });

  test("requestMetricsMiddleware records on response finish without altering the response", (done) => {
    const handlers = {};
    const req = { baseUrl: "/expense", path: "/expense" };
    const res = {
      statusCode: 201,
      on: (event, handler) => {
        handlers[event] = handler;
      },
    };
    const next = jest.fn();

    requestMetricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    handlers.finish();

    setImmediate(() => {
      snapshotAndReset();
      const record = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(record.requestCount).toBe(1);
      done();
    });
  });

  test("ignores non-numeric/invalid statusCode and latency without throwing", () => {
    expect(() => recordRequest({ route: "/x", statusCode: "oops", latencyMs: -5 })).not.toThrow();
    snapshotAndReset();
    const record = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(record.requestCount).toBe(1);
    expect(record.errorCount).toBe(0);
  });

  // OBS-001-T06 -- proves the wiring only; alerts.js itself is unit-tested
  // in alerts.test.js.
  describe("alert evaluation wiring", () => {
    let consoleErrorSpy;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    test("does not raise an alert log line for a healthy snapshot", () => {
      recordRequest({ route: "/expense", statusCode: 200, latencyMs: 10 });
      snapshotAndReset();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    test("raises a structured alert log line when the snapshot breaches the error-rate threshold", () => {
      for (let i = 0; i < 20; i += 1) {
        recordRequest({ route: "/expense", statusCode: i < 10 ? 500 : 200, latencyMs: 10 });
      }
      snapshotAndReset();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const record = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(record.scope).toBe("alert");
      expect(record.event).toBe("high_error_rate");
    });
  });
});
