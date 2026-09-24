// OCR-004-T04 -- Controllers/Receipts/{list,detail,image,link,unlink,
// reviewed,delete}.js. Same fast controller-unit-test pattern as
// tests/exportControllers.test.js -- receiptQueryService (and, for
// image.js, receiptStorageAdapter) is mocked, so this file proves only
// the HTTP mapping (status codes, response shape, headers), not the
// business rules (already covered by receiptQueryService.test.js).
"use strict";

const SERVICE_PATH = "../Services/ReceiptServices/receiptQueryService";
const STORAGE_ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const VALID_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

const ERROR_CODES = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  EXPENSE_NOT_FOUND: "EXPENSE_NOT_FOUND",
  ALREADY_LINKED_TO_ANOTHER_EXPENSE: "ALREADY_LINKED_TO_ANOTHER_EXPENSE",
  INVALID_REVIEW_STATUS_FILTER: "INVALID_REVIEW_STATUS_FILTER",
  INVALID_CORRECTION: "INVALID_CORRECTION",
});

function makeError(code, message = "err") {
  const err = new Error(message);
  err.code = code;
  return err;
}

const makeReq = (overrides = {}) => ({ body: {}, params: {}, query: {}, userId: USER_ID, ...overrides });

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.setHeader = jest.fn();
  res.headersSent = false;
  return res;
};

const jsonBody = (res) => res.json.mock.calls[0][0];

function makeFakeStream({ errorOnRegister } = {}) {
  return {
    pipe: jest.fn((dest) => dest),
    on: jest.fn((event, cb) => {
      if (event === "error" && errorOnRegister) cb(new Error("stream broke"));
    }),
  };
}

