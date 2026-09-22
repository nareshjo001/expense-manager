// REC-002-T02 -- Controllers/RecurringExpenses/list.js: GET /api/recurring
// and GET /api/recurring/:id.
//
// Follows the controller-unit-test pattern already established in
// tests/accountDeletion.test.js/tests/auth.recoverySecurity.test.js (fake
// req/res, jest.doMock the layer underneath, call the controller function
// directly) rather than a full supertest app -- and for this specific
// controller family that choice is also load-bearing, not just style: this
// sandbox's `require("../app")` currently takes 70s+ just to finish loading
// (measured directly), which is why the actual state-transition/validation
// logic lives in, and is exhaustively tested by,
// recurringLifecycleService.test.js instead -- this file only proves the
// thin HTTP mapping on top of it.
"use strict";

const SERVICE_PATH = "../Services/RecurringServices/recurringLifecycleService";

const makeReq = (params = {}, userId = "64f1a2b3c4d5e6f7a8b9c0aa") => ({ params, userId });

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const responseBody = (res) => res.json.mock.calls[0][0];

const VALID_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

function loadController(serviceMock) {
  jest.resetModules();
  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) } },
  }));
  jest.doMock(SERVICE_PATH, () => serviceMock);
  return require("../Controllers/RecurringExpenses/list");
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("listRecurring", () => {
  test("returns 200 with the service's list, scoped to req.userId", async () => {
    const listDefinitions = jest.fn().mockResolvedValue([{ id: "rec1" }]);
    const { listRecurring } = loadController({ listDefinitions, getDefinition: jest.fn() });

    const req = makeReq();
    const res = makeRes();
    await listRecurring(req, res);

    expect(listDefinitions).toHaveBeenCalledWith(req.userId);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual({ message: "Success", success: true, data: [{ id: "rec1" }] });
  });

  test("returns 500 with no raw error detail when the service throws", async () => {
    const listDefinitions = jest.fn().mockRejectedValue(new Error("db exploded"));
    const { listRecurring } = loadController({ listDefinitions, getDefinition: jest.fn() });

    const res = makeRes();
    await listRecurring(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(responseBody(res))).not.toMatch(/db exploded/);
  });
});

describe("getRecurringDetail", () => {
  test("returns 400 for a malformed id, without calling the service", async () => {
    const getDefinition = jest.fn();
    const { getRecurringDetail } = loadController({ listDefinitions: jest.fn(), getDefinition });

    const res = makeRes();
    await getRecurringDetail(makeReq({ id: "not-an-object-id" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getDefinition).not.toHaveBeenCalled();
  });

  test("returns 404 when the service finds nothing (nonexistent or not owned)", async () => {
    const getDefinition = jest.fn().mockResolvedValue(null);
    const { getRecurringDetail } = loadController({ listDefinitions: jest.fn(), getDefinition });

    const res = makeRes();
    await getRecurringDetail(makeReq({ id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(responseBody(res).success).toBe(false);
  });

  test("returns 200 with the definition on success", async () => {
    const getDefinition = jest.fn().mockResolvedValue({ id: VALID_ID, status: "active" });
    const { getRecurringDetail } = loadController({ listDefinitions: jest.fn(), getDefinition });

    const req = makeReq({ id: VALID_ID });
    const res = makeRes();
    await getRecurringDetail(req, res);

    expect(getDefinition).toHaveBeenCalledWith(req.userId, VALID_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res).data).toEqual({ id: VALID_ID, status: "active" });
  });
});
