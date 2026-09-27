"use strict";

// AI-002 -- unit tests for expenseParsePrompt.js. Pure function of
// (text, {referenceDate}) -- no database, no LLM/provider call.

const {
  buildExpenseParsePromptRequest,
  PARSED_EXPENSE_SCHEMA,
  STRUCTURED_OUTPUT_NAME,
  SYSTEM_PROMPT,
} = require("../sia/expenseParsePrompt");

describe("PARSED_EXPENSE_SCHEMA", () => {
  test("is frozen, strict-mode-friendly (additionalProperties:false, every property required)", () => {
    expect(Object.isFrozen(PARSED_EXPENSE_SCHEMA)).toBe(true);
    expect(PARSED_EXPENSE_SCHEMA.additionalProperties).toBe(false);
    expect(PARSED_EXPENSE_SCHEMA.required.sort()).toEqual(
      Object.keys(PARSED_EXPENSE_SCHEMA.properties).sort()
    );
  });

  test("every property type is a plain string/number -- never a nullable [\"string\",\"null\"] union", () => {
    Object.values(PARSED_EXPENSE_SCHEMA.properties).forEach((prop) => {
      expect(["string", "number"]).toContain(prop.type);
    });
  });

  test("outcome is a two-value enum: parsed | unsupported", () => {
    expect(PARSED_EXPENSE_SCHEMA.properties.outcome.enum).toEqual(["parsed", "unsupported"]);
  });

  test("is JSON-serializable (a provider must be able to transmit it)", () => {
    expect(() => JSON.stringify(PARSED_EXPENSE_SCHEMA)).not.toThrow();
  });
});

describe("SYSTEM_PROMPT", () => {
  test("tells the model never to invent an amount, category, merchant, or date", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/never (guess|invent)/);
  });

  test("tells the model not to give financial/investment/tax/legal advice", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/financial, investment, tax, or legal advice/);
  });
});

describe("buildExpenseParsePromptRequest", () => {
  test("returns the exact shape askLlm() expects", () => {
    const request = buildExpenseParsePromptRequest("spent 250 on lunch", { referenceDate: "2026-09-27" });

    expect(request.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(request.question).toBe("spent 250 on lunch");
    expect(request.history).toEqual([]);
    expect(request.context).toEqual({ referenceDate: "2026-09-27" });
    expect(request.structuredOutput).toEqual({
      name: STRUCTURED_OUTPUT_NAME,
      schema: PARSED_EXPENSE_SCHEMA,
    });
  });

  test("passes the free text through as `question` verbatim, without trimming or altering it", () => {
    const request = buildExpenseParsePromptRequest("  spent 10 on tea  ", { referenceDate: "2026-09-27" });
    expect(request.question).toBe("  spent 10 on tea  ");
  });

  test("a valid referenceDate string is passed through unchanged", () => {
    const request = buildExpenseParsePromptRequest("x", { referenceDate: "2026-01-05" });
    expect(request.context.referenceDate).toBe("2026-01-05");
  });

  test.each([undefined, null, 123, {}, ["2026-09-27"]])(
    "a non-string referenceDate (%p) becomes null rather than a silently-wrong date",
    (badValue) => {
      const request = buildExpenseParsePromptRequest("x", { referenceDate: badValue });
      expect(request.context.referenceDate).toBeNull();
    }
  );

  test("referenceDate defaults to null when the options object itself is omitted", () => {
    const request = buildExpenseParsePromptRequest("x");
    expect(request.context.referenceDate).toBeNull();
  });
});
