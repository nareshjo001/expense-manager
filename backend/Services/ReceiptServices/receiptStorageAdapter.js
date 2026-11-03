"use strict";

// Js's own header comment on why: the feature's Technical Design section treats any real object-store vendor -- S3, GCS, ...
const BUCKET_NAME = "receipts";

let mongooseRef = null;
function getMongoose() {
  if (!mongooseRef) {
    mongooseRef = require("mongoose");
  }
  return mongooseRef;
}

// Status` to carry the way ReceiptUploadError has one).
const ERROR_CODES = Object.freeze({
  // GetReceiptObjectStream: the storageKey does not resolve to a real GridFS file -- either it isn't a syntactically valid ObjectId at all, or it is well-formed but nothing in the bucket has that id (already deleted, or never existed).
  RECEIPT_OBJECT_NOT_FOUND: "RECEIPT_OBJECT_NOT_FOUND",
  // DeleteReceiptObject only: a storageKey that is not even syntactically a valid ObjectId.
  RECEIPT_STORAGE_KEY_INVALID: "RECEIPT_STORAGE_KEY_INVALID",
  // Db is only populated once connected).
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

// IsValid() alone -- isValid() also accepts any bare 12-byte string as "valid", which would let a caller accidentally coerce an unrelated 12-character string into a fabricated ObjectId instead of failing the way a malformed key should.
const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/;

function isValidStorageKeyShape(storageKey) {
  return typeof storageKey === "string" && OBJECT_ID_HEX_PATTERN.test(storageKey);
}

function toObjectId(storageKey) {
  return new (getMongoose().Types.ObjectId)(storageKey);
}

// G. at server boot, or in a test that never connects at all), and a cached bucket built from a not-yet-connected `db` would stay broken even.
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

// Delete(); `FileNotFound: file <id> was not found` from an openDownloadStream read) -- there is nothing more specific to branch on than the message text itself.
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

// Resolves `storageKey` to a readable stream of the file's raw bytes, for a caller (the download/detail API) to pipe into an HTTP response.
async function getReceiptObjectStream(storageKey) {
  if (!isValidStorageKeyShape(storageKey)) {
    throw makeStorageError(
      `getReceiptObjectStream: no receipt object for storageKey "${storageKey}".`,
      ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND
    );
  }

  const objectId = toObjectId(storageKey);
  const bucket = getBucket();

  // Checked up front (rather than just calling openDownloadStream and waiting for its async 'error' event) so a missing file is reported the same synchronous-looking way regardless of which not-found case it is, and so a caller never receives a stream object that is doomed to error on first read.
  const matches = await bucket.find({ _id: objectId }).toArray();
  if (!matches.length) {
    throw makeStorageError(
      `getReceiptObjectStream: no receipt object for storageKey "${storageKey}".`,
      ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND
    );
  }

  return bucket.openDownloadStream(objectId);
}

// Deletes the GridFS file behind `storageKey`.
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
