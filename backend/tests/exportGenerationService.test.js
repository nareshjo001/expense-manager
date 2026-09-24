// DAT-004-T0X -- Services/ExportServices/exportGenerationService.js.
//
// Exercised against small in-memory fake ExpenseModel/IncomeModel/
// BudgetModel (countDocuments + find().lean()), the same fast
// no-real-Mongo pattern recurringLifecycleService.test.js uses. money.js/
// moneyView.js are left un-mocked -- they are pure functions with no DB
// access, so there is no reason to fake the exact formatting logic this
// module is supposed to be exercising.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const EXPORT_TYPES_PATH = "../utils/exportTypes";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

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

function makeFakeModel(docs) {
  return {
    countDocuments: jest.fn(async (filter = {}) => docs.filter((d) => matchesFilter(d, filter)).length),
    find: jest.fn((filter = {}) => ({
      lean: async () => docs.filter((d) => matchesFilter(d, filter)).map((d) => ({ ...d })),
    })),
  };
}

function loadService({ expenses = [], income = [], budgets = [] } = {}) {
  jest.resetModules();
  const ExpenseModel = makeFakeModel(expenses);
  const IncomeModel = makeFakeModel(income);
  const BudgetModel = makeFakeModel(budgets);
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel, IncomeModel, BudgetModel }));
  const service = require("../Services/ExportServices/exportGenerationService");
  return { service, ExpenseModel, IncomeModel, BudgetModel };
}

function expenseDoc(overrides = {}) {
  return {
    _id: "e1",
    userId: USER_ID,
    id: "exp-1",
    expenseName: "Netflix",
    expenseCategory: "Entertainment",
    expenseAmount: 649,
    expenseDate: new Date("2026-01-15T00:00:00.000Z"),
    expenseDescription: "",
    ...overrides,
  };
}

