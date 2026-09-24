// IMP-001-T03 -- Services/ImportServices/importMappingService.js.
// Pure functions, no mocking needed -- exercises suggestColumnMapping's
// alias matching and mapAndValidateRow's per-field validation directly.
"use strict";

const { suggestColumnMapping, mapAndValidateRow } = require("../Services/ImportServices/importMappingService");
const { IMPORT_ROW_ERROR_CODES } = require("../utils/importTypes");

describe("suggestColumnMapping", () => {
  test("matches common header variants case-insensitively", () => {
    const headerRow = ["Transaction Date", "Amount", "Description", "Category"];
    expect(suggestColumnMapping({ headerRow })).toEqual({
      date: "Transaction Date",
      amount: "Amount",
      merchant: "Description",
      category: "Category",
    });
  });

  test("matches aliases regardless of case and surrounding whitespace", () => {
    const headerRow = [" DATE ", " price ", " Payee ", " expenseCategory "];
    expect(suggestColumnMapping({ headerRow })).toEqual({
      date: " DATE ",
      amount: " price ",
      merchant: " Payee ",
      category: " expenseCategory ",
    });
  });

  test("returns null for every field when nothing in the header row matches", () => {
    const headerRow = ["Col A", "Col B", "Col C"];
    expect(suggestColumnMapping({ headerRow })).toEqual({
      date: null,
      amount: null,
      merchant: null,
      category: null,
    });
  });
});

describe("mapAndValidateRow", () => {
  const headerRow = ["Date", "Amount", "Merchant", "Category"];
  const columnMapping = { date: "Date", amount: "Amount", merchant: "Merchant", category: "Category" };

  test("valid full row maps cleanly with no validation errors", () => {
    const rawRow = ["2026-01-15", "42.50", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([]);
    expect(mapped).toEqual({
      expenseName: "Fresh Mart",
      expenseAmount: 42.5,
      expenseDate: "2026-01-15",
      expenseCategory: "Groceries",
    });
  });

  test("missing merchant cell -> MISSING_MERCHANT, expenseName null", () => {
    const rawRow = ["2026-01-15", "42.50", "", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([IMPORT_ROW_ERROR_CODES.MISSING_MERCHANT]);
    expect(mapped.expenseName).toBeNull();
  });

  test("missing date cell -> MISSING_DATE, expenseDate null", () => {
    const rawRow = ["", "42.50", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([IMPORT_ROW_ERROR_CODES.MISSING_DATE]);
    expect(mapped.expenseDate).toBeNull();
  });

  test("unparseable date cell -> INVALID_DATE, expenseDate null", () => {
    const rawRow = ["not-a-date", "42.50", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([IMPORT_ROW_ERROR_CODES.INVALID_DATE]);
    expect(mapped.expenseDate).toBeNull();
  });

  test("missing amount cell -> MISSING_AMOUNT, expenseAmount null", () => {
    const rawRow = ["2026-01-15", "", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([IMPORT_ROW_ERROR_CODES.MISSING_AMOUNT]);
    expect(mapped.expenseAmount).toBeNull();
  });

  test("unparseable amount cell -> INVALID_AMOUNT, expenseAmount null", () => {
    const rawRow = ["2026-01-15", "not-a-number", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([IMPORT_ROW_ERROR_CODES.INVALID_AMOUNT]);
    expect(mapped.expenseAmount).toBeNull();
  });

  test("amount with a leading $ and thousands commas parses correctly", () => {
    const rawRow = ["2026-01-15", "$1,234.56", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([]);
    expect(mapped.expenseAmount).toBe(1234.56);
  });

  test("negative amount (refund/credit export convention) is allowed, not rejected on sign", () => {
    const rawRow = ["2026-01-15", "-19.99", "Fresh Mart", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([]);
    expect(mapped.expenseAmount).toBe(-19.99);
  });

  test("empty/unmapped category is null with no validation error -- category is optional", () => {
    const rawRow = ["2026-01-15", "42.50", "Fresh Mart", ""];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([]);
    expect(mapped.expenseCategory).toBeNull();
  });

  test("a formula-injection merchant cell comes back sanitized with a leading apostrophe", () => {
    const rawRow = ["2026-01-15", "42.50", "=SUM(A1)", "Groceries"];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors).toEqual([]);
    expect(mapped.expenseName).toBe("'=SUM(A1)");
  });

  test("multiple missing/invalid fields at once each contribute their own error code", () => {
    const rawRow = ["not-a-date", "not-a-number", "", ""];
    const { mapped, validationErrors } = mapAndValidateRow({ headerRow, rawRow, columnMapping });

    expect(validationErrors.sort()).toEqual(
      [
        IMPORT_ROW_ERROR_CODES.INVALID_DATE,
        IMPORT_ROW_ERROR_CODES.INVALID_AMOUNT,
        IMPORT_ROW_ERROR_CODES.MISSING_MERCHANT,
      ].sort()
    );
    expect(mapped.expenseCategory).toBeNull();
  });
});
