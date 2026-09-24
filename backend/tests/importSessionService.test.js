// IMP-001-T04 -- Services/ImportServices/importSessionService.js.
// Same fast jest.doMock'd-collaborators pattern as
// receiptIngestService.test.js: the ImportSession model and T05's
// importSuggestionService are both mocked, so this suite proves the
// service's own orchestration (validation, error codes, ownership
// scoping, row decisions) rather than Mongoose or T05's suggestion
// logic. importSuggestionService is mocked with {virtual: true} because
// T05 may not have delivered the real file yet -- this suite must never
// depend on it existing on disk.
"use strict";

const MODEL_PATH = "../models/ImportSession";
const SUGGESTION_SERVICE_PATH = "../Services/ImportServices/importSuggestionService";
const SESSION_SERVICE_PATH = "../Services/ImportServices/importSessionService";

const { MAX_IMPORT_FILE_BYTES } = require("../utils/importTypes");
const { ERROR_CODES: CSV_ERROR_CODES } = require("../utils/csvStreamParser");

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";
const SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

function csvBuffer(text) {
  return Buffer.from(text, "utf8");
}

const VALID_CSV = "Date,Amount,Merchant,Category\n2026-01-15,42.50,Fresh Mart,Groceries\n2026-01-16,10,Coffee Shop,Dining\n";
const VALID_MAPPING = { date: "Date", amount: "Amount", merchant: "Merchant", category: "Category" };

function makeSessionDoc(overrides = {}) {
  return {
    _id: SESSION_ID,
    userId: USER_ID,
    originalFilename: "transactions.csv",
    columnMapping: VALID_MAPPING,
    status: "previewing",
    committedAt: null,
    committedCount: 0,
    skippedCount: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    rows: [
      {
        rowIndex: 0,
        raw: ["2026-01-15", "42.50", "Fresh Mart", "Groceries"],
        mapped: { expenseName: "Fresh Mart", expenseAmount: 42.5, expenseDate: "2026-01-15", expenseCategory: "Groceries" },
        validationErrors: [],
        duplicateCandidateExpenseId: null,
        suggestedCategory: null,
        decision: "pending",
        committedExpenseId: null,
      },
    ],
    save: jest.fn(async function save() {
      return this;
    }),
    ...overrides,
  };
}

// Loads importSessionService.js fresh with the model and the suggestion
// service both mocked. Each mock defaults to a plausible happy-path
// implementation and can be overridden per test via the matching
// *Impl option.
function loadService({
  createImpl,
  findOneImpl,
  findImpl,
  enrichImpl,
  suggestionModuleThrows = false,
} = {}) {
  jest.resetModules();

  const create = jest.fn(createImpl || (async (doc) => makeSessionDoc(doc)));
  const findOne = jest.fn(findOneImpl || (async () => null));
  const sortMock = jest.fn(() => ({ limit: jest.fn(findImpl || (async () => [])) }));
  const find = jest.fn(() => ({ sort: sortMock }));

  jest.doMock(MODEL_PATH, () => ({ create, findOne, find }));

  if (suggestionModuleThrows) {
    jest.doMock(
      SUGGESTION_SERVICE_PATH,
      () => {
        throw new Error("importSuggestionService failed to load");
      },
      { virtual: true }
    );
  } else {
    const enrichRowsWithSuggestions = jest.fn(
      enrichImpl || (async ({ mappedRows }) => mappedRows.map(() => ({ duplicateCandidateExpenseId: null, suggestedCategory: null })))
    );
    jest.doMock(SUGGESTION_SERVICE_PATH, () => ({ enrichRowsWithSuggestions }), { virtual: true });
  }

  const service = require(SESSION_SERVICE_PATH);
  return { service, mocks: { create, findOne, find, sortMock } };
}

afterEach(() => {
  jest.dontMock(MODEL_PATH);
  jest.dontMock(SUGGESTION_SERVICE_PATH);
  jest.resetModules();
});

describe("previewImportHeaders", () => {
  test("returns headerRow + a best-effort suggestedMapping", async () => {
    const { service } = loadService();
    const result = await service.previewImportHeaders({ fileBuffer: csvBuffer(VALID_CSV) });

    expect(result.headerRow).toEqual(["Date", "Amount", "Merchant", "Category"]);
    expect(result.suggestedMapping).toEqual(VALID_MAPPING);
  });

  test("rejects an oversized file with FILE_TOO_LARGE before parsing", async () => {
    const { service } = loadService();
    const oversized = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1, "a");

    await expect(service.previewImportHeaders({ fileBuffer: oversized })).rejects.toMatchObject({
      code: service.ERROR_CODES.FILE_TOO_LARGE,
    });
  });
});