function incomeDoc(overrides = {}) {
  return {
    _id: "i1",
    userId: USER_ID,
    incomeSource: "Salary",
    incomeAmount: 50000,
    incomeDate: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function budgetDoc(overrides = {}) {
  return {
    _id: "b1",
    userId: USER_ID,
    month: "Jan 2026",
    budget: 1000,
    spent: 250.5,
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("countExportRows", () => {
  test("counts expenses for the requesting user only, without fetching rows", async () => {
    const { service, ExpenseModel } = loadService({
      expenses: [expenseDoc(), expenseDoc({ _id: "e2", userId: OTHER_USER_ID })],
    });

    const count = await service.countExportRows({ userId: USER_ID, domain: "expenses" });

    expect(count).toBe(1);
    expect(ExpenseModel.countDocuments).toHaveBeenCalledTimes(1);
    expect(ExpenseModel.find).not.toHaveBeenCalled();
  });

  test("counts income", async () => {
    const { service } = loadService({ income: [incomeDoc(), incomeDoc({ _id: "i2" })] });
    const count = await service.countExportRows({ userId: USER_ID, domain: "income" });
    expect(count).toBe(2);
  });

  test("counts budgets, ignoring dateFrom/dateTo entirely -- month has no date field to range against", async () => {
    const { service, BudgetModel } = loadService({
      budgets: [budgetDoc(), budgetDoc({ _id: "b2", month: "Feb 2026" })],
    });

    const count = await service.countExportRows({
      userId: USER_ID,
      domain: "budgets",
      dateFrom: new Date("2030-01-01"),
      dateTo: new Date("2030-02-01"),
    });

    expect(count).toBe(2); // both counted despite the out-of-range window
    const filterUsed = BudgetModel.countDocuments.mock.calls[0][0];
    expect(filterUsed).toEqual({ userId: USER_ID });
  });

  test("domain 'all' sums the three domain counts", async () => {
    const { service } = loadService({
      expenses: [expenseDoc()],
      income: [incomeDoc(), incomeDoc({ _id: "i2" })],
      budgets: [budgetDoc(), budgetDoc({ _id: "b2" }), budgetDoc({ _id: "b3" })],
    });

    const count = await service.countExportRows({ userId: USER_ID, domain: "all" });
    expect(count).toBe(1 + 2 + 3);
  });

  test("date-range filters expenseDate for the expenses domain", async () => {
    const { service } = loadService({
      expenses: [
        expenseDoc({ _id: "in-range", expenseDate: new Date("2026-03-15") }),
        expenseDoc({ _id: "out-of-range", expenseDate: new Date("2026-05-01") }),
      ],
    });

    const count = await service.countExportRows({
      userId: USER_ID,
      domain: "expenses",
      dateFrom: new Date("2026-03-01"),
      dateTo: new Date("2026-03-31"),
    });

    expect(count).toBe(1);
  });

  test("date-range filters incomeDate for the income domain", async () => {
    const { service } = loadService({
      income: [
        incomeDoc({ _id: "in-range", incomeDate: new Date("2026-03-15") }),
        incomeDoc({ _id: "out-of-range", incomeDate: new Date("2026-05-01") }),
      ],
    });

    const count = await service.countExportRows({
      userId: USER_ID,
      domain: "income",
      dateFrom: new Date("2026-03-01"),
      dateTo: new Date("2026-03-31"),
    });

    expect(count).toBe(1);
  });

  test("a normal empty result is 0, never a throw", async () => {
    const { service } = loadService({});
    await expect(service.countExportRows({ userId: USER_ID, domain: "expenses" })).resolves.toBe(0);
  });

  test("rejects an invalid domain", async () => {
    const { service } = loadService({});
    await expect(service.countExportRows({ userId: USER_ID, domain: "not-a-domain" })).rejects.toMatchObject({
      code: "INVALID_DOMAIN",
    });
  });
});

describe("generateExportPayload -- money and date formatting", () => {
  test("formats money fields as exact 2-decimal-place strings, derived via toMinorUnits/toRupees", async () => {
    const { service } = loadService({
      expenses: [expenseDoc({ expenseAmount: 649 }), expenseDoc({ _id: "e2", expenseAmount: 100.5 })],
    });

    const { content } = await service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "json" });
    const parsed = JSON.parse(content);

    expect(parsed.data.map((r) => r.amount)).toEqual(["649.00", "100.50"]);
  });

  test("formats date fields as ISO 8601 YYYY-MM-DD strings, not a serialized Date object", async () => {
    const { service } = loadService({
      expenses: [expenseDoc({ expenseDate: new Date("2026-03-05T18:30:00.000Z") })],
    });

    const { content } = await service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "json" });
    const parsed = JSON.parse(content);

    expect(parsed.data[0].date).toBe("2026-03-05");
  });

  test("budget rows format both budget and spent as 2-decimal strings, and pass month through untouched", async () => {
    const { service } = loadService({ budgets: [budgetDoc({ budget: 1000, spent: 250.5 })] });

    const { content } = await service.generateExportPayload({ userId: USER_ID, domain: "budgets", format: "json" });
    const parsed = JSON.parse(content);

    expect(parsed.data[0]).toEqual({ month: "Jan 2026", budget: "1000.00", spent: "250.50" });
  });
});

describe("generateExportPayload -- JSON", () => {
  test("includes meta.schemaVersion and a matching rowCount", async () => {
    const { service } = loadService({ expenses: [expenseDoc(), expenseDoc({ _id: "e2" })] });

    const { content, rowCount, contentType } = await service.generateExportPayload({
      userId: USER_ID,
      domain: "expenses",
      format: "json",
    });
    const parsed = JSON.parse(content);

    expect(parsed.meta.schemaVersion).toBe(1);
    expect(parsed.meta.domain).toBe("expenses");
    expect(parsed.meta.rowCount).toBe(2);
    expect(rowCount).toBe(2);
    expect(contentType).toBe("application/json");
  });

  test("domain 'all' returns one JSON object with expenses/income/budgets arrays", async () => {
    const { service } = loadService({
      expenses: [expenseDoc()],
      income: [incomeDoc()],
      budgets: [budgetDoc()],
    });

    const { content, rowCount, contentType } = await service.generateExportPayload({
      userId: USER_ID,
      domain: "all",
      format: "json",
    });
    const parsed = JSON.parse(content);

    expect(parsed.data.expenses).toHaveLength(1);
    expect(parsed.data.income).toHaveLength(1);
    expect(parsed.data.budgets).toHaveLength(1);
    expect(rowCount).toBe(3);
    expect(contentType).toBe("application/json");
  });
});

