"use strict";

// Export domains, formats, limits and version metadata.
const EXPORT_DOMAINS = Object.freeze({
  EXPENSES: "expenses",
  INCOME: "income",
  BUDGETS: "budgets",
  ALL: "all",
});
const EXPORT_DOMAIN_VALUES = Object.freeze(Object.values(EXPORT_DOMAINS));

const EXPORT_FORMATS = Object.freeze({ CSV: "csv", JSON: "json" });
const EXPORT_FORMAT_VALUES = Object.freeze(Object.values(EXPORT_FORMATS));

// "all" combines three differently-shaped tables (expenses/income/budgets) into one file.
function isDomainFormatCombinationValid(domain, format) {
  if (domain === EXPORT_DOMAINS.ALL) return format === EXPORT_FORMATS.JSON;
  return EXPORT_FORMAT_VALUES.includes(format);
}

const EXPORT_STATUSES = Object.freeze({
  QUEUED: "queued",
  PROCESSING: "processing",
  READY: "ready",
  FAILED: "failed",
  EXPIRED: "expired",
});
const EXPORT_STATUS_VALUES = Object.freeze(Object.values(EXPORT_STATUSES));

const EXPORT_SCHEMA_VERSION = 1;

// Below this row count, DAT-004-T03's synchronous path generates and streams the file directly in the HTTP response -- no ExportRequest document, nothing written to disk, nothing to expire.
const SYNC_ROW_LIMIT = 5000;

// Hard ceiling on ANY single export, sync or queued -- an unbounded query against a user's own full history is still an unbounded query.
const MAX_EXPORT_ROWS = 200000;

// Js's sweep deletes it and marks the request "expired".
const EXPORT_EXPIRY_HOURS = 24;

function isValidDomain(value) {
  return typeof value === "string" && EXPORT_DOMAIN_VALUES.includes(value);
}

function isValidFormat(value) {
  return typeof value === "string" && EXPORT_FORMAT_VALUES.includes(value);
}

// CSV formula-injection defense (DAT-004-T07's own requirement, applied everywhere a cell is written, not just in the test suite that checks it).
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r", "\n"]);

function sanitizeCsvCell(rawValue) {
  const value = rawValue === null || rawValue === undefined ? "" : String(rawValue);
  const needsFormulaGuard = value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0]);
  const guarded = needsFormulaGuard ? `'${value}` : value;
  // Standard CSV quoting: wrap in double quotes and escape embedded quotes whenever the value contains a comma, quote, or newline (including one introduced by the formula guard's leading apostrophe -- an apostrophe itself needs no escaping, but the field may already contain a quote).
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function csvRow(values) {
  return values.map(sanitizeCsvCell).join(",") + "\r\n";
}

// A safe, predictable download filename -- never derived from user input (no merchant/category names), so it can never carry a path separator or a shell/formula-injection character itself.
function buildExportFileName(domain, format, generatedAt = new Date()) {
  const stamp = generatedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  return `balensia-export-${domain}-${stamp}.${format}`;
}

module.exports = {
  EXPORT_DOMAINS,
  EXPORT_DOMAIN_VALUES,
  EXPORT_FORMATS,
  EXPORT_FORMAT_VALUES,
  EXPORT_STATUSES,
  EXPORT_STATUS_VALUES,
  EXPORT_SCHEMA_VERSION,
  SYNC_ROW_LIMIT,
  MAX_EXPORT_ROWS,
  EXPORT_EXPIRY_HOURS,
  isValidDomain,
  isValidFormat,
  isDomainFormatCombinationValid,
  sanitizeCsvCell,
  csvRow,
  buildExportFileName,
};
