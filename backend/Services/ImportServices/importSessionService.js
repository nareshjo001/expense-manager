"use strict";

// IMP-001-T04 -- ImportSession preview lifecycle: parse headers, create a
// preview session (map + validate every row, enrich with T05's
// duplicate/category suggestions), and read/decide against it. Every
// lookup here that takes a userId is ownership-scoped -- a session
// belonging to another user is never returned, never distinguished from
// "does not exist" (same discipline duplicateCandidateService.js's own
// NOT_FOUND handling uses).
const ImportSession = require("../../models/ImportSession");
const { parseCsv, ERROR_CODES: CSV_ERROR_CODES } = require("../../utils/csvStreamParser");
const {
  MAX_IMPORT_FILE_BYTES,
  IMPORT_REQUIRED_TARGET_FIELDS,
  IMPORT_SESSION_STATUSES,
  IMPORT_ROW_DECISION_VALUES,
} = require("../../utils/importTypes");
const { suggestColumnMapping, mapAndValidateRow } = require("./importMappingService");

const ERROR_CODES = Object.freeze({
  ...CSV_ERROR_CODES,
  FILE_TOO_LARGE: "IMPORT_FILE_TOO_LARGE",
  INVALID_MAPPING: "IMPORT_INVALID_MAPPING",
  NOT_FOUND: "IMPORT_SESSION_NOT_FOUND",
  SESSION_NOT_PREVIEWING: "IMPORT_SESSION_NOT_PREVIEWING",
  ROW_NOT_FOUND: "IMPORT_ROW_NOT_FOUND",
  INVALID_DECISION: "IMPORT_INVALID_DECISION",
});

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertFileSize(fileBuffer) {
  if (!fileBuffer || fileBuffer.length > MAX_IMPORT_FILE_BYTES) {
    throw makeError(
      `Import file exceeds the maximum of ${MAX_IMPORT_FILE_BYTES} bytes.`,
      ERROR_CODES.FILE_TOO_LARGE
    );
  }
}

function parseCsvOrThrow(fileBuffer) {
  try {
    return parseCsv(fileBuffer.toString("utf8"));
  } catch (err) {
    // parseCsv's own errors are already {message, code}-shaped (see
    // csvStreamParser.js) -- re-thrown as-is (a fresh Error carrying the
    // same code) so callers never need to know parseCsv is what threw.
    throw makeError(err.message, err.code);
  }
}

function assertRequiredMapping(columnMapping) {
  const mapping = columnMapping || {};
  const missing = IMPORT_REQUIRED_TARGET_FIELDS.filter((field) => {
    const value = mapping[field];
    return typeof value !== "string" || value.trim().length === 0;
  });
  if (missing.length > 0) {
    throw makeError(
      `columnMapping is missing required field(s): ${missing.join(", ")}.`,
      ERROR_CODES.INVALID_MAPPING
    );
  }
}

// T05's module may not exist yet, or may throw/return a bad shape --
// preview creation must never fail because of it. Required inside the
// function (not at module top-level) so every OTHER export here keeps
// working even if T05's module is missing entirely.
async function safeEnrichRows({ userId, mappedRows }) {
  const fallback = () => mappedRows.map(() => ({ duplicateCandidateExpenseId: null, suggestedCategory: null }));
  try {
    const { enrichRowsWithSuggestions } = require("./importSuggestionService");
    if (typeof enrichRowsWithSuggestions !== "function") {
      return fallback();
    }
    const results = await enrichRowsWithSuggestions({ userId, mappedRows });
    if (!Array.isArray(results) || results.length !== mappedRows.length) {
      return fallback();
    }
    return results;
  } catch (err) {
    console.error("importSuggestionService.enrichRowsWithSuggestions failed; falling back to nulls for this preview.", err);
    return fallback();
  }
}

// { fileBuffer } -> { headerRow, suggestedMapping }. Used by the
// "upload and see your columns" step, before any session is created.
async function previewImportHeaders({ fileBuffer }) {
  assertFileSize(fileBuffer);
  const { headerRow } = parseCsvOrThrow(fileBuffer);
  return { headerRow, suggestedMapping: suggestColumnMapping({ headerRow }) };
}

