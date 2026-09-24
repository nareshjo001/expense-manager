"use strict";

// DAT-004-T0X -- generates the actual export payload (row counting +
// serialization) for both the synchronous (SYNC_ROW_LIMIT) and queued
// (cron/exportGeneration.js) paths described in utils/exportTypes.js.
// This module owns none of the request lifecycle (that's ExportRequest /
// the controller layer) -- it is a pure data-fetch-and-serialize unit with
// exactly two entry points, so the two other agents' controller/cron code
// can call it without needing to know how a row is counted, fetched, or
// turned into CSV/JSON.
//
// Every money field this module emits is a plain "123.45" decimal string,
// derived through utils/money.js/utils/moneyView.js's shared helpers
// (never a raw, possibly float-imprecise number reformatted ad hoc) --
// this is a financial export, so the same rounding rule ADR-0003 already
// enforces everywhere else in this codebase applies here too. Every date
// field is an ISO 8601 "YYYY-MM-DD" string, not a serialized Date object.
const { ExpenseModel, IncomeModel, BudgetModel } = require("../../config/Schemas");
const { toRupees } = require("../../utils/money");
const { toMinorOrNull } = require("../../utils/moneyView");
const {
  EXPORT_DOMAINS,
  EXPORT_FORMATS,
  EXPORT_SCHEMA_VERSION,
  MAX_EXPORT_ROWS,
  isValidDomain,
  isValidFormat,
  isDomainFormatCombinationValid,
  csvRow,
} = require("../../utils/exportTypes");

// Distinguishable error codes a caller (the cron job, or any future direct
// caller) can branch on without string-matching a message.
const ERROR_CODES = Object.freeze({
  INVALID_DOMAIN: "INVALID_DOMAIN",
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_COMBINATION: "INVALID_COMBINATION",
  TOO_MANY_ROWS: "TOO_MANY_ROWS",
});

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Renders a rupee amount (whatever precision it happens to be stored at)
// as an exact 2-decimal-place decimal string, going through the same
// integer-paise conversion the rest of the codebase treats as
// authoritative (ADR-0003) rather than re-rounding the float independently.
// A missing/non-finite amount (toMinorOrNull's null case) is exported as
// "0.00" -- an export cell has no way to represent "absent" other than
// picking a value, and every money field on these three schemas is
// `required: true` in practice, so this only guards against a malformed
// document, not an expected shape.
function formatMoneyField(rupees) {
  const minor = toMinorOrNull(rupees);
  if (minor === null) return "0.00";
  return toRupees(minor).toFixed(2);
}

