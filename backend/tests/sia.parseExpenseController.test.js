"use strict";

// AI-002 -- unit tests for the POST /sia/parse-expense controller.
// Calls parseExpense(req, res) directly with hand-built req/res objects
// and mocked collaborators, the same lighter approach
// sia.transcribe.route.test.js's own "abort lifecycle" section already
// uses to call `transcribe(req, res)` directly -- this avoids
// `require("../app")`, which is known to hang in this sandbox regardless
// of correctness (a pre-existing environmental limitation, not a code
// bug), while still exercising the exact same gate/error-mapping logic a
// full-app supertest run would.

const READY_CONFIG = { appTimeZone: "UTC" };

function buildReqRes({ userId = "user-1", body = {} } = {}) {
  const req = { userId, body };
  let respondedStatus = null;
  let respondedBody = null;
  const res = {
    status(code) {
      respondedStatus = code;
      return this;
    },
    json(body) {
      respondedBody = body;
      return this;
    },
  };
  return { req, res, getResponded: () => ({ status: respondedStatus, body: respondedBody }) };
}

function loadController({
  siaReady = true,
  siaEnabledForUser = true,
  siaEnabledImpl,
  parseExpenseFromTextImpl,
} = {}) {
  jest.resetModules();
  const isSiaReady = jest.fn(() => siaReady);
  const isEnabledForUser = jest.fn(siaEnabledImpl || (async () => siaEnabledForUser));
  const parseExpenseFromText = jest.fn(
    parseExpenseFromTextImpl ||
      (async () => ({
        outcome: "parsed",
        expenseName: "Lunch",
        expenseCategory: "Food",
        expenseAmount: 250,
        expenseDate: "2026-09-27",
        expenseDescription: "",
        needsReview: false,
        fieldConfidence: { expenseName: 100, expenseCategory: 100, expenseAmount: 100, expenseDate: 100 },
        model: "gpt-x",
        latencyMs: 300,
      }))
  );
  const recordOperation = jest.fn();

  jest.doMock("../sia/readiness", () => ({ isSiaReady }));
  jest.doMock("../sia/siaPreferenceService", () => ({ isEnabledForUser }));
  jest.doMock("../sia/config", () => READY_CONFIG);
  jest.doMock("../sia/naturalLanguageExpenseService", () => ({ parseExpenseFromText }));
  jest.doMock("../utils/metrics", () => ({ recordOperation }));
  // fallbackMessages.js and llmService.js's LlmProviderError are pure/real.

  const { parseExpense } = require("../Controllers/SiaControllers/parseExpense");
  return { parseExpense, isSiaReady, isEnabledForUser, parseExpenseFromText, recordOperation };
}

afterEach(() => jest.resetModules());

describe("readiness gate", () => {
  test("returns the generic 503 UNAVAILABLE response when SIA is not ready, before any DB/service call", async () => {
    const { parseExpense, isEnabledForUser, parseExpenseFromText } = loadController({ siaReady: false });
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(getResponded()).toEqual({
      status: 503,
      body: { success: false, code: "UNAVAILABLE", message: "SIA is temporarily unavailable." },
    });
    expect(isEnabledForUser).not.toHaveBeenCalled();
    expect(parseExpenseFromText).not.toHaveBeenCalled();
  });
});

describe("per-user opt-out gate", () => {
  test("returns 403 SIA_DISABLED_BY_USER when the user has turned SIA off", async () => {
    const { parseExpense, parseExpenseFromText } = loadController({ siaEnabledForUser: false });
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(403);
    expect(getResponded().body.code).toBe("SIA_DISABLED_BY_USER");
    expect(parseExpenseFromText).not.toHaveBeenCalled();
  });

  test("fails OPEN (proceeds) when the opt-out lookup itself throws", async () => {
    const { parseExpense, parseExpenseFromText } = loadController({
      siaEnabledImpl: async () => {
        throw new Error("db hiccup");
      },
    });
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(parseExpenseFromText).toHaveBeenCalledTimes(1);
    expect(getResponded().status).toBe(200);
  });
});

