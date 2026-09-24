// DAT-004-T04 -- security-focused integration tests for the export
// feature's request-lifecycle layer (Services/ExportServices/
// exportRequestService.js) exercised together with the REAL, un-mocked
// exportGenerationService.js and utils/exportTypes.js -- only the Mongoose
// models (config/Schemas.js's ExpenseModel/IncomeModel/BudgetModel, and
// models/ExportRequest.js) are faked, the same no-real-Mongo pattern every
// other test file in this suite uses. This file exists to PROVE, not
// assume, that:
//   1. one user can never list/poll/download another user's export request,
//   2. the actual generated CSV content is formula-injection-safe end to
//      end through THIS module's own code path (not just trusting that
//      exportGenerationService.js's sanitizeCsvCell exists),
//   3. a too-large export is rejected with no ExportRequest document and
//      no generation ever attempted,
//   4. a made-up/guessed downloadToken always 404s, never 500s or leaks
//      whether it was ever valid,
//   5. domain "all" combined with format "csv" is rejected.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const EXPORT_REQUEST_MODEL_PATH = "../models/ExportRequest";

// Pure constants, no DB/side effects -- required once, top-level, so tests
// can reference MAX_EXPORT_ROWS/SYNC_ROW_LIMIT directly instead of pulling
// them out of loadRealService's return value (which would need the value
// BEFORE loadRealService is even called, e.g. to build its options object).
const { MAX_EXPORT_ROWS, SYNC_ROW_LIMIT } = require("../utils/exportTypes");

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";
const USER_B = "64f1a2b3c4d5e6f7a8b9c0bb";

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("$gte" in cond && !(value >= cond.$gte)) return false;
      if ("$lte" in cond && !(value <= cond.$lte)) return false;
      return true;
    }
    return String(value) === String(cond);
  });
}

// Same fake-schema-model shape as exportGenerationService.test.js, plus an
// overridable countDocuments so the row-limit/queued-path tests don't need
// to actually materialize thousands of documents in memory.
function makeFakeDataModel(docs, { countOverride } = {}) {
  return {
    countDocuments: jest.fn(async (filter = {}) =>
      countOverride !== undefined ? countOverride : docs.filter((d) => matchesFilter(d, filter)).length
    ),
    find: jest.fn((filter = {}) => ({
      lean: async () => docs.filter((d) => matchesFilter(d, filter)).map((d) => ({ ...d })),
    })),
  };
}

function matchesRequest(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => String(doc[key]) === String(cond));
}

function makeFakeExportRequestModel(seedDocs = []) {
  let autoId = 1;
  const state = seedDocs.map((d) => ({ ...d }));
  return {
    state,
    create: jest.fn(async (doc) => {
      const created = { _id: `gen-${autoId++}`, createdAt: new Date(), ...doc };
      state.push(created);
      return { ...created };
    }),
    find: jest.fn((filter = {}) => ({
      sort: () => ({ lean: async () => state.filter((d) => matchesRequest(d, filter)).map((d) => ({ ...d })) }),
    })),
    findOne: jest.fn((filter = {}) => ({
      lean: async () => {
        const doc = state.find((d) => matchesRequest(d, filter));
        return doc ? { ...doc } : null;
      },
    })),
  };
}

function loadRealService({ expenses = [], income = [], budgets = [], expenseCountOverride, exportRequests = [] } = {}) {
  jest.resetModules();
  const ExpenseModel = makeFakeDataModel(expenses, { countOverride: expenseCountOverride });
  const IncomeModel = makeFakeDataModel(income);
  const BudgetModel = makeFakeDataModel(budgets);
  const exportRequestStore = makeFakeExportRequestModel(exportRequests);

  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel, IncomeModel, BudgetModel }));
  jest.doMock(EXPORT_REQUEST_MODEL_PATH, () => exportRequestStore);

  const service = require("../Services/ExportServices/exportRequestService");
  const { MAX_EXPORT_ROWS, SYNC_ROW_LIMIT } = require("../utils/exportTypes");
  return { service, exportRequestStore, ExpenseModel, MAX_EXPORT_ROWS, SYNC_ROW_LIMIT };
}

