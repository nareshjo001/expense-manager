"use strict";

// DAT-004-T04 -- request-lifecycle orchestration for the export feature.
// This module owns none of the actual row-fetch/serialization logic (that
// is Services/ExportServices/exportGenerationService.js) and none of the
// disk I/O for a queued export's file (that is cron/exportGeneration.js
// for writing, Controllers/Export/download.js for reading) -- it is the
// thin layer in between that decides sync-vs-queued, creates/reads
// ExportRequest documents, and enforces per-user ownership on every read.
//
// Error convention: every validation/not-found failure is a thrown Error
// with a `.code` string, reusing exportGenerationService's ERROR_CODES for
// the domain/format/combination/row-limit cases (so a single source of
// truth for what those four codes mean exists across both modules) plus
// one additional NOT_FOUND code of our own for the ownership-scoped reads.
// Controllers/Export/*.js map `.code` to an HTTP status; nothing in this
// file talks HTTP.
const crypto = require("crypto");
const ExportRequest = require("../../models/ExportRequest");
const {
  countExportRows,
  generateExportPayload,
  ERROR_CODES: GENERATION_ERROR_CODES,
} = require("./exportGenerationService");
const {
  EXPORT_STATUSES,
  EXPORT_FORMATS,
  SYNC_ROW_LIMIT,
  MAX_EXPORT_ROWS,
  isValidDomain,
  isValidFormat,
  isDomainFormatCombinationValid,
  buildExportFileName,
} = require("../../utils/exportTypes");

// This module's own error codes = exportGenerationService's four codes
// (re-exported so callers only need one ERROR_CODES import) plus
// NOT_FOUND, used by the ownership-scoped reads below. Deliberately not
// distinguishing "wrong owner" from "doesn't exist" -- both map to the
// same NOT_FOUND code, so a client (or an attacker probing IDs/tokens)
// gets identical information either way.
const ERROR_CODES = Object.freeze({
  ...GENERATION_ERROR_CODES,
  NOT_FOUND: "NOT_FOUND",
});

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function assertValidExportRequest(domain, format) {
  if (!isValidDomain(domain)) {
    throw makeError(`createExportRequest: invalid domain "${domain}".`, ERROR_CODES.INVALID_DOMAIN);
  }
  if (!isValidFormat(format)) {
    throw makeError(`createExportRequest: invalid format "${format}".`, ERROR_CODES.INVALID_FORMAT);
  }
  if (!isDomainFormatCombinationValid(domain, format)) {
    throw makeError(
      `createExportRequest: domain "${domain}" cannot be exported as "${format}".`,
      ERROR_CODES.INVALID_COMBINATION
    );
  }
}

// crypto.randomBytes(24) -> 48 hex chars, same cryptographically-random,
// unguessable-token shape Services/AuthServices/security.service.js and
// Services/syncRecoveryService.js already use for reset/recovery tokens
// (base64url there vs hex here only because this token also has to be
// safe as a bare URL path segment and a filesystem-safe filename --
// cron/exportGeneration.js writes it straight into a file path -- and hex
// needs no extra encoding-safety reasoning to guarantee that).
function generateDownloadToken() {
  return crypto.randomBytes(24).toString("hex");
}

// Shapes one ExportRequest document for a client response. Deliberately
// omits filePath (server-side only, never sent to the client -- see
// models/ExportRequest.js's own comment) and the raw downloadToken;
// downloadUrl is the only place the token is ever exposed, and only once
// the file actually exists to serve (status "ready").
function toSafeShape(doc) {
  return {
    id: String(doc._id),
    domain: doc.domain,
    format: doc.format,
    dateFrom: doc.dateFrom,
    dateTo: doc.dateTo,
    status: doc.status,
    rowCount: doc.rowCount,
    sizeBytes: doc.sizeBytes,
    fileName: doc.fileName,
    errorMessage: doc.status === EXPORT_STATUSES.FAILED ? doc.errorMessage : null,
    readyAt: doc.readyAt,
    expiresAt: doc.expiresAt,
    createdAt: doc.createdAt,
    downloadUrl: doc.status === EXPORT_STATUSES.READY ? `/api/export/download/${doc.downloadToken}` : null,
  };
}