// Plain-object shape returned to callers (controllers/frontend) --
// never leaks userId or any raw Mongo internal beyond string ids.
function toSafeShape(sessionDoc) {
  return {
    id: String(sessionDoc._id),
    originalFilename: sessionDoc.originalFilename,
    columnMapping: sessionDoc.columnMapping,
    status: sessionDoc.status,
    committedAt: sessionDoc.committedAt,
    committedCount: sessionDoc.committedCount,
    skippedCount: sessionDoc.skippedCount,
    createdAt: sessionDoc.createdAt,
    rows: sessionDoc.rows.map((r) => ({
      rowIndex: r.rowIndex,
      raw: r.raw,
      mapped: r.mapped,
      validationErrors: r.validationErrors,
      duplicateCandidateExpenseId: r.duplicateCandidateExpenseId ? String(r.duplicateCandidateExpenseId) : null,
      suggestedCategory: r.suggestedCategory,
      decision: r.decision,
      committedExpenseId: r.committedExpenseId ? String(r.committedExpenseId) : null,
    })),
  };
}

// Same as toSafeShape but without `rows` -- for the list view, which
// only needs a lightweight rowCount, not every row's full payload.
function toSafeListShape(sessionDoc) {
  const full = toSafeShape(sessionDoc);
  const { rows, ...rest } = full;
  return { ...rest, rowCount: rows.length };
}

async function createImportSessionPreview({ userId, originalFilename, fileBuffer, columnMapping }) {
  assertFileSize(fileBuffer);
  assertRequiredMapping(columnMapping);

  const { headerRow, rows: dataRows } = parseCsvOrThrow(fileBuffer);

  const mappedResults = dataRows.map((rawRow) => mapAndValidateRow({ headerRow, rawRow, columnMapping }));
  const mappedRows = mappedResults.map((r) => r.mapped);

  const suggestions = await safeEnrichRows({ userId, mappedRows });

  const rows = dataRows.map((rawRow, index) => ({
    rowIndex: index,
    raw: rawRow,
    mapped: mappedResults[index].mapped,
    validationErrors: mappedResults[index].validationErrors,
    duplicateCandidateExpenseId: suggestions[index] ? suggestions[index].duplicateCandidateExpenseId : null,
    suggestedCategory: suggestions[index] ? suggestions[index].suggestedCategory : null,
    decision: "pending",
    committedExpenseId: null,
  }));

  // Model.create(doc) is equivalent to `new ImportSession(doc).save()`
  // but mocks the same simple way Receipt.create already does elsewhere
  // in this codebase (see receiptIngestService.js) -- no separate
  // constructor + instance-method mock needed for this call site.
  const sessionDoc = await ImportSession.create({
    userId,
    originalFilename: originalFilename || null,
    columnMapping,
    rows,
    status: IMPORT_SESSION_STATUSES.PREVIEWING,
  });

  return toSafeShape(sessionDoc);
}

async function getImportSessionSafeShape({ userId, sessionId }) {
  const doc = await ImportSession.findOne({ _id: sessionId, userId });
  if (!doc) return null;
  return toSafeShape(doc);
}

async function listImportSessionsSafeShape({ userId }) {
  const docs = await ImportSession.find({ userId }).sort({ createdAt: -1 }).limit(50);
  return docs.map(toSafeListShape);
}

async function decideImportRow({ userId, sessionId, rowIndex, decision }) {
  const validTargets = IMPORT_ROW_DECISION_VALUES.filter((v) => v !== "pending");
  if (!validTargets.includes(decision)) {
    throw makeError(`decision must be one of: ${validTargets.join(", ")}.`, ERROR_CODES.INVALID_DECISION);
  }

  const doc = await ImportSession.findOne({ _id: sessionId, userId });
  if (!doc) {
    throw makeError("Import session not found.", ERROR_CODES.NOT_FOUND);
  }
  if (doc.status !== IMPORT_SESSION_STATUSES.PREVIEWING) {
    throw makeError("Import session is not in the previewing state.", ERROR_CODES.SESSION_NOT_PREVIEWING);
  }

  const index = Number(rowIndex);
  if (!Number.isInteger(index) || index < 0 || index >= doc.rows.length) {
    throw makeError("Row index is out of bounds for this session.", ERROR_CODES.ROW_NOT_FOUND);
  }

  doc.rows[index].decision = decision;
  await doc.save();

  return toSafeShape(doc);
}

module.exports = {
  ERROR_CODES,
  previewImportHeaders,
  createImportSessionPreview,
  getImportSessionSafeShape,
  listImportSessionsSafeShape,
  decideImportRow,
  toSafeShape,
};
