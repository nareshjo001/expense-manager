"use strict";

// OCR-004-T03 -- the ONLY module in this codebase allowed to import GridFS
// directly (see utils/receiptLifecycle.js's own header comment on why: the
// feature's Technical Design section treats any real object-store vendor
// -- S3, GCS, ... -- as UNKNOWN/not-approved pending its own architecture/
// privacy decision, so the concrete backend today is MongoDB GridFS, kept
// entirely behind this adapter's three functions). Every other OCR-004
// module (receiptIngestService.js, and the inbox/detail/download/retention
// modules other agents are building in parallel) goes through
// putReceiptObject/getReceiptObjectStream/deleteReceiptObject -- never
// `mongoose.connection.db` or `GridFSBucket` themselves -- so swapping the
// backend later is a change to this one file plus an ADR, not a
// find-and-replace across the codebase.
//
// Bucket name "receipts" -> backs the `receipts.files`/`receipts.chunks`
// collections Receipt.js's own header comment already documents as where
// the actual image bytes live.
//
// `mongoose` is required lazily (inside getMongoose(), below -- not at
// module load) rather than with a top-level `require("mongoose")`.
// Mongoose is a large dependency graph, and every other OCR-004 module
// reaches this file through a static `require`, so a top-level require
// here would mean simply importing receiptIngestService.js -- even for a
// request that fails validation before persistence is ever attempted --
// pays Mongoose's full module-load cost. Deferring it to first actual use
// means that cost is paid only by a request that genuinely reaches
// storage.
const BUCKET_NAME = "receipts";

let mongooseRef = null;
function getMongoose() {
  if (!mongooseRef) {
    mongooseRef = require("mongoose");
  }
  return mongooseRef;
}

// OCR-004's own error convention (mirrors exportRequestService.js's plain
// `Error` + `.code` string shape, not a custom Error subclass -- nothing
// here is HTTP-aware, so there is no `.status` to carry the way
// ReceiptUploadError has one).
const ERROR_CODES = Object.freeze({
  // getReceiptObjectStream: the storageKey does not resolve to a real
  // GridFS file -- either it isn't a syntactically valid ObjectId at all,
  // or it is well-formed but nothing in the bucket has that id (already
  // deleted, or never existed). Both collapse to the same code for the
  // same reason exportRequestService's NOT_FOUND collapses "wrong owner"
  // and "doesn't exist": a caller asking to read a receipt has no
  // meaningful different action to take between the two.
  RECEIPT_OBJECT_NOT_FOUND: "RECEIPT_OBJECT_NOT_FOUND",
  // deleteReceiptObject only: a storageKey that is not even syntactically
  // a valid ObjectId. Unlike the not-found case above, this is never a
  // legitimate race (a real storageKey came from Receipt.storageKey, which
  // only ever holds a value this adapter itself generated) -- it means a
  // caller passed the wrong string, which is a programming error and
  // should throw loudly rather than be swallowed as a harmless no-op.
  RECEIPT_STORAGE_KEY_INVALID: "RECEIPT_STORAGE_KEY_INVALID",
  // No active Mongo connection to build a bucket from
  // (mongoose.connection.db is only populated once connected). Distinct
  // from RECEIPT_OBJECT_NOT_FOUND so a caller can tell "the store itself
  // is unreachable" apart from "the store is reachable but this key isn't
  // in it".
  RECEIPT_STORAGE_UNAVAILABLE: "RECEIPT_STORAGE_UNAVAILABLE",
  // putReceiptObject only: the caller did not pass a real, non-empty
  // Buffer to store. Also a programming error, not a race.
  RECEIPT_STORAGE_INVALID_INPUT: "RECEIPT_STORAGE_INVALID_INPUT",
});

function makeStorageError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Canonical 24-hex-char check, not just mongoose.Types.ObjectId.isValid()
// alone -- isValid() also accepts any bare 12-byte string as "valid",
// which would let a caller accidentally coerce an unrelated 12-character
// string into a fabricated ObjectId instead of failing the way a
// malformed key should. A real storageKey is always the hex string form
// GridFS itself generated (see putReceiptObject), so this is the only
// shape that should ever be accepted here.
const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/;

function isValidStorageKeyShape(storageKey) {
  return typeof storageKey === "string" && OBJECT_ID_HEX_PATTERN.test(storageKey);
}

