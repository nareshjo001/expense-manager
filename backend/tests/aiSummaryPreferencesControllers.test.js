// AI-001-T05 -- Controllers/AiSummaryPreferences/{get,update,generate}.js.
// Same fast controller-unit-test pattern as
// tests/notificationPreferencesControllers.test.js -- every dependency
// (the preference service, reportService, generateMonthlySummary) is
// mocked, so this file proves only the HTTP mapping (status codes,
// response shape, ordering of the opt-in/limit gate before any report or
// LLM call), not the business rules already covered by
// sia.aiSummaryPreferenceService.test.js / sia.generateMonthlySummary.test.js.
"use strict";

const PREF_SERVICE_PATH = "../sia/aiSummaryPreferenceService";
const REPORT_SERVICE_PATH = "../Services/reportService";
const SUMMARY_SERVICE_PATH = "../sia/monthlySummaryService";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

const makeReq = (body = {}, userId = USER_ID) => ({ body, userId });

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const responseBody = (res) => res.json.mock.calls[0][0];

function loadControllers({ prefMock = {}, reportMock = {}, summaryMock = {} } = {}) {
  jest.resetModules();
  jest.doMock(PREF_SERVICE_PATH, () => ({
    getPreference: jest.fn(),
    setOptIn: jest.fn(),
    recordRegeneration: jest.fn(),
    ...prefMock,
  }));
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    getReport: jest.fn(),
    ...reportMock,
  }));
  jest.doMock(SUMMARY_SERVICE_PATH, () => ({
    generateMonthlySummary: jest.fn(),
    ...summaryMock,
  }));
  return {
    get: require("../Controllers/AiSummaryPreferences/get"),
    update: require("../Controllers/AiSummaryPreferences/update"),
    generate: require("../Controllers/AiSummaryPreferences/generate"),
    reportService: require(REPORT_SERVICE_PATH),
    summaryService: require(SUMMARY_SERVICE_PATH),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getAiSummaryPreference", () => {
  test("200s with the preference/usage view", async () => {
    const preference = { optedIn: true, regenerationsUsed: 1, regenerationLimit: 5, regenerationsRemaining: 4 };
    const { get } = loadControllers({ prefMock: { getPreference: jest.fn().mockResolvedValue(preference) } });
    const res = makeRes();

    await get.getAiSummaryPreference(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual(expect.objectContaining({ success: true, data: preference }));
  });

  test("500s on an unexpected service error", async () => {
    const { get } = loadControllers({ prefMock: { getPreference: jest.fn().mockRejectedValue(new Error("db down")) } });
    const res = makeRes();

    await get.getAiSummaryPreference(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res).success).toBe(false);
  });
});

describe("updateAiSummaryPreference", () => {
  test("200s with the saved preference on success", async () => {
    const saved = { optedIn: true };
    const { update } = loadControllers({ prefMock: { setOptIn: jest.fn().mockResolvedValue({ ok: true, preference: saved }) } });
    const res = makeRes();

    await update.updateAiSummaryPreference(makeReq({ optedIn: true }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual(expect.objectContaining({ success: true, data: saved }));
  });

  test("400s with a mapped errorCode on a validation failure", async () => {
    const { update } = loadControllers({ prefMock: { setOptIn: jest.fn().mockResolvedValue({ ok: false, reason: "invalid_opted_in" }) } });
    const res = makeRes();

    await update.updateAiSummaryPreference(makeReq({ optedIn: "yes" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).errorCode).toBe("INVALID_OPTED_IN");
  });

  test("500s on an unexpected service error", async () => {
    const { update } = loadControllers({ prefMock: { setOptIn: jest.fn().mockRejectedValue(new Error("db down")) } });
    const res = makeRes();

    await update.updateAiSummaryPreference(makeReq({ optedIn: true }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res).success).toBe(false);
  });
});

describe("generateAiMonthlySummary", () => {
  test("403s with AI_SUMMARY_NOT_OPTED_IN and never touches reportService/generateMonthlySummary when not opted in", async () => {
    const { generate, reportService, summaryService } = loadControllers({
      prefMock: { recordRegeneration: jest.fn().mockResolvedValue({ allowed: false, reasonCode: "NOT_OPTED_IN" }) },
    });
    const res = makeRes();

    await generate.generateAiMonthlySummary(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(responseBody(res).errorCode).toBe("AI_SUMMARY_NOT_OPTED_IN");
    expect(reportService.getReport).not.toHaveBeenCalled();
    expect(summaryService.generateMonthlySummary).not.toHaveBeenCalled();
  });

  test("429s with AI_SUMMARY_REGENERATION_LIMIT_EXCEEDED and usage data when the cap is hit", async () => {
    const { generate, reportService } = loadControllers({
      prefMock: {
        recordRegeneration: jest.fn().mockResolvedValue({
          allowed: false,
          reasonCode: "REGENERATION_LIMIT_EXCEEDED",
          regenerationsUsed: 5,
          regenerationLimit: 5,
          regenerationsRemaining: 0,
        }),
      },
    });
    const res = makeRes();

    await generate.generateAiMonthlySummary(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(429);
    const body = responseBody(res);
    expect(body.errorCode).toBe("AI_SUMMARY_REGENERATION_LIMIT_EXCEEDED");
    expect(body.data.regenerationsRemaining).toBe(0);
    expect(reportService.getReport).not.toHaveBeenCalled();
  });

  test("200s with the generated summary plus usage counters when allowed", async () => {
    const report = { metadata: { version: 10 } };
    const summary = { hasData: true, isFallback: true, narrative: "You spent...", citedFacts: [] };
    const { generate } = loadControllers({
      prefMock: {
        recordRegeneration: jest
          .fn()
          .mockResolvedValue({ allowed: true, regenerationsUsed: 1, regenerationLimit: 5, regenerationsRemaining: 4 }),
      },
      reportMock: { getReport: jest.fn().mockResolvedValue(report) },
      summaryMock: { generateMonthlySummary: jest.fn().mockResolvedValue(summary) },
    });
    const res = makeRes();

    await generate.generateAiMonthlySummary(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = responseBody(res);
    expect(body.success).toBe(true);
    expect(body.data.narrative).toBe(summary.narrative);
    expect(body.data.regenerationsUsed).toBe(1);
    expect(body.data.regenerationsRemaining).toBe(4);
  });

  test("500s on an unexpected error", async () => {
    const { generate } = loadControllers({
      prefMock: { recordRegeneration: jest.fn().mockRejectedValue(new Error("db down")) },
    });
    const res = makeRes();

    await generate.generateAiMonthlySummary(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(responseBody(res).success).toBe(false);
  });
});
