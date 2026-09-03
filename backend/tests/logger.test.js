// OBS-001 -- backend/utils/logger.js: structured logging safety and shape.
const { logEvent, safeString, safeRequestId } = require("../utils/logger");

describe("logger.safeString", () => {
  test("collapses newlines/whitespace and trims", () => {
    expect(safeString("hello\nworld  \t foo")).toBe("hello world foo");
  });

  test("returns null for null/undefined/empty", () => {
    expect(safeString(null)).toBeNull();
    expect(safeString(undefined)).toBeNull();
    expect(safeString("   ")).toBeNull();
  });

  test("truncates overly long strings", () => {
    const long = "a".repeat(600);
    const result = safeString(long);
    expect(result.length).toBe(500);
    expect(result.endsWith("...")).toBe(true);
  });
});

describe("logger.safeRequestId", () => {
  test("accepts a well-shaped id", () => {
    expect(safeRequestId("abc-123.def_456")).toBe("abc-123.def_456");
  });

  test("rejects ids with disallowed characters", () => {
    expect(safeRequestId("abc 123")).toBeNull();
    expect(safeRequestId("abc\ndef")).toBeNull();
    expect(safeRequestId("<script>")).toBeNull();
  });

  test("rejects non-string/empty and object values", () => {
    expect(safeRequestId(undefined)).toBeNull();
    expect(safeRequestId({})).toBeNull();
    expect(safeRequestId([])).toBeNull();
  });

  test("stringifies a plain number into a valid request ID", () => {
    expect(safeRequestId(123)).toBe("123");
  });
});

describe("logEvent", () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test("emits one JSON line to console.log for info level", () => {
    logEvent({ level: "info", scope: "http", event: "request_completed", requestId: "req-1", statusCode: 200 });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    const record = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(record.level).toBe("info");
    expect(record.scope).toBe("http");
    expect(record.event).toBe("request_completed");
    expect(record.requestId).toBe("req-1");
    expect(record.statusCode).toBe(200);
    expect(typeof record.timestamp).toBe("string");
  });

  test("routes error level to console.error", () => {
    logEvent({ level: "error", scope: "http", event: "unhandled_request_error" });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("never throws even when passed hostile/unexpected field types", () => {
    expect(() =>
      logEvent({
        level: "info",
        scope: "test",
        event: "weird_fields",
        requestId: { not: "a string" },
        circular: (() => {
          const obj = {};
          obj.self = obj;
          return obj;
        })(),
      })
    ).not.toThrow();
  });

  test("does not include raw error objects, only allowlisted fields", () => {
    const err = new Error("secret stack trace content");
    logEvent({ level: "error", scope: "http", event: "unhandled_request_error", errorMessage: err.message });

    const record = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(record.err).toBeUndefined();
    expect(record.stack).toBeUndefined();
  });

  test("defaults to info level and safe fallbacks when scope/event omitted", () => {
    logEvent({});
    const record = JSON.parse(consoleLogSpy.mock.calls[0][0]);
    expect(record.level).toBe("info");
    expect(record.scope).toBe("app");
    expect(record.event).toBe("unknown_event");
  });
});
