"use strict";

// AI-001-T07 -- verifies the "ai_summary" scope's metrics instrumentation
// wired into monthlySummaryService.js (grounding/latency) and
// aiSummaryPreferenceService.js (the regeneration usefulness-proxy),
// mirroring the mocking style metrics.dimensions.test.js and
// sia.generateMonthlySummary.test.js already use for this codebase: mock
// the collaborator boundary, assert the exact recordOperation call shape,
// and never assert on real timing values (durationMs is only checked for
// type/presence, never an exact number).

const METRICS_PATH = "../utils/metrics";

const fullReport = {
  metadata: { version: 10, reportPeriod: { month: 9, year: 2026 } },
  spending: { hasData: true, largestExpense: null, stability: {} },
  summary: { totalSpent: 45230.5, transactionCount: 62 },
  budgets: { hasData: true, hasBudget: false },
  categories: { monthly: { hasData: false } },
  trends: { hasData: false },
  insights: { weeklyChange: { hasData: false }, categoryPattern: { hasData: false }, stability: { hasData: false } },
  financialHealth: { overall: 70, risk: "Low", signals: [] },
  anomalies: { hasData: false },
  forecast: { hasData: false },
};

describe("monthlySummaryService.generateMonthlySummary -- ai_summary metrics", () => {
  function loadWithMocks() {
    jest.resetModules();
    const recordOperation = jest.fn();
    jest.doMock(METRICS_PATH, () => ({ recordOperation }));
    jest.doMock("../sia/monthlySummaryLlmService");
    const { generateLlmMonthlySummary } = require("../sia/monthlySummaryLlmService");
    const { generateMonthlySummary } = require("../sia/monthlySummaryService");
    return { recordOperation, generateLlmMonthlySummary, generateMonthlySummary };
  }

  afterEach(() => jest.resetModules());

  test("template-only path (allowLlm false) records only the overall 'generate' operation", async () => {
    const { recordOperation, generateMonthlySummary } = loadWithMocks();

    await generateMonthlySummary(fullReport);

    const ops = recordOperation.mock.calls.map((call) => call[0].operation);
    expect(ops).toEqual(["generate"]);
    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "ai_summary", operation: "generate", outcome: "success" })
    );
  });

  test("a successful, validated LLM path records llm_call success, grounding_validation success, then generate success", async () => {
    const { recordOperation, generateLlmMonthlySummary, generateMonthlySummary } = loadWithMocks();
    generateLlmMonthlySummary.mockResolvedValue({
      ok: true,
      narrative: "You spent ₹45230.5 across 62 transactions this month.",
      citedFactIds: ["summary.totalSpent", "summary.transactionCount"],
      provider: "groq",
      model: "llama-3.1-70b",
      latencyMs: 700,
    });

    await generateMonthlySummary(fullReport, { allowLlm: true });

    expect(recordOperation).toHaveBeenNthCalledWith(1, {
      scope: "ai_summary",
      operation: "llm_call",
      outcome: "success",
      durationMs: 700,
    });
    expect(recordOperation).toHaveBeenNthCalledWith(2, {
      scope: "ai_summary",
      operation: "grounding_validation",
      outcome: "success",
    });
    expect(recordOperation).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ scope: "ai_summary", operation: "generate", outcome: "success" })
    );
  });

  test("a provider failure records llm_call failure and never records grounding_validation", async () => {
    const { recordOperation, generateLlmMonthlySummary, generateMonthlySummary } = loadWithMocks();
    generateLlmMonthlySummary.mockResolvedValue({ ok: false, reasonCode: "PROVIDER_ERROR", provider: "groq" });

    await generateMonthlySummary(fullReport, { allowLlm: true });

    const ops = recordOperation.mock.calls.map((call) => call[0].operation);
    expect(ops).toEqual(["llm_call", "generate"]);
    expect(recordOperation).toHaveBeenNthCalledWith(1, expect.objectContaining({ operation: "llm_call", outcome: "failure" }));
  });

  test("a validation failure (invented figure) records llm_call success but grounding_validation failure", async () => {
    const { recordOperation, generateLlmMonthlySummary, generateMonthlySummary } = loadWithMocks();
    generateLlmMonthlySummary.mockResolvedValue({
      ok: true,
      narrative: "You spent ₹99999 this month, way over budget!",
      citedFactIds: ["summary.totalSpent"],
      provider: "groq",
      model: "llama-3.1-70b",
      latencyMs: 500,
    });

    await generateMonthlySummary(fullReport, { allowLlm: true });

    expect(recordOperation).toHaveBeenNthCalledWith(1, expect.objectContaining({ operation: "llm_call", outcome: "success" }));
    expect(recordOperation).toHaveBeenNthCalledWith(2, expect.objectContaining({ operation: "grounding_validation", outcome: "failure" }));
  });

  test("no data at all (LLM never attempted) still records exactly one 'generate' success", async () => {
    const { recordOperation, generateLlmMonthlySummary, generateMonthlySummary } = loadWithMocks();

    await generateMonthlySummary({ spending: { hasData: false } }, { allowLlm: true });

    expect(generateLlmMonthlySummary).not.toHaveBeenCalled();
    expect(recordOperation).toHaveBeenCalledTimes(1);
    expect(recordOperation).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "ai_summary", operation: "generate", outcome: "success" })
    );
  });
});