function expenseDoc(overrides = {}) {
  return {
    _id: "e1",
    userId: USER_A,
    expenseName: "Netflix",
    expenseCategory: "Entertainment",
    expenseAmount: 649,
    expenseDate: new Date("2026-01-15T00:00:00.000Z"),
    expenseDescription: "",
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("1. authorization -- cross-user access to an export request", () => {
  test("user B can never list, poll status, or download user A's queued export request", async () => {
    const { service } = loadRealService({ expenseCountOverride: SYNC_ROW_LIMIT });

    const created = await service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" });
    expect(created.mode).toBe("queued");

    // list: user B's own list never contains user A's request.
    const bList = await service.listExportRequests({ userId: USER_B });
    expect(bList.find((r) => r.id === created.id)).toBeUndefined();

    // status: user B polling user A's request id -> not found, not the
    // request's real data.
    await expect(service.getExportRequestStatus({ userId: USER_B, id: created.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // download: even if user B somehow learned the id, the request isn't
    // "ready" yet -- but critically, ownership alone must also fail it.
    // Simulate it becoming ready (as the cron would) and prove the token
    // still can't be used by user B.
    const store = require("../models/ExportRequest");
    const doc = store.state.find((d) => String(d._id) === created.id);
    doc.status = "ready";
    doc.filePath = "/generated-exports/whatever.csv";
    doc.fileName = "whatever.csv";
    doc.expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await expect(service.resolveDownload({ userId: USER_B, token: doc.downloadToken })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // The legitimate owner, by contrast, can resolve it.
    const resolved = await service.resolveDownload({ userId: USER_A, token: doc.downloadToken });
    expect(resolved.filePath).toBe("/generated-exports/whatever.csv");
  });
});

describe("2. CSV formula-injection is neutralized end to end through exportRequestService", () => {
  test("a malicious expenseName/expenseCategory/expenseDescription is guarded in the actual generated CSV", async () => {
    const malicious = expenseDoc({
      expenseName: "=2+2",
      expenseCategory: "+ClickMe",
      expenseDescription: "@SUM(1)",
    });
    const { service } = loadRealService({ expenses: [malicious] });

    const result = await service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" });

    expect(result.mode).toBe("sync");
    const lines = result.content.split("\r\n").filter(Boolean);
    // line[0] is the "# balensia-export ..." comment, line[1] the header,
    // line[2] the one data row.
    const dataLine = lines[2];

    expect(dataLine).toBe("2026-01-15,'=2+2,'+ClickMe,649.00,'@SUM(1)");
  });

  test("a formula-triggering value that ALSO needs comma/quote CSV-quoting is guarded AND correctly quoted", async () => {
    const malicious = expenseDoc({ expenseCategory: '+HYPERLINK("http://evil","click")' });
    const { service } = loadRealService({ expenses: [malicious] });

    const result = await service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" });
    const lines = result.content.split("\r\n").filter(Boolean);
    const dataLine = lines[2];

    // Guarded value: '+HYPERLINK("http://evil","click") -- now contains
    // commas/quotes, so csvRow must ALSO wrap it in quotes and double the
    // embedded quotes, on top of the leading-apostrophe formula guard.
    expect(dataLine).toBe('2026-01-15,Netflix,"\'+HYPERLINK(""http://evil"",""click"")",649.00,');
  });

  test("a tab/CR/LF-leading field is also guarded, not just =/+/-/@", async () => {
    const malicious = expenseDoc({ expenseName: "\tclick me" });
    const { service } = loadRealService({ expenses: [malicious] });

    const result = await service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" });
    const lines = result.content.split("\r\n").filter(Boolean);
    const dataLine = lines[2];

    // The guarded value is "'\tclick me"; a value containing a raw tab is
    // not itself a CSV special character (only , " and newlines force
    // quoting), so it appears unquoted but apostrophe-prefixed.
    expect(dataLine.startsWith("2026-01-15,'\tclick me,")).toBe(true);
  });
});

describe("3. row-limit rejection creates nothing", () => {
  test("a request over MAX_EXPORT_ROWS is rejected with TOO_MANY_ROWS, no ExportRequest document, no generation attempted", async () => {
    const { service, exportRequestStore } = loadRealService({
      expenseCountOverride: MAX_EXPORT_ROWS + 1,
    });

    await expect(
      service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" })
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });

    expect(exportRequestStore.create).not.toHaveBeenCalled();
    expect(exportRequestStore.state).toHaveLength(0);
  });
});

describe("4. downloadToken unguessability / no enumeration", () => {
  test("a made-up token 404s (NOT_FOUND), never throws an unhandled/500-shaped error", async () => {
    const { service } = loadRealService({ exportRequests: [] });

    await expect(
      service.resolveDownload({ userId: USER_A, token: "totally-made-up-token-0000000000" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a slightly-modified (one-character-off) real token also 404s", async () => {
    const now = Date.now();
    const realToken = "a".repeat(48);
    const tamperedToken = "b" + "a".repeat(47);
    const { service } = loadRealService({
      exportRequests: [
        {
          _id: "r1",
          userId: USER_A,
          domain: "expenses",
          format: "csv",
          status: "ready",
          downloadToken: realToken,
          filePath: "/generated-exports/x.csv",
          fileName: "x.csv",
          expiresAt: new Date(now + 60 * 60 * 1000),
        },
      ],
    });

    await expect(service.resolveDownload({ userId: USER_A, token: tamperedToken })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // The real token, by contrast, resolves fine -- proving the tampered
    // one failed because it doesn't match, not because the fixture is broken.
    await expect(service.resolveDownload({ userId: USER_A, token: realToken })).resolves.toMatchObject({
      filePath: "/generated-exports/x.csv",
    });
  });

  test("generated downloadTokens are long, unguessable hex, never derived from userId or a counter", async () => {
    const { service } = loadRealService({ expenseCountOverride: SYNC_ROW_LIMIT });

    const first = await service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" });
    const second = await service.createExportRequest({ userId: USER_A, domain: "expenses", format: "csv" });

    const store = require("../models/ExportRequest");
    const tokens = store.state.map((d) => d.downloadToken);
    expect(tokens[0]).toMatch(/^[a-f0-9]{48}$/);
    expect(tokens[1]).toMatch(/^[a-f0-9]{48}$/);
    expect(tokens[0]).not.toEqual(tokens[1]);
    expect(tokens[0]).not.toContain(USER_A);
    expect(first.id).not.toBe(second.id);
  });
});

describe('5. domain "all" + format "csv" is rejected', () => {
  test("rejected with INVALID_COMBINATION, before any row counting happens", async () => {
    const { service, ExpenseModel } = loadRealService({});

    await expect(
      service.createExportRequest({ userId: USER_A, domain: "all", format: "csv" })
    ).rejects.toMatchObject({ code: "INVALID_COMBINATION" });

    expect(ExpenseModel.countDocuments).not.toHaveBeenCalled();
  });

  test('domain "all" + format "json" is accepted (sanity check the rejection is combination-specific, not domain "all" itself)', async () => {
    const { service } = loadRealService({});

    const result = await service.createExportRequest({ userId: USER_A, domain: "all", format: "json" });
    expect(result.mode).toBe("sync");
  });
});