// Renders a Date (or anything Date-constructible) as "YYYY-MM-DD". Falls
// back to an empty string for a missing/invalid date rather than emitting
// "Invalid Date" or throwing -- same fail-safe posture as formatMoneyField.
function formatDateField(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

// Builds a Mongo range filter for one date field, omitting either bound
// when it was not supplied -- same optional-bound shape as
// Services/ExpenseServices/expenseSearchService.js's own filter building,
// except both bounds are optional here (that service requires both).
function buildDateRangeFilter(fieldName, dateFrom, dateTo) {
  const range = {};
  if (dateFrom) range.$gte = dateFrom;
  if (dateTo) range.$lte = dateTo;
  return Object.keys(range).length > 0 ? { [fieldName]: range } : {};
}

function formatExpenseRow(doc) {
  return {
    date: formatDateField(doc.expenseDate),
    name: doc.expenseName,
    category: doc.expenseCategory,
    amount: formatMoneyField(doc.expenseAmount),
    description: doc.expenseDescription || "",
  };
}

function formatIncomeRow(doc) {
  return {
    date: formatDateField(doc.incomeDate),
    source: doc.incomeSource,
    amount: formatMoneyField(doc.incomeAmount),
  };
}

// Budgets have no date-range filter the way expenses/income do -- `month`
// is a "MMM YYYY" STRING (see config/Schemas.js's budgetSchema comment),
// not a Date, so there is no field to range-query against. dateFrom/dateTo
// are therefore always ignored for this domain: every budget document for
// the user is exported, regardless of any date range the caller passed.
function formatBudgetRow(doc) {
  return {
    month: doc.month,
    budget: formatMoneyField(doc.budget),
    spent: formatMoneyField(doc.spent),
  };
}

// Per-domain config: how to count, how to fetch, the CSV column order
// (also the JSON row's key order), and how to shape one document.
// Keeping this table-driven (rather than a switch repeated in both
// countExportRows and generateExportPayload) is what keeps the two
// functions' domain handling from drifting apart.
const DOMAIN_CONFIG = Object.freeze({
  [EXPORT_DOMAINS.EXPENSES]: {
    columns: ["date", "name", "category", "amount", "description"],
    formatRow: formatExpenseRow,
    count: (userId, dateFrom, dateTo) =>
      ExpenseModel.countDocuments({ userId, ...buildDateRangeFilter("expenseDate", dateFrom, dateTo) }),
    fetch: (userId, dateFrom, dateTo) =>
      ExpenseModel.find({ userId, ...buildDateRangeFilter("expenseDate", dateFrom, dateTo) }).lean(),
  },
  [EXPORT_DOMAINS.INCOME]: {
    columns: ["date", "source", "amount"],
    formatRow: formatIncomeRow,
    count: (userId, dateFrom, dateTo) =>
      IncomeModel.countDocuments({ userId, ...buildDateRangeFilter("incomeDate", dateFrom, dateTo) }),
    fetch: (userId, dateFrom, dateTo) =>
      IncomeModel.find({ userId, ...buildDateRangeFilter("incomeDate", dateFrom, dateTo) }).lean(),
  },
  [EXPORT_DOMAINS.BUDGETS]: {
    columns: ["month", "budget", "spent"],
    formatRow: formatBudgetRow,
    // dateFrom/dateTo deliberately unused -- see formatBudgetRow's comment.
    count: (userId) => BudgetModel.countDocuments({ userId }),
    fetch: (userId) => BudgetModel.find({ userId }).lean(),
  },
});

function assertValidRequest(domain, format) {
  if (!isValidDomain(domain)) {
    throw makeError(`generateExportPayload: invalid domain "${domain}".`, ERROR_CODES.INVALID_DOMAIN);
  }
  if (!isValidFormat(format)) {
    throw makeError(`generateExportPayload: invalid format "${format}".`, ERROR_CODES.INVALID_FORMAT);
  }
  if (!isDomainFormatCombinationValid(domain, format)) {
    throw makeError(
      `generateExportPayload: domain "${domain}" cannot be exported as "${format}".`,
      ERROR_CODES.INVALID_COMBINATION
    );
  }
}

// Counts rows WITHOUT fetching them -- a per-domain countDocuments, or the
// sum of the three domain counts for "all". userId is always a hard
// filter; dateFrom/dateTo are optional Date objects applied to
// expenseDate/incomeDate only (ignored for "budgets", see formatBudgetRow).
// A normal empty result is 0, never a throw.
async function countExportRows({ userId, domain, dateFrom, dateTo }) {
  if (!isValidDomain(domain)) {
    throw makeError(`countExportRows: invalid domain "${domain}".`, ERROR_CODES.INVALID_DOMAIN);
  }

  if (domain === EXPORT_DOMAINS.ALL) {
    const counts = await Promise.all([
      DOMAIN_CONFIG[EXPORT_DOMAINS.EXPENSES].count(userId, dateFrom, dateTo),
      DOMAIN_CONFIG[EXPORT_DOMAINS.INCOME].count(userId, dateFrom, dateTo),
      DOMAIN_CONFIG[EXPORT_DOMAINS.BUDGETS].count(userId, dateFrom, dateTo),
    ]);
    return counts.reduce((total, count) => total + count, 0);
  }

  return DOMAIN_CONFIG[domain].count(userId, dateFrom, dateTo);
}

// Fetches the actual rows and serializes them fully in memory into a
// single string, per utils/exportTypes.js's CSV/JSON contract.
//
// Row-count enforcement happens BEFORE any row is fetched, via
// countExportRows -- not as an afterthought once the (potentially huge)
// result set is already in memory. The controller/service code that
// queues a request is expected to call countExportRows itself first (see
// utils/exportTypes.js's SYNC_ROW_LIMIT/MAX_EXPORT_ROWS comments), but
// this function is exported and callable directly, so it re-checks on its
// own rather than trusting every future caller to have done that check --
// a silently truncated financial export is worse than a clear refusal.
async function generateExportPayload({ userId, domain, format, dateFrom, dateTo }) {
  assertValidRequest(domain, format);

  const totalRows = await countExportRows({ userId, domain, dateFrom, dateTo });
  if (totalRows > MAX_EXPORT_ROWS) {
    throw makeError(
      `generateExportPayload: row count ${totalRows} exceeds the maximum of ${MAX_EXPORT_ROWS}.`,
      ERROR_CODES.TOO_MANY_ROWS
    );
  }

  const generatedAt = new Date();

  if (domain === EXPORT_DOMAINS.ALL) {
    // isDomainFormatCombinationValid already guarantees format === "json"
    // for domain "all" -- CSV cannot hold three differently-shaped tables
    // (see utils/exportTypes.js's own comment on this).
    const [expenseDocs, incomeDocs, budgetDocs] = await Promise.all([
      DOMAIN_CONFIG[EXPORT_DOMAINS.EXPENSES].fetch(userId, dateFrom, dateTo),
      DOMAIN_CONFIG[EXPORT_DOMAINS.INCOME].fetch(userId, dateFrom, dateTo),
      DOMAIN_CONFIG[EXPORT_DOMAINS.BUDGETS].fetch(userId, dateFrom, dateTo),
    ]);

    const data = {
      expenses: expenseDocs.map(formatExpenseRow),
      income: incomeDocs.map(formatIncomeRow),
      budgets: budgetDocs.map(formatBudgetRow),
    };
    const rowCount = expenseDocs.length + incomeDocs.length + budgetDocs.length;

    const content = JSON.stringify({
      meta: {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        domain,
        format,
        generatedAt: generatedAt.toISOString(),
        rowCount,
      },
      data,
    });

    return { content, rowCount, contentType: "application/json" };
  }

  const config = DOMAIN_CONFIG[domain];
  const docs = await config.fetch(userId, dateFrom, dateTo);
  const rows = docs.map(config.formatRow);
  const rowCount = rows.length;

  if (format === EXPORT_FORMATS.JSON) {
    const content = JSON.stringify({
      meta: {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        domain,
        format,
        generatedAt: generatedAt.toISOString(),
        rowCount,
      },
      data: rows,
    });
    return { content, rowCount, contentType: "application/json" };
  }

  // CSV. The first line is a '#'-prefixed comment carrying the same
  // schema/domain/format/generatedAt metadata the JSON path puts in
  // `meta` -- a leading '#' is inert to every spreadsheet app and CSV
  // parser (treated as a comment or as an ordinary, harmless first cell,
  // never as a formula trigger -- utils/exportTypes.js's
  // FORMULA_TRIGGER_CHARS does not include '#'), so it never corrupts the
  // real header/data rows that follow. This is this module's own data
  // format decision (exportTypes.js defines no CSV comment convention),
  // so the round-trip (write here, re-parse in this file's own tests by
  // dropping any line starting with '#') is this module's responsibility
  // to keep correct.
  const commentLine = `# balensia-export schema=${EXPORT_SCHEMA_VERSION} domain=${domain} format=${format} generatedAt=${generatedAt.toISOString()}\r\n`;
  const header = csvRow(config.columns);
  const body = rows.map((row) => csvRow(config.columns.map((column) => row[column]))).join("");
  const content = commentLine + header + body;

  return { content, rowCount, contentType: "text/csv" };
}

module.exports = {
  countExportRows,
  generateExportPayload,
  ERROR_CODES,
  // Exposed for this module's own tests only (formatting helpers other
  // code has no reason to call directly).
  formatMoneyField,
  formatDateField,
};