describe("createImportSessionPreview", () => {
  test("happy path: parses, maps, enriches and persists every row", async () => {
    const { service, mocks } = loadService();

    const result = await service.createImportSessionPreview({
      userId: USER_ID,
      originalFilename: "transactions.csv",
      fileBuffer: csvBuffer(VALID_CSV),
      columnMapping: VALID_MAPPING,
    });

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const [createdDoc] = mocks.create.mock.calls[0];
    expect(createdDoc.rows).toHaveLength(2);
    expect(createdDoc.rows[0].mapped).toEqual({
      expenseName: "Fresh Mart",
      expenseAmount: 42.5,
      expenseDate: "2026-01-15",
      expenseCategory: "Groceries",
    });
    expect(createdDoc.status).toBe("previewing");

    expect(result.id).toBe(SESSION_ID);
    expect(result.rows).toHaveLength(2);
  });

  test("a row enrichment failure (T05 throws) is swallowed to nulls, not a thrown error", async () => {
    const { service } = loadService({
      enrichImpl: async () => {
        throw new Error("T05 boom");
      },
    });

    const result = await service.createImportSessionPreview({
      userId: USER_ID,
      originalFilename: "transactions.csv",
      fileBuffer: csvBuffer(VALID_CSV),
      columnMapping: VALID_MAPPING,
    });

    expect(result.rows[0].duplicateCandidateExpenseId).toBeNull();
    expect(result.rows[0].suggestedCategory).toBeNull();
  });

  test("T05's module missing entirely still falls back to nulls, not a thrown error", async () => {
    const { service } = loadService({ suggestionModuleThrows: true });

    const result = await service.createImportSessionPreview({
      userId: USER_ID,
      originalFilename: "transactions.csv",
      fileBuffer: csvBuffer(VALID_CSV),
      columnMapping: VALID_MAPPING,
    });

    expect(result.rows[0].duplicateCandidateExpenseId).toBeNull();
    expect(result.rows[0].suggestedCategory).toBeNull();
  });

  test("rejects an oversized file with FILE_TOO_LARGE", async () => {
    const { service, mocks } = loadService();
    const oversized = Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1, "a");

    await expect(
      service.createImportSessionPreview({
        userId: USER_ID,
        originalFilename: "big.csv",
        fileBuffer: oversized,
        columnMapping: VALID_MAPPING,
      })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.FILE_TOO_LARGE });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("rejects a columnMapping missing a required field with INVALID_MAPPING", async () => {
    const { service, mocks } = loadService();

    await expect(
      service.createImportSessionPreview({
        userId: USER_ID,
        originalFilename: "transactions.csv",
        fileBuffer: csvBuffer(VALID_CSV),
        columnMapping: { date: "Date", merchant: "Merchant" }, // amount missing
      })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.INVALID_MAPPING });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("bubbles up parseCsv's EMPTY_FILE code for a blank file", async () => {
    const { service } = loadService();

    await expect(
      service.createImportSessionPreview({
        userId: USER_ID,
        originalFilename: "empty.csv",
        fileBuffer: csvBuffer("   "),
        columnMapping: VALID_MAPPING,
      })
    ).rejects.toMatchObject({ code: CSV_ERROR_CODES.EMPTY_FILE });
  });

  test("bubbles up parseCsv's MALFORMED_ROW code for an unterminated quote", async () => {
    const { service } = loadService();

    await expect(
      service.createImportSessionPreview({
        userId: USER_ID,
        originalFilename: "bad.csv",
        fileBuffer: csvBuffer('Date,Amount,Merchant,Category\n2026-01-15,42.50,"Fresh Mart,Groceries\n'),
        columnMapping: VALID_MAPPING,
      })
    ).rejects.toMatchObject({ code: CSV_ERROR_CODES.MALFORMED_ROW });
  });

  test("bubbles up parseCsv's TOO_MANY_ROWS code for an oversized row count", async () => {
    const { service } = loadService();
    const header = "Date,Amount,Merchant,Category\n";
    const row = "2026-01-15,10,Coffee Shop,Dining\n";
    const bigCsv = header + row.repeat(5001);

    await expect(
      service.createImportSessionPreview({
        userId: USER_ID,
        originalFilename: "huge.csv",
        fileBuffer: csvBuffer(bigCsv),
        columnMapping: VALID_MAPPING,
      })
    ).rejects.toMatchObject({ code: CSV_ERROR_CODES.TOO_MANY_ROWS });
  });
});

describe("getImportSessionSafeShape", () => {
  test("returns the safe shape for a session owned by the requesting user", async () => {
    const doc = makeSessionDoc();
    const { service, mocks } = loadService({ findOneImpl: async (query) => (query.userId === USER_ID ? doc : null) });

    const result = await service.getImportSessionSafeShape({ userId: USER_ID, sessionId: SESSION_ID });

    expect(mocks.findOne).toHaveBeenCalledWith({ _id: SESSION_ID, userId: USER_ID });
    expect(result).not.toBeNull();
    expect(result.id).toBe(SESSION_ID);
  });

  test("returns null (not the other user's session) when owned by someone else", async () => {
    const doc = makeSessionDoc({ userId: OTHER_USER_ID });
    const { service } = loadService({ findOneImpl: async (query) => (query.userId === OTHER_USER_ID ? doc : null) });

    const result = await service.getImportSessionSafeShape({ userId: USER_ID, sessionId: SESSION_ID });

    expect(result).toBeNull();
  });
});

describe("listImportSessionsSafeShape", () => {
  test("returns light shapes (rowCount, no rows) scoped to the requesting user", async () => {
    const docs = [makeSessionDoc(), makeSessionDoc({ _id: "64f1a2b3c4d5e6f7a8b9c0dd" })];
    const { service, mocks } = loadService({ findImpl: async () => docs });

    const result = await service.listImportSessionsSafeShape({ userId: USER_ID });

    expect(mocks.find).toHaveBeenCalledWith({ userId: USER_ID });
    expect(result).toHaveLength(2);
    expect(result[0].rowCount).toBe(1);
    expect(result[0].rows).toBeUndefined();
  });
});

describe("decideImportRow", () => {
  test("happy path: sets the row's decision and saves", async () => {
    const doc = makeSessionDoc();
    const { service } = loadService({ findOneImpl: async () => doc });

    const result = await service.decideImportRow({ userId: USER_ID, sessionId: SESSION_ID, rowIndex: 0, decision: "accept" });

    expect(doc.rows[0].decision).toBe("accept");
    expect(doc.save).toHaveBeenCalledTimes(1);
    expect(result.rows[0].decision).toBe("accept");
  });

  test("NOT_FOUND when no session matches the ownership-scoped query", async () => {
    const { service } = loadService({ findOneImpl: async () => null });

    await expect(
      service.decideImportRow({ userId: USER_ID, sessionId: SESSION_ID, rowIndex: 0, decision: "accept" })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.NOT_FOUND });
  });

  test("SESSION_NOT_PREVIEWING when the session has already moved past previewing", async () => {
    const doc = makeSessionDoc({ status: "committed" });
    const { service } = loadService({ findOneImpl: async () => doc });

    await expect(
      service.decideImportRow({ userId: USER_ID, sessionId: SESSION_ID, rowIndex: 0, decision: "accept" })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.SESSION_NOT_PREVIEWING });
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("ROW_NOT_FOUND when rowIndex is out of bounds", async () => {
    const doc = makeSessionDoc();
    const { service } = loadService({ findOneImpl: async () => doc });

    await expect(
      service.decideImportRow({ userId: USER_ID, sessionId: SESSION_ID, rowIndex: 99, decision: "accept" })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.ROW_NOT_FOUND });
    expect(doc.save).not.toHaveBeenCalled();
  });

  test("INVALID_DECISION when decision is not accept/skip (including an explicit pending target)", async () => {
    const doc = makeSessionDoc();
    const { service, mocks } = loadService({ findOneImpl: async () => doc });

    await expect(
      service.decideImportRow({ userId: USER_ID, sessionId: SESSION_ID, rowIndex: 0, decision: "pending" })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.INVALID_DECISION });
    // Rejected before the ownership-scoped lookup even runs.
    expect(mocks.findOne).not.toHaveBeenCalled();

    await expect(
      service.decideImportRow({ userId: USER_ID, sessionId: SESSION_ID, rowIndex: 0, decision: "bogus" })
    ).rejects.toMatchObject({ code: service.ERROR_CODES.INVALID_DECISION });
  });
});
