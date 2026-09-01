// Unit tests for backend/sia/safeLogger.js (M3-3).
"use strict";

const { logSiaEvent, SIA_LOG_EVENTS } = require("../sia/safeLogger");

let consoleLogSpy;

afterEach(() => {
  if (consoleLogSpy) {
    consoleLogSpy.mockRestore();
    consoleLogSpy = undefined;
  }
});

function lastLoggedRecord() {
  expect(consoleLogSpy).toHaveBeenCalledTimes(1);
  const [line] = consoleLogSpy.mock.calls[0];
  return JSON.parse(line);
}

describe("backend/sia/safeLogger", () => {
  it("exports the two stable, documented event names", () => {
    expect(SIA_LOG_EVENTS).toEqual({
      PROVIDER_REQUEST_COMPLETED: "provider_request_completed",
      PROVIDER_REQUEST_FAILED: "provider_request_failed",
    });
  });

  it("emits a single valid-JSON line via console.log", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: 42 });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const [line] = consoleLogSpy.mock.calls[0];
    expect(typeof line).toBe("string");
    expect(() => JSON.parse(line)).not.toThrow();
  });

  it("includes exactly the fixed field set: timestamp, level, scope, event, provider, errorCode, latencyMs", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: 42 });
    const record = lastLoggedRecord();

    expect(Object.keys(record).sort()).toEqual(
      ["errorCode", "event", "latencyMs", "level", "provider", "scope", "timestamp"].sort()
    );
  });

  it("uses a fixed scope of \"sia\" and a valid ISO timestamp", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: 1 });
    const record = lastLoggedRecord();

    expect(record.scope).toBe("sia");
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
  });

  it('uses level "info" for a completed event and "error" for a failed event', () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: 1 });
    expect(lastLoggedRecord().level).toBe("info");
    consoleLogSpy.mockRestore();

    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED, provider: "openai", errorCode: "PROVIDER_TIMEOUT", latencyMs: 1 });
    expect(lastLoggedRecord().level).toBe("error");
  });

  it("passes through only a known provider identifier and errorCode string", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
      provider: "openai",
      errorCode: "PROVIDER_TIMEOUT",
      latencyMs: 7,
    });
    const record = lastLoggedRecord();

    expect(record.provider).toBe("openai");
    expect(record.errorCode).toBe("PROVIDER_TIMEOUT");
    expect(record.latencyMs).toBe(7);
  });

  it("normalizes a non-string provider/errorCode to null instead of passing it through", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
      provider: { toString: () => "openai" },
      errorCode: 12345,
      latencyMs: 3,
    });
    const record = lastLoggedRecord();

    expect(record.provider).toBeNull();
    expect(record.errorCode).toBeNull();
  });

  it("normalizes a blank provider/errorCode string to null", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED, provider: "   ", errorCode: "", latencyMs: 0 });
    const record = lastLoggedRecord();

    expect(record.provider).toBeNull();
    expect(record.errorCode).toBeNull();
    expect(record.latencyMs).toBe(0);
  });

  it("normalizes a non-finite or negative latencyMs to null", () => {
    for (const badLatency of [NaN, Infinity, -Infinity, -1, "42", null, undefined]) {
      consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: badLatency });
      expect(lastLoggedRecord().latencyMs).toBeNull();
      consoleLogSpy.mockRestore();
      consoleLogSpy = undefined;
    }
  });

  it("falls back to event \"unknown_event\" for an unrecognized event name, rather than logging it verbatim", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({ event: "not_a_real_event", provider: "openai", latencyMs: 1 });
    const record = lastLoggedRecord();

    expect(record.event).toBe("unknown_event");
  });

  it("cannot be made to log unknown metadata fields -- extra properties on the input are ignored", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
      provider: "openai",
      latencyMs: 5,
      // None of the following are part of logSiaEvent's signature and must
      // never appear in the emitted record.
      question: "SENSITIVE_QUESTION_MARKER",
      answer: "SENSITIVE_ANSWER_MARKER",
      context: { totalSpent: 424242 },
      userId: "SENSITIVE_USER_ID",
      apiKey: "sk-should-not-appear",
      model: "gpt-4.1-mini",
      stack: "Error: should not appear\n    at somewhere",
    });
    const record = lastLoggedRecord();

    expect(Object.keys(record).sort()).toEqual(
      ["errorCode", "event", "latencyMs", "level", "provider", "scope", "timestamp"].sort()
    );
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("SENSITIVE_QUESTION_MARKER");
    expect(serialized).not.toContain("SENSITIVE_ANSWER_MARKER");
    expect(serialized).not.toContain("424242");
    expect(serialized).not.toContain("SENSITIVE_USER_ID");
    expect(serialized).not.toContain("sk-should-not-appear");
    expect(serialized).not.toContain("gpt-4.1-mini");
    expect(serialized).not.toContain("should not appear");
  });

  it("never throws even when console.log itself throws", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {
      throw new Error("sink failure");
    });

    expect(() => {
      logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: 1 });
    }).not.toThrow();
  });

  it("does not throw and produces no output when called with no arguments", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    expect(() => logSiaEvent()).not.toThrow();
    const record = lastLoggedRecord();
    expect(record.event).toBe("unknown_event");
    expect(record.provider).toBeNull();
    expect(record.errorCode).toBeNull();
    expect(record.latencyMs).toBeNull();
  });

  it("creates no timers, intervals, or other open handles", () => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const activeHandlesBefore = process._getActiveHandles ? process._getActiveHandles().length : 0;

    for (let i = 0; i < 5; i += 1) {
      logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: "openai", latencyMs: i });
    }

    const activeHandlesAfter = process._getActiveHandles ? process._getActiveHandles().length : 0;
    expect(activeHandlesAfter).toBe(activeHandlesBefore);
  });
});
