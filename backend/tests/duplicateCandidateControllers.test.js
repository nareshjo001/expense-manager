// OCR-005-T04 -- Controllers/Receipts/{duplicates,duplicateDecision}.js.
// Same fast controller-unit-test pattern as tests/receiptControllers.test.js
// -- duplicateCandidateService is mocked, so this proves only the HTTP
// mapping (status codes, response shape), not the business rules (already
// covered by duplicateCandidateService.test.js).
"use strict";

const SERVICE_PATH = "../Services/ReceiptServices/duplicateCandidateService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const VALID_ID = "64f1a2b3c4d5e6f7a8b9c0cc";
const OTHER_VALID_ID = "64f1a2b3c4d5e6f7a8b9c0dd";

const ERROR_CODES = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  INVALID_DECISION: "INVALID_DECISION",
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
  return res;
};

const jsonBody = (res) => res.json.mock.calls[0][0];

function loadControllers(serviceMock = {}) {
  jest.resetModules();
  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) } },
  }));
  jest.doMock(SERVICE_PATH, () => ({
    findDuplicateCandidates: jest.fn(),
    recordDuplicateDecision: jest.fn(),
    ERROR_CODES,
    ...serviceMock,
  }));
  return {
    duplicates: require("../Controllers/Receipts/duplicates"),
    decision: require("../Controllers/Receipts/duplicateDecision"),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getReceiptDuplicatesController", () => {
  test("404s for a malformed id without calling the service", async () => {
    const findDuplicateCandidates = jest.fn();
    const { duplicates } = loadControllers({ findDuplicateCandidates });
    const res = makeRes();

    await duplicates.getReceiptDuplicatesController(makeReq({ params: { id: "not-an-id" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(findDuplicateCandidates).not.toHaveBeenCalled();
  });

  test("404s when the service reports NOT_FOUND", async () => {
    const findDuplicateCandidates = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { duplicates } = loadControllers({ findDuplicateCandidates });
    const res = makeRes();

    await duplicates.getReceiptDuplicatesController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("200s with an empty array when there are no candidates -- not an error", async () => {
    const findDuplicateCandidates = jest.fn().mockResolvedValue([]);
    const { duplicates } = loadControllers({ findDuplicateCandidates });
    const res = makeRes();

    await duplicates.getReceiptDuplicatesController(makeReq({ params: { id: VALID_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: true, data: [] }));
  });

  test("200s with the service's candidate list on success", async () => {
    const data = [{ receiptId: "r2", reasonCode: "EXACT_FILE_MATCH" }];
    const findDuplicateCandidates = jest.fn().mockResolvedValue(data);
    const { duplicates } = loadControllers({ findDuplicateCandidates });
    const res = makeRes();

    await duplicates.getReceiptDuplicatesController(makeReq({ params: { id: VALID_ID } }), res);

    expect(findDuplicateCandidates).toHaveBeenCalledWith({ userId: USER_ID, receiptId: VALID_ID });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });

  test("500s on an unexpected error", async () => {
    const findDuplicateCandidates = jest.fn().mockRejectedValue(new Error("boom"));
    const { duplicates } = loadControllers({ findDuplicateCandidates });
    const res = makeRes();

    await duplicates.getReceiptDuplicatesController(makeReq({ params: { id: VALID_ID } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("recordDuplicateDecisionController", () => {
  test("400s with MISSING_FIELDS when decision is absent", async () => {
    const recordDuplicateDecision = jest.fn();
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(makeReq({ params: { id: VALID_ID }, body: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("MISSING_FIELDS");
    expect(recordDuplicateDecision).not.toHaveBeenCalled();
  });

  test("404s for a malformed receipt id", async () => {
    const recordDuplicateDecision = jest.fn();
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(
      makeReq({ params: { id: "not-an-id" }, body: { decision: "confirmed_new" } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(recordDuplicateDecision).not.toHaveBeenCalled();
  });

  test("200s with the updated receipt on a confirmed_new decision", async () => {
    const data = { id: "r1", duplicateStatus: "confirmed_new" };
    const recordDuplicateDecision = jest.fn().mockResolvedValue(data);
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(
      makeReq({ params: { id: VALID_ID }, body: { decision: "confirmed_new" } }),
      res
    );

    expect(recordDuplicateDecision).toHaveBeenCalledWith({
      userId: USER_ID,
      receiptId: VALID_ID,
      decision: "confirmed_new",
      duplicateOfReceiptId: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });

  test("200s with the updated receipt on a linked_existing decision, passing duplicateOfReceiptId through", async () => {
    const data = { id: "r1", duplicateStatus: "linked_existing", duplicateOfReceiptId: OTHER_VALID_ID };
    const recordDuplicateDecision = jest.fn().mockResolvedValue(data);
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(
      makeReq({
        params: { id: VALID_ID },
        body: { decision: "linked_existing", duplicateOfReceiptId: OTHER_VALID_ID },
      }),
      res
    );

    expect(recordDuplicateDecision).toHaveBeenCalledWith({
      userId: USER_ID,
      receiptId: VALID_ID,
      decision: "linked_existing",
      duplicateOfReceiptId: OTHER_VALID_ID,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });

  test("400s with errorCode INVALID_DECISION for a bad decision value", async () => {
    const recordDuplicateDecision = jest.fn().mockRejectedValue(makeError("INVALID_DECISION"));
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(
      makeReq({ params: { id: VALID_ID }, body: { decision: "bogus" } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("INVALID_DECISION");
  });

  test("404s when the service reports NOT_FOUND (receipt or duplicateOfReceiptId)", async () => {
    const recordDuplicateDecision = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(
      makeReq({ params: { id: VALID_ID }, body: { decision: "linked_existing", duplicateOfReceiptId: OTHER_VALID_ID } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("500s on an unexpected error", async () => {
    const recordDuplicateDecision = jest.fn().mockRejectedValue(new Error("boom"));
    const { decision } = loadControllers({ recordDuplicateDecision });
    const res = makeRes();

    await decision.recordDuplicateDecisionController(
      makeReq({ params: { id: VALID_ID }, body: { decision: "confirmed_new" } }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