function loadControllers(serviceMock = {}, adapterMock = {}) {
  jest.resetModules();
  // Same lightweight ObjectId fake exportControllers.test.js uses -- the
  // real `mongoose` package is measurably slow to require in this
  // sandbox.
  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) } },
  }));
  jest.doMock(SERVICE_PATH, () => ({
    listReceipts: jest.fn(),
    getReceiptDetail: jest.fn(),
    getReceiptImageRef: jest.fn(),
    linkReceiptToExpense: jest.fn(),
    unlinkReceiptFromExpense: jest.fn(),
    markReceiptReviewed: jest.fn(),
    deleteReceipt: jest.fn(),
    ERROR_CODES,
    ...serviceMock,
  }));
  jest.doMock(STORAGE_ADAPTER_PATH, () => ({
    getReceiptObjectStream: jest.fn(),
    deleteReceiptObject: jest.fn(),
    ...adapterMock,
  }));
  return {
    list: require("../Controllers/Receipts/list"),
    detail: require("../Controllers/Receipts/detail"),
    image: require("../Controllers/Receipts/image"),
    link: require("../Controllers/Receipts/link"),
    unlink: require("../Controllers/Receipts/unlink"),
    reviewed: require("../Controllers/Receipts/reviewed"),
    del: require("../Controllers/Receipts/delete"),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("listReceiptsController", () => {
  test("200s with the service's list", async () => {
    const data = [{ id: "r1", reviewStatus: "reviewed" }];
    const listReceipts = jest.fn().mockResolvedValue(data);
    const { list } = loadControllers({ listReceipts });
    const res = makeRes();

    await list.listReceiptsController(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: true, data }));
  });

  test("passes reviewStatus/linked query params through to the service", async () => {
    const listReceipts = jest.fn().mockResolvedValue([]);
    const { list } = loadControllers({ listReceipts });
    const res = makeRes();

    await list.listReceiptsController(makeReq({ query: { reviewStatus: "reviewed", linked: "true" } }), res);

    expect(listReceipts).toHaveBeenCalledWith({ userId: USER_ID, reviewStatus: "reviewed", linked: true });
  });

  test("linked=false parses to boolean false, not a falsy string", async () => {
    const listReceipts = jest.fn().mockResolvedValue([]);
    const { list } = loadControllers({ listReceipts });
    const res = makeRes();

    await list.listReceiptsController(makeReq({ query: { linked: "false" } }), res);

    expect(listReceipts).toHaveBeenCalledWith({ userId: USER_ID, reviewStatus: undefined, linked: false });
  });

  test("400s with errorCode INVALID_REVIEW_STATUS_FILTER when the service rejects the filter", async () => {
    const listReceipts = jest.fn().mockRejectedValue(makeError("INVALID_REVIEW_STATUS_FILTER"));
    const { list } = loadControllers({ listReceipts });
    const res = makeRes();

    await list.listReceiptsController(makeReq({ query: { reviewStatus: "bogus" } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("INVALID_REVIEW_STATUS_FILTER");
  });

  test("500s on an unexpected error", async () => {
    const listReceipts = jest.fn().mockRejectedValue(new Error("boom"));
    const { list } = loadControllers({ listReceipts });
    const res = makeRes();

    await list.listReceiptsController(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("getReceiptDetailController", () => {
  test("404s for a malformed id without calling the service", async () => {
    const getReceiptDetail = jest.fn();
    const { detail } = loadControllers({ getReceiptDetail });
    const res = makeRes();

    await detail.getReceiptDetailController(makeReq({ params: { id: "not-an-id" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getReceiptDetail).not.toHaveBeenCalled();
  });

  test("404s when the service reports NOT_FOUND", async () => {
    const getReceiptDetail = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { detail } = loadControllers({ getReceiptDetail });
    const res = makeRes();

    await detail.getReceiptDetailController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("200s with the receipt's safe shape on success", async () => {
    const data = { id: "r1", reviewStatus: "reviewed" };
    const getReceiptDetail = jest.fn().mockResolvedValue(data);
    const { detail } = loadControllers({ getReceiptDetail });
    const res = makeRes();

    await detail.getReceiptDetailController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });
});

describe("getReceiptImageController", () => {
  test("404s for a malformed id without calling the service", async () => {
    const getReceiptImageRef = jest.fn();
    const { image } = loadControllers({ getReceiptImageRef });
    const res = makeRes();

    await image.getReceiptImageController(makeReq({ params: { id: "not-an-id" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getReceiptImageRef).not.toHaveBeenCalled();
  });

  test("404s when the service reports NOT_FOUND (ownership or missing)", async () => {
    const getReceiptImageRef = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { image } = loadControllers({ getReceiptImageRef });
    const res = makeRes();

    await image.getReceiptImageController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(JSON.stringify(jsonBody(res))).not.toMatch(/storageKey|gridfs/i);
  });

  test("sets Content-Type from mimeType and pipes the adapter's stream to the response", async () => {
    const getReceiptImageRef = jest.fn().mockResolvedValue({ storageKey: "sk-secret-1", mimeType: "image/png" });
    const stream = makeFakeStream();
    const getReceiptObjectStream = jest.fn().mockResolvedValue(stream);
    const { image } = loadControllers({ getReceiptImageRef }, { getReceiptObjectStream });
    const res = makeRes();

    await image.getReceiptImageController(makeReq({ params: { id: VALID_ID } }), res);

    expect(getReceiptObjectStream).toHaveBeenCalledWith("sk-secret-1");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(stream.pipe).toHaveBeenCalledWith(res);
    // storageKey must never appear in any header call.
    for (const call of res.setHeader.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("sk-secret-1");
    }
    // Never a JSON error body on the success path.
    expect(res.json).not.toHaveBeenCalled();
  });

  test("404s (not 500) when the storage adapter can't open the blob", async () => {
    const getReceiptImageRef = jest.fn().mockResolvedValue({ storageKey: "sk-2", mimeType: "image/jpeg" });
    const getReceiptObjectStream = jest.fn().mockRejectedValue(new Error("GridFS file not found"));
    const { image } = loadControllers({ getReceiptImageRef }, { getReceiptObjectStream });
    const res = makeRes();

    await image.getReceiptImageController(makeReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(JSON.stringify(jsonBody(res))).not.toMatch(/sk-2|storageKey/i);
  });
});

describe("linkReceiptController", () => {
  test("400s with MISSING_FIELDS when expenseId is absent", async () => {
    const linkReceiptToExpense = jest.fn();
    const { link } = loadControllers({ linkReceiptToExpense });
    const res = makeRes();

    await link.linkReceiptController(makeReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("MISSING_FIELDS");
    expect(linkReceiptToExpense).not.toHaveBeenCalled();
  });

  test("404s for a malformed receipt id", async () => {
    const linkReceiptToExpense = jest.fn();
    const { link } = loadControllers({ linkReceiptToExpense });
    const res = makeRes();

    await link.linkReceiptController(
      makeReq({ params: { id: "not-an-id" }, body: { expenseId: VALID_ID } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(linkReceiptToExpense).not.toHaveBeenCalled();
  });

  test("200s with the linked receipt on success", async () => {
    const data = { id: "r1", linkedExpenseId: "e1" };
    const linkReceiptToExpense = jest.fn().mockResolvedValue(data);
    const { link } = loadControllers({ linkReceiptToExpense });
    const res = makeRes();

    await link.linkReceiptController(
      makeReq({ params: { id: VALID_ID }, body: { expenseId: "e1" } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });

  test.each([["EXPENSE_NOT_FOUND"], ["ALREADY_LINKED_TO_ANOTHER_EXPENSE"]])(
    "400s with errorCode %s",
    async (code) => {
      const linkReceiptToExpense = jest.fn().mockRejectedValue(makeError(code));
      const { link } = loadControllers({ linkReceiptToExpense });
      const res = makeRes();

      await link.linkReceiptController(
        makeReq({ params: { id: VALID_ID }, body: { expenseId: "e1" } }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(jsonBody(res).errorCode).toBe(code);
    }
  );

  test("404s when the receipt itself is not found/owned", async () => {
    const linkReceiptToExpense = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { link } = loadControllers({ linkReceiptToExpense });
    const res = makeRes();

    await link.linkReceiptController(
      makeReq({ params: { id: VALID_ID }, body: { expenseId: "e1" } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("unlinkReceiptController", () => {
  test("200s on success, including the idempotent already-unlinked case", async () => {
    const data = { id: "r1", linkedExpenseId: null };
    const unlinkReceiptFromExpense = jest.fn().mockResolvedValue(data);
    const { unlink } = loadControllers({ unlinkReceiptFromExpense });
    const res = makeRes();

    await unlink.unlinkReceiptController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });

  test("404s when not found/owned", async () => {
    const unlinkReceiptFromExpense = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { unlink } = loadControllers({ unlinkReceiptFromExpense });
    const res = makeRes();

    await unlink.unlinkReceiptController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("markReceiptReviewedController", () => {
  test("200s on success with corrections passed through", async () => {
    const data = { id: "r1", reviewStatus: "reviewed" };
    const markReceiptReviewed = jest.fn().mockResolvedValue(data);
    const { reviewed } = loadControllers({ markReceiptReviewed });
    const res = makeRes();

    await reviewed.markReceiptReviewedController(
      makeReq({ params: { id: VALID_ID }, body: { corrections: { expenseAmount: 10 } } }),
      res
    );

    expect(markReceiptReviewed).toHaveBeenCalledWith({
      userId: USER_ID,
      receiptId: VALID_ID,
      corrections: { expenseAmount: 10 },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("400s with errorCode INVALID_CORRECTION", async () => {
    const markReceiptReviewed = jest.fn().mockRejectedValue(makeError("INVALID_CORRECTION"));
    const { reviewed } = loadControllers({ markReceiptReviewed });
    const res = makeRes();

    await reviewed.markReceiptReviewedController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("INVALID_CORRECTION");
  });

  test("404s when not found/owned", async () => {
    const markReceiptReviewed = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { reviewed } = loadControllers({ markReceiptReviewed });
    const res = makeRes();

    await reviewed.markReceiptReviewedController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("deleteReceiptController", () => {
  test("200s on success", async () => {
    const data = { id: "r1" };
    const deleteReceipt = jest.fn().mockResolvedValue(data);
    const { del } = loadControllers({ deleteReceipt });
    const res = makeRes();

    await del.deleteReceiptController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });

  test("404s when not found/owned", async () => {
    const deleteReceipt = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { del } = loadControllers({ deleteReceipt });
    const res = makeRes();

    await del.deleteReceiptController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("404s for a malformed id without calling the service", async () => {
    const deleteReceipt = jest.fn();
    const { del } = loadControllers({ deleteReceipt });
    const res = makeRes();

    await del.deleteReceiptController(makeReq({ params: { id: "bad-id" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(deleteReceipt).not.toHaveBeenCalled();
  });
});