describe("generateExportPayload -- CSV", () => {
  test("emits a '#'-prefixed schema comment as the first line", async () => {
    const { service } = loadService({ expenses: [expenseDoc()] });

    const { content } = await service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "csv" });
    const [firstLine] = content.split("\r\n");

    expect(firstLine.startsWith("#")).toBe(true);
    expect(firstLine).toContain("schema=1");
    expect(firstLine).toContain("domain=expenses");
  });

  test("a cell starting with '=' is guarded with a leading apostrophe (formula-injection defense)", async () => {
    const { service } = loadService({
      expenses: [expenseDoc({ expenseName: "=SUM(A1:A2)" })],
    });

    const { content } = await service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "csv" });

    expect(content).toContain("'=SUM(A1:A2)");
    // The raw, unguarded formula string never appears as its own cell.
    expect(content).not.toContain(",=SUM(A1:A2),");
  });

  test("round-trips: dropping the comment line and splitting header/data rows recovers the written values", async () => {
    const { service } = loadService({
      expenses: [
        expenseDoc({ expenseName: "Groceries", expenseCategory: "Food", expenseAmount: 42, expenseDescription: "" }),
      ],
    });

    const { content } = await service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "csv" });

    const lines = content.split("\r\n").filter((line) => line.length > 0 && !line.startsWith("#"));
    const [headerLine, dataLine] = lines;
    const header = headerLine.split(",");
    const values = dataLine.split(",");
    const row = Object.fromEntries(header.map((key, i) => [key, values[i]]));

    expect(header).toEqual(["date", "name", "category", "amount", "description"]);
    expect(row.name).toBe("Groceries");
    expect(row.category).toBe("Food");
    expect(row.amount).toBe("42.00");
  });
});

describe("generateExportPayload -- row-limit enforcement", () => {
  test("throws a TOO_MANY_ROWS error when the row count exceeds MAX_EXPORT_ROWS, without ever fetching rows", async () => {
    jest.resetModules();
    const docs = [expenseDoc({ _id: "e1" }), expenseDoc({ _id: "e2" }), expenseDoc({ _id: "e3" })];
    const ExpenseModel = makeFakeModel(docs);
    const IncomeModel = makeFakeModel([]);
    const BudgetModel = makeFakeModel([]);
    jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel, IncomeModel, BudgetModel }));
    jest.doMock(EXPORT_TYPES_PATH, () => {
      const actual = jest.requireActual(EXPORT_TYPES_PATH);
      // Override just the ceiling, keeping every real csvRow/sanitizeCsvCell/
      // domain-validation behaviour this module also depends on.
      return { ...actual, MAX_EXPORT_ROWS: 2 };
    });
    const service = require("../Services/ExportServices/exportGenerationService");

    await expect(
      service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "json" })
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });

    expect(ExpenseModel.find).not.toHaveBeenCalled();
  });

  test("a domain 'all' request whose SUMMED count exceeds the ceiling also throws TOO_MANY_ROWS", async () => {
    jest.resetModules();
    const ExpenseModel = makeFakeModel([expenseDoc({ _id: "e1" }), expenseDoc({ _id: "e2" })]);
    const IncomeModel = makeFakeModel([incomeDoc({ _id: "i1" })]);
    const BudgetModel = makeFakeModel([]);
    jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel, IncomeModel, BudgetModel }));
    jest.doMock(EXPORT_TYPES_PATH, () => {
      const actual = jest.requireActual(EXPORT_TYPES_PATH);
      return { ...actual, MAX_EXPORT_ROWS: 2 };
    });
    const service = require("../Services/ExportServices/exportGenerationService");

    await expect(
      service.generateExportPayload({ userId: USER_ID, domain: "all", format: "json" })
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
  });
});

describe("generateExportPayload -- validation", () => {
  test("rejects an invalid domain", async () => {
    const { service } = loadService({});
    await expect(
      service.generateExportPayload({ userId: USER_ID, domain: "not-a-domain", format: "json" })
    ).rejects.toMatchObject({ code: "INVALID_DOMAIN" });
  });

  test("rejects an invalid format", async () => {
    const { service } = loadService({});
    await expect(
      service.generateExportPayload({ userId: USER_ID, domain: "expenses", format: "xml" })
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });
  });

  test("rejects domain 'all' with format 'csv' -- an invalid combination per utils/exportTypes.js", async () => {
    const { service } = loadService({});
    await expect(
      service.generateExportPayload({ userId: USER_ID, domain: "all", format: "csv" })
    ).rejects.toMatchObject({ code: "INVALID_COMBINATION" });
  });
});