describe("aiSummaryPreferenceService.recordRegeneration -- ai_summary metrics", () => {
  const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
  const MODEL_PATH = "../models/AiSummaryPreference";
  // Pure (no DB touch), read from the REAL module before any jest.doMock
  // below -- same reason sia.aiSummaryPreferenceService.test.js reads
  // these up front: referencing `service` (the thing loadService's own
  // return value produces) inside the array literal passed AS loadService's
  // argument would be a TDZ ReferenceError, not a mocking trick.
  const { currentPeriodKey: realCurrentPeriodKey, MAX_REGENERATIONS_PER_MONTH: MAX } = require("../sia/aiSummaryPreferenceService");

  function makeFakeModel(seedDocs = []) {
    const store = new Map();
    for (const doc of seedDocs) store.set(String(doc.userId), { ...doc });
    return {
      __store: store,
      findOne: (filter) => ({
        lean: async () => {
          const doc = [...store.values()].find((d) => String(d.userId) === String(filter.userId));
          return doc ? { ...doc } : null;
        },
      }),
      findOneAndUpdate: async (filter, update) => {
        let doc = [...store.values()].find((d) => String(d.userId) === String(filter.userId));
        if (!doc) {
          doc = { userId: filter.userId, ...(update.$setOnInsert || {}) };
          store.set(String(filter.userId), doc);
        }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    };
  }

  function loadService(seedDocs) {
    jest.resetModules();
    const recordOperation = jest.fn();
    jest.doMock(METRICS_PATH, () => ({ recordOperation }));
    jest.doMock(MODEL_PATH, () => makeFakeModel(seedDocs));
    const service = require("../sia/aiSummaryPreferenceService");
    return { service, recordOperation };
  }

  afterEach(() => jest.resetModules());

  test("records a regeneration operation only when the attempt is allowed", async () => {
    const { service, recordOperation } = loadService([{ userId: USER_ID, optedIn: true }]);

    await service.recordRegeneration(USER_ID);

    expect(recordOperation).toHaveBeenCalledWith({ scope: "ai_summary", operation: "regeneration", outcome: "success" });
  });

  test("does NOT record anything for a not-opted-in user's rejected attempt", async () => {
    const { service, recordOperation } = loadService([]);

    await service.recordRegeneration(USER_ID);

    expect(recordOperation).not.toHaveBeenCalled();
  });

  test("does NOT record anything once the monthly cap rejects the attempt", async () => {
    const now = new Date("2026-09-24T10:00:00Z");
    const { service, recordOperation } = loadService([
      { userId: USER_ID, optedIn: true, regenerationPeriod: realCurrentPeriodKey(now), regenerationCount: MAX },
    ]);

    await service.recordRegeneration(USER_ID, now);

    expect(recordOperation).not.toHaveBeenCalled();
  });
});