// Decides sync vs queued and either generates the payload inline or
// creates a queued ExportRequest for cron/exportGeneration.js to pick up.
//
// Row-limit enforcement happens BEFORE anything is created, via
// countExportRows -- a request that would exceed MAX_EXPORT_ROWS never
// creates an ExportRequest document and never touches disk, matching
// generateExportPayload's own "count before fetch" posture in
// exportGenerationService.js.
//
// count === 0 is a valid (empty) export, not an error -- proceeds down
// whichever path (sync, since 0 < SYNC_ROW_LIMIT) it would normally take.
async function createExportRequest({ userId, domain, format, dateFrom, dateTo }) {
  assertValidExportRequest(domain, format);

  const rowCount = await countExportRows({ userId, domain, dateFrom, dateTo });
  if (rowCount > MAX_EXPORT_ROWS) {
    throw makeError(
      `createExportRequest: row count ${rowCount} exceeds the maximum of ${MAX_EXPORT_ROWS}.`,
      ERROR_CODES.TOO_MANY_ROWS
    );
  }

  if (rowCount < SYNC_ROW_LIMIT) {
    const { content, contentType } = await generateExportPayload({ userId, domain, format, dateFrom, dateTo });
    const fileName = buildExportFileName(domain, format);
    return { mode: "sync", content, contentType, fileName, rowCount };
  }

  const downloadToken = generateDownloadToken();
  const created = await ExportRequest.create({
    userId,
    domain,
    format,
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    status: EXPORT_STATUSES.QUEUED,
    downloadToken,
  });

  return {
    mode: "queued",
    id: String(created._id),
    status: created.status,
    domain: created.domain,
    format: created.format,
  };
}

// Returns the requesting user's own ExportRequest docs, newest first,
// each in the client-safe shape (see toSafeShape).
async function listExportRequests({ userId }) {
  const docs = await ExportRequest.find({ userId }).sort({ createdAt: -1 }).lean();
  return docs.map(toSafeShape);
}

// Ownership-scoped single-document read: the query filters on BOTH _id
// and userId in one step, so a request that exists but belongs to another
// user is indistinguishable from one that does not exist at all -- both
// come back null here and both become the same NOT_FOUND to the caller.
async function getExportRequestStatus({ userId, id }) {
  const doc = await ExportRequest.findOne({ _id: id, userId }).lean();
  if (!doc) {
    throw makeError(`getExportRequestStatus: no export request "${id}" for this user.`, ERROR_CODES.NOT_FOUND);
  }
  return toSafeShape(doc);
}

// Resolves a downloadToken to the on-disk file location, enforcing every
// condition that must hold for a download to be servable: the token
// belongs to THIS user (a token guessed or leaked without also matching
// the requesting user's id fails, same ownership posture as
// getExportRequestStatus), the request is "ready" (not queued/processing/
// failed), and it has not yet expired (an expired-but-not-yet-swept file
// must not be servable even if it is technically still on disk).
//
// Pure orchestration -- returns the path, does not read the file itself.
// Controllers/Export/download.js owns the actual filesystem I/O and
// streaming, consistent with this module doing no disk access anywhere
// else either (cron/exportGeneration.js is the only writer).
async function resolveDownload({ userId, token }) {
  const now = new Date();
  const doc = await ExportRequest.findOne({
    downloadToken: token,
    userId,
    status: EXPORT_STATUSES.READY,
  }).lean();

  if (!doc || !doc.expiresAt || doc.expiresAt <= now || !doc.filePath) {
    throw makeError("resolveDownload: no ready, unexpired export for this token/user.", ERROR_CODES.NOT_FOUND);
  }

  const contentType = doc.format === EXPORT_FORMATS.CSV ? "text/csv" : "application/json";
  return { filePath: doc.filePath, fileName: doc.fileName, contentType };
}

module.exports = {
  ERROR_CODES,
  createExportRequest,
  listExportRequests,
  getExportRequestStatus,
  resolveDownload,
};
