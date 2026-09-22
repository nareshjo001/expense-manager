"use strict";

// IMP-001-T03 -- best-effort column-mapping suggestion + per-row
// map/validate for CSV import. Consumed by importSessionService.js
// (T04): suggestColumnMapping backs POST /api/imports/headers's
// suggestedMapping, and mapAndValidateRow is run once per CSV data row
// while building an ImportSession's `rows` subdocuments.
const { sanitizeCsvCell } = require("../../utils/csvStreamParser");
const {
  IMPORT_TARGET_FIELDS,
  IMPORT_ROW_ERROR_CODES,
} = require("../../utils/importTypes");

// Common header spellings this app has seen from other tools' CSV
// exports, lower-cased for case-insensitive matching. First alias that
// matches a (trimmed, lower-cased) header wins; header order in the
// file breaks ties (first matching column, left to right).
const FIELD_ALIASES = Object.freeze({
  [IMPORT_TARGET_FIELDS.DATE]: ["date", "transaction date", "posted date"],
  [IMPORT_TARGET_FIELDS.AMOUNT]: ["amount", "transaction amount", "price", "cost"],
  [IMPORT_TARGET_FIELDS.MERCHANT]: ["merchant", "description", "payee", "vendor", "name"],
  [IMPORT_TARGET_FIELDS.CATEGORY]: ["category", "expensecategory"],
});

function normalizeHeader(header) {
  return String(header == null ? "" : header).trim().toLowerCase();
}

// { headerRow } -> { date, amount, merchant, category }, each either a
// header string taken verbatim from headerRow (never re-cased/trimmed --
// the exact value columnMapping needs to headerRow.indexOf() back
// against later) or null when nothing in headerRow matches any alias
// for that target field.
function suggestColumnMapping({ headerRow }) {
  const normalized = (headerRow || []).map(normalizeHeader);
  const suggestion = {};

  for (const targetField of Object.values(IMPORT_TARGET_FIELDS)) {
    const aliases = FIELD_ALIASES[targetField];
    let match = null;
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        match = headerRow[idx];
        break;
      }
    }
    suggestion[targetField] = match;
  }

  return suggestion;
}

function readCell({ headerRow, rawRow, mappedHeader }) {
  if (!mappedHeader) return "";
  const index = headerRow.indexOf(mappedHeader);
  if (index === -1 || index >= rawRow.length) return "";
  const raw = rawRow[index];
  return sanitizeCsvCell(String(raw == null ? "" : raw).trim());
}

// { headerRow, rawRow, columnMapping } -> { mapped, validationErrors }.
// Never throws -- an invalid/missing field is recorded as a
// validationErrors entry and the corresponding `mapped.*` value is null,
// so the caller can still show the row in a preview UI.
function mapAndValidateRow({ headerRow, rawRow, columnMapping }) {
  const validationErrors = [];
  const mapping = columnMapping || {};

  const merchantCell = readCell({ headerRow, rawRow, mappedHeader: mapping[IMPORT_TARGET_FIELDS.MERCHANT] });
  const dateCell = readCell({ headerRow, rawRow, mappedHeader: mapping[IMPORT_TARGET_FIELDS.DATE] });
  const amountCell = readCell({ headerRow, rawRow, mappedHeader: mapping[IMPORT_TARGET_FIELDS.AMOUNT] });
  const categoryCell = readCell({ headerRow, rawRow, mappedHeader: mapping[IMPORT_TARGET_FIELDS.CATEGORY] });

  // merchant -> expenseName
  let expenseName;
  if (merchantCell === "") {
    validationErrors.push(IMPORT_ROW_ERROR_CODES.MISSING_MERCHANT);
    expenseName = null;
  } else {
    expenseName = merchantCell;
  }

  // date -> expenseDate. Only validated for parseability -- never
  // reformatted, the raw (sanitized) cell string is what's stored, same
  // as a manually-added expense's own expenseDate input.
  let expenseDate;
  if (dateCell === "") {
    validationErrors.push(IMPORT_ROW_ERROR_CODES.MISSING_DATE);
    expenseDate = null;
  } else {
    const parsedDate = new Date(dateCell);
    if (Number.isNaN(parsedDate.getTime())) {
      validationErrors.push(IMPORT_ROW_ERROR_CODES.INVALID_DATE);
      expenseDate = null;
    } else {
      expenseDate = dateCell;
    }
  }

  // amount -> expenseAmount. Strips a leading currency symbol and
  // thousands separators only -- a negative sign is preserved
  // deliberately (some export tools use negative amounts for
  // refunds/credits; this mapper does not reject on sign, callers that
  // care can filter on it).
  //
  // amountCell has already been through sanitizeCsvCell (readCell,
  // above), which -- being built for CSV re-serialization, not
  // numeric parsing -- may itself have (a) wrapped the value in a
  // literal quote pair (a raw value containing a comma, e.g.
  // "$1,234.56", trips sanitizeCsvCell's own CSV-quoting rule) and/or
  // (b) prefixed a leading formula-guard apostrophe (a raw value
  // starting with "-" -- OWASP's own formula-trigger char set -- e.g.
  // "-19.99"). Both are undone here, before stripping $ and commas, so
  // a sanitized-for-storage cell still parses as the number it was.
  let expenseAmount;
  if (amountCell === "") {
    validationErrors.push(IMPORT_ROW_ERROR_CODES.MISSING_AMOUNT);
    expenseAmount = null;
  } else {
    let unwrapped = amountCell;
    if (unwrapped.length >= 2 && unwrapped[0] === '"' && unwrapped[unwrapped.length - 1] === '"') {
      unwrapped = unwrapped.slice(1, -1).replace(/""/g, '"');
    }
    if (unwrapped[0] === "'") {
      unwrapped = unwrapped.slice(1);
    }
    const cleaned = unwrapped.replace(/\$/g, "").replace(/,/g, "").trim();
    const parsedAmount = cleaned === "" ? NaN : Number(cleaned);
    if (Number.isNaN(parsedAmount)) {
      validationErrors.push(IMPORT_ROW_ERROR_CODES.INVALID_AMOUNT);
      expenseAmount = null;
    } else {
      expenseAmount = parsedAmount;
    }
  }

  // category -> expenseCategory. Optional (not in
  // IMPORT_REQUIRED_TARGET_FIELDS) -- never produces a validation error.
  const expenseCategory = categoryCell === "" ? null : categoryCell;

  return {
    mapped: { expenseName, expenseAmount, expenseDate, expenseCategory },
    validationErrors,
  };
}

module.exports = {
  suggestColumnMapping,
  mapAndValidateRow,
};