describe("input validation", () => {
  test.each([undefined, null, 123, "", "   "])("rejects a missing/blank text field (%p) with 400", async (badValue) => {
    const { parseExpense, parseExpenseFromText } = loadController();
    const { req, res, getResponded } = buildReqRes({ body: { text: badValue } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(400);
    expect(getResponded().body.success).toBe(false);
    expect(parseExpenseFromText).not.toHaveBeenCalled();
  });

  test("rejects text longer than 200 characters with 400, never calling the parser", async () => {
    const { parseExpense, parseExpenseFromText } = loadController();
    const { req, res, getResponded } = buildReqRes({ body: { text: "x".repeat(201) } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(400);
    expect(parseExpenseFromText).not.toHaveBeenCalled();
  });

  test("trims the text before passing it to the parser", async () => {
    const { parseExpense, parseExpenseFromText } = loadController();
    const { req, res } = buildReqRes({ body: { text: "  spent 10 on tea  " } });

    await parseExpense(req, res);

    expect(parseExpenseFromText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "spent 10 on tea" })
    );
  });
});

describe("success", () => {
  test("returns success:true with exactly the parsed suggestion fields, model, and latencyMs", async () => {
    const { parseExpense } = loadController();
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 250 on lunch" } });

    await parseExpense(req, res);

    expect(getResponded()).toEqual({
      status: 200,
      body: {
        success: true,
        parsed: {
          expenseName: "Lunch",
          expenseCategory: "Food",
          expenseAmount: 250,
          expenseDate: "2026-09-27",
          expenseDescription: "",
          needsReview: false,
          fieldConfidence: { expenseName: 100, expenseCategory: 100, expenseAmount: 100, expenseDate: 100 },
        },
        model: "gpt-x",
        latencyMs: 300,
      },
    });
  });

  test("passes userId, trimmed text, and the configured appTimeZone through to the service", async () => {
    const { parseExpense, parseExpenseFromText } = loadController();
    const { req, res } = buildReqRes({ userId: "user-42", body: { text: "spent 250 on lunch" } });

    await parseExpense(req, res);

    expect(parseExpenseFromText).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-42", text: "spent 250 on lunch", timeZone: "UTC" })
    );
  });
});

describe("unsupported outcome", () => {
  test("returns 200 success:false COULD_NOT_PARSE when the service can't extract an expense", async () => {
    const { parseExpense } = loadController({
      parseExpenseFromTextImpl: async () => ({ outcome: "unsupported", reasonCode: "NO_AMOUNT_FOUND" }),
    });
    const { req, res, getResponded } = buildReqRes({ body: { text: "what's my budget?" } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(200);
    expect(getResponded().body.success).toBe(false);
    expect(getResponded().body.code).toBe("COULD_NOT_PARSE");
    // Never leaks the internal reasonCode to the client.
    expect(JSON.stringify(getResponded().body)).not.toContain("NO_AMOUNT_FOUND");
  });
});

describe("provider failure mapping (never leaks provider/config details)", () => {
  // jest.resetModules() inside loadController() means the controller's own
  // internal `require("../../sia/llmService")` happens in a fresh registry
  // epoch each call -- so LlmProviderError must be required LAZILY, inside
  // the impl function itself (evaluated when the controller invokes it,
  // i.e. within that same fresh epoch), never captured up front, or
  // `err instanceof LlmProviderError` inside the controller silently fails
  // against a stale class reference from a different epoch.
  test("a retryable provider error code maps to 503 RETRY_SHORTLY", async () => {
    const { parseExpense } = loadController({
      parseExpenseFromTextImpl: async () => {
        const { LlmProviderError } = require("../sia/llmService");
        throw new LlmProviderError("boom", { code: "PROVIDER_TIMEOUT", provider: "groq" });
      },
    });
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(503);
    expect(getResponded().body.code).toBe("RETRY_SHORTLY");
    const raw = JSON.stringify(getResponded().body);
    expect(raw).not.toContain("groq");
    expect(raw).not.toContain("PROVIDER_TIMEOUT");
  });

  test("a structural/config provider error code falls back to the generic UNAVAILABLE", async () => {
    const { parseExpense } = loadController({
      parseExpenseFromTextImpl: async () => {
        const { LlmProviderError } = require("../sia/llmService");
        throw new LlmProviderError("boom", { code: "PROVIDER_API_KEY_NOT_CONFIGURED", provider: "groq" });
      },
    });
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(503);
    expect(getResponded().body.code).toBe("UNAVAILABLE");
  });

  test("a non-LlmProviderError thrown by the service still maps to a generic 503, never crashing", async () => {
    const { parseExpense } = loadController({
      parseExpenseFromTextImpl: async () => {
        throw new Error("unexpected internal detail SENSITIVE_MARKER");
      },
    });
    const { req, res, getResponded } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(getResponded().status).toBe(503);
    expect(JSON.stringify(getResponded().body)).not.toContain("SENSITIVE_MARKER");
  });
});

describe("metrics", () => {
  test("records a success outcome under the sia_expense_parse scope", async () => {
    const { parseExpense, recordOperation } = loadController();
    const { req, res } = buildReqRes({ body: { text: "spent 250 on lunch" } });

    await parseExpense(req, res);

    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "sia_expense_parse", operation: "parse", outcome: "success" })
    );
  });

  test("records an unsupported outcome distinctly from success/failure", async () => {
    const { parseExpense, recordOperation } = loadController({
      parseExpenseFromTextImpl: async () => ({ outcome: "unsupported", reasonCode: "NO_AMOUNT_FOUND" }),
    });
    const { req, res } = buildReqRes({ body: { text: "hello" } });

    await parseExpense(req, res);

    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "unsupported" })
    );
  });

  test("records a failure outcome when the provider call throws", async () => {
    const { parseExpense, recordOperation } = loadController({
      parseExpenseFromTextImpl: async () => {
        const { LlmProviderError } = require("../sia/llmService");
        throw new LlmProviderError("boom", { code: "PROVIDER_TIMEOUT" });
      },
    });
    const { req, res } = buildReqRes({ body: { text: "spent 10 on tea" } });

    await parseExpense(req, res);

    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failure" })
    );
  });
});
