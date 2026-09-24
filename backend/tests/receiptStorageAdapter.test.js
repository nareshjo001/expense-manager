// OCR-004-T03 -- Services/ReceiptServices/receiptStorageAdapter.js.
//
// Exercised against a small in-memory fake GridFSBucket (openUploadStream/
// openDownloadStream/find/delete backed by a Map), the same fast
// no-real-Mongo pattern exportRequestService.test.js/
// exportGenerationService.test.js use for their models -- this module is
// the one place in the codebase that talks to GridFS directly, so the
// fake stands in for the mongodb driver's GridFSBucket class itself
// (mongoose.mongo.GridFSBucket) rather than for a Mongoose model.
// mongoose.Types.ObjectId is left real (jest.requireActual) so storageKeys
// this suite generates/parses behave exactly like production ones.
"use strict";

const { Readable, Writable } = require("stream");

const ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";

const actualMongoose = jest.requireActual("mongoose");

function makeFakeGridFSBucketClass(store) {
  return class FakeGridFSBucket {
    constructor(_db, options) {
      this.bucketName = options && options.bucketName;
    }

    openUploadStream(filename, options) {
      const id = new actualMongoose.Types.ObjectId();
      const chunks = [];
      const stream = new Writable({
        write(chunk, _enc, cb) {
          chunks.push(chunk);
          cb();
        },
      });
      stream.id = id;
      // Registered before putReceiptObject's own 'finish' listener (it is
      // attached after this function returns), so the store is populated
      // before that listener reads anything back.
      stream.once("finish", () => {
        store.set(String(id), {
          buffer: Buffer.concat(chunks),
          contentType: options && options.contentType,
          filename,
        });
      });
      return stream;
    }

    find(filter) {
      const key = filter && filter._id ? String(filter._id) : null;
      return {
        toArray: async () => (key && store.has(key) ? [{ _id: filter._id }] : []),
      };
    }

    openDownloadStream(id) {
      const key = String(id);
      const entry = store.get(key);
      if (!entry) {
        const stream = new Readable({ read() {} });
        // Matches the real driver's own async 'error' event on a missing
        // file (see receiptStorageAdapter.js's isDriverNotFoundError
        // comment for the exact message shape it branches on).
        process.nextTick(() => stream.emit("error", new Error(`FileNotFound: file ${key} was not found`)));
        return stream;
      }
      return Readable.from(entry.buffer);
    }

    async delete(id) {
      const key = String(id);
      if (!store.has(key)) {
        throw new Error(`File not found for id ${key}`);
      }
      store.delete(key);
    }
  };
}

function loadAdapter({ connected = true } = {}) {
  jest.resetModules();
  const store = new Map();
  const FakeGridFSBucket = makeFakeGridFSBucketClass(store);

  jest.doMock("mongoose", () => ({
    Types: actualMongoose.Types,
    connection: { db: connected ? {} : undefined },
    mongo: { GridFSBucket: FakeGridFSBucket },
  }));

  const adapter = require(ADAPTER_PATH);
  return { adapter, store };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

afterEach(() => {
  jest.dontMock("mongoose");
  jest.resetModules();
});

describe("putReceiptObject / getReceiptObjectStream round trip", () => {
  test("a stored buffer reads back byte-for-byte with its storageKey", async () => {
    const { adapter } = loadAdapter();
    const original = Buffer.from("this is a fake receipt image payload");

    const { storageKey } = await adapter.putReceiptObject(original, {
      contentType: "image/png",
      filename: "receipt.png",
    });

    expect(typeof storageKey).toBe("string");
    expect(storageKey).toMatch(/^[0-9a-fA-F]{24}$/);

    const stream = await adapter.getReceiptObjectStream(storageKey);
    const readBack = await readAll(stream);
    expect(readBack.equals(original)).toBe(true);
  });

  test("rejects a non-Buffer/empty input with RECEIPT_STORAGE_INVALID_INPUT", async () => {
    const { adapter } = loadAdapter();
    await expect(adapter.putReceiptObject(Buffer.alloc(0))).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_STORAGE_INVALID_INPUT,
    });
    await expect(adapter.putReceiptObject("not a buffer")).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_STORAGE_INVALID_INPUT,
    });
  });
});

describe("getReceiptObjectStream not-found handling", () => {
  test("throws RECEIPT_OBJECT_NOT_FOUND for a malformed storageKey", async () => {
    const { adapter } = loadAdapter();
    await expect(adapter.getReceiptObjectStream("not-an-object-id")).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND,
    });
  });

  test("throws RECEIPT_OBJECT_NOT_FOUND for a well-formed id nothing backs", async () => {
    const { adapter } = loadAdapter();
    const neverStored = String(new actualMongoose.Types.ObjectId());
    await expect(adapter.getReceiptObjectStream(neverStored)).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND,
    });
  });
});

describe("deleteReceiptObject", () => {
  test("removes the file -- a subsequent read reports not-found", async () => {
    const { adapter } = loadAdapter();
    const { storageKey } = await adapter.putReceiptObject(Buffer.from("bytes"), {});

    await adapter.deleteReceiptObject(storageKey);

    await expect(adapter.getReceiptObjectStream(storageKey)).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_OBJECT_NOT_FOUND,
    });
  });

  test("is idempotent -- deleting the same key twice never throws on the second call", async () => {
    const { adapter } = loadAdapter();
    const { storageKey } = await adapter.putReceiptObject(Buffer.from("bytes"), {});

    await adapter.deleteReceiptObject(storageKey);
    await expect(adapter.deleteReceiptObject(storageKey)).resolves.toBeUndefined();
  });

  test("deleting a well-formed key that was never stored is also a no-op", async () => {
    const { adapter } = loadAdapter();
    const neverStored = String(new actualMongoose.Types.ObjectId());
    await expect(adapter.deleteReceiptObject(neverStored)).resolves.toBeUndefined();
  });

  test("throws RECEIPT_STORAGE_KEY_INVALID (not a silent no-op) for a malformed key", async () => {
    const { adapter } = loadAdapter();
    await expect(adapter.deleteReceiptObject("short")).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_STORAGE_KEY_INVALID,
    });
    await expect(adapter.deleteReceiptObject(undefined)).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_STORAGE_KEY_INVALID,
    });
  });
});

describe("no active Mongo connection", () => {
  test("putReceiptObject fails fast with RECEIPT_STORAGE_UNAVAILABLE", async () => {
    const { adapter } = loadAdapter({ connected: false });
    await expect(adapter.putReceiptObject(Buffer.from("bytes"))).rejects.toMatchObject({
      code: adapter.ERROR_CODES.RECEIPT_STORAGE_UNAVAILABLE,
    });
  });
});