function toObjectId(storageKey) {
  return new (getMongoose().Types.ObjectId)(storageKey);
}

// Lazily resolves a bucket handle from the current connection on every
// call rather than caching one at module load -- this module may be
// required before Mongoose ever connects (e.g. at server boot, or in a
// test that never connects at all), and a cached bucket built from a
// not-yet-connected `db` would stay broken even after a later successful
// connect.
function getBucket() {
  const mongoose = getMongoose();
  const db = mongoose.connection && mongoose.connection.db;
  if (!db) {
    throw makeStorageError(
      "receiptStorageAdapter: no active Mongo connection to store or read receipts.",
      ERROR_CODES.RECEIPT_STORAGE_UNAVAILABLE
    );
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: BUCKET_NAME });
}

// The mongodb driver throws/emits a plain Error with no distinct `.code`
// for "no such file" (`MongoRuntimeError: File not found for id <id>` from
// bucket.delete(); `FileNotFound: file <id> was not found` from an
// openDownloadStream read) -- there is nothing more specific to branch on
// than the message text itself.
function isDriverNotFoundError(err) {
  return Boolean(err && typeof err.message === "string" && /not found/i.test(err.message));
}

// Writes `buffer` into the "receipts" GridFS bucket and returns the new
// file's id (as a string) for callers to store as Receipt.storageKey.
async function putReceiptObject(buffer, { contentType, filename } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw makeStorageError("putReceiptObject: a non-empty Buffer is required.", ERROR_CODES.RECEIPT_STORAGE_INVALID_INPUT);
  }

  const bucket = getBucket();

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(
      filename || "receipt",
      contentType ? { contentType } : undefined
    );

    uploadStream.once("error", (err) => reject(err));
    uploadStream.once("finish", () => resolve({ storageKey: String(uploadStream.id) }));
    uploadStream.end(buffer);
  });
}

// Resolves `storageKey` to a readable stream of the file's raw bytes, for
// a caller (the download/detail API) to pipe into an HTTP response.
// Throws RECEIPT_OBJECT_NOT_FOUND synchronously (well, as a rejected
// promise -- this function is async) for either a malformed storageKey or
// a well-formed one with nothing behind it, rather than handing back a
// stream that would only fail later once someone starts reading it.
async function getReceiptObjectStream(storageKey) {
  if (!isValidStorageKeyShape(storageKey)) {
    throw makeStorageError(
      `getReceiptObjectStream: no receipt object for storageKey "${storageKey}".`,
      ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND
    );
  }

  const objectId = toObjectId(storageKey);
  const bucket = getBucket();

  // Checked up front (rather than just calling openDownloadStream and
  // waiting for its async 'error' event) so a missing file is reported the
  // same synchronous-looking way regardless of which not-found case it
  // is, and so a caller never receives a stream object that is doomed to
  // error on first read.
  const matches = await bucket.find({ _id: objectId }).toArray();
  if (!matches.length) {
    throw makeStorageError(
      `getReceiptObjectStream: no receipt object for storageKey "${storageKey}".`,
      ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND
    );
  }

  return bucket.openDownloadStream(objectId);
}

// Deletes the GridFS file behind `storageKey`. Idempotent by design --
// deleting an already-deleted (or never-existing but well-formed) key is a
// successful no-op, matching cron/staleDeviceCleanup.js's/
// cron/exportCleanup.js's "a missing target is success, not an error"
// posture for cleanup work, since a retry or a race with another delete
// must not be treated as a failure. A malformed key is the one exception:
// see RECEIPT_STORAGE_KEY_INVALID's comment above for why that still
// throws.
async function deleteReceiptObject(storageKey) {
  if (!isValidStorageKeyShape(storageKey)) {
    throw makeStorageError(
      `deleteReceiptObject: malformed storageKey "${storageKey}".`,
      ERROR_CODES.RECEIPT_STORAGE_KEY_INVALID
    );
  }

  const objectId = toObjectId(storageKey);
  const bucket = getBucket();

  try {
    await bucket.delete(objectId);
  } catch (err) {
    if (isDriverNotFoundError(err)) {
      return;
    }
    throw err;
  }
}

module.exports = {
  ERROR_CODES,
  putReceiptObject,
  getReceiptObjectStream,
  deleteReceiptObject,
};
