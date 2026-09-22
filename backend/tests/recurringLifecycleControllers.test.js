// REC-002-T02/T04 -- Controllers/RecurringExpenses/lifecycle.js:
// pause/resume/end/edit. Same fast controller-unit-test pattern as
// recurringList.test.js -- see that file's header for why (this sandbox's
// `require("../app")` cost, measured directly at 70s+).
"use strict";

const SERVICE_PATH = "../Services/RecurringServices/recurringLifecycleService";

const makeReq = (body = {}, params = {}, userId = "64f1a2b3c4d5e6f7a8b9c0aa") => ({
  body,
  params,
  userId,
});

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
  jest.doMock(SERVICE_PATH, () => ({
    pauseDefinition: jest.fn(),
    resumeDefinition: jest.fn(),
    endDefinition: jest.fn(),
    editDefinition: jest.fn(),
    ...serviceMock,
  }));
  return require("../Controllers/RecurringExpenses/lifecycle");
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Shared behavior across pause/resume/end -- parameterized so all three
// simple actions get identical coverage without three copy-pasted describe
// blocks silently drifting apart.
describe.each([
  ["pauseRecurring", "pauseDefinition", "Recurring expense paused"],
  ["resumeRecurring", "resumeDefinition", "Recurring expense resumed"],
  ["endRecurring", "endDefinition", "Recurring expense ended"],
])("%s", (controllerExport, serviceMethod, successMessage) => {
  test("returns 400 for a malformed id, without calling the service", async () => {
    const serviceFn = jest.fn();
    const controller = loadController({ [serviceMethod]: serviceFn })[controllerExport];

    const res = makeRes();
    await controller(makeReq({ scheduleVersion: 0 }, { id: "not-an-object-id" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(serviceFn).not.toHaveBeenCalled();
  });

  test.each([
    ["missing", {}],
    ["a string", { scheduleVersion: "0" }],
    ["negative", { scheduleVersion: -1 }],
    ["non-integer", { scheduleVersion: 1.5 }],
  ])("returns 400 for scheduleVersion that is %s, without calling the service", async (_label, body) => {
    const serviceFn = jest.fn();
    const controller = loadController({ [serviceMethod]: serviceFn })[controllerExport];

    const res = makeRes();
    await controller(makeReq(body, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).errorCode).toBe("INVALID_SCHEDULE_VERSION");
    expect(serviceFn).not.toHaveBeenCalled();
  });

  test("calls the service with userId, id, scheduleVersion and returns 200 on success", async () => {
    const serviceFn = jest.fn().mockResolvedValue({ ok: true, definition: { id: VALID_ID, status: "x" } });
    const controller = loadController({ [serviceMethod]: serviceFn })[controllerExport];

    const req = makeReq({ scheduleVersion: 3 }, { id: VALID_ID });
    const res = makeRes();
    await controller(req, res);

    expect(serviceFn).toHaveBeenCalledWith(req.userId, VALID_ID, 3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual({
      message: successMessage,
      success: true,
      data: { id: VALID_ID, status: "x" },
    });
  });

  test("maps not_found to 404", async () => {
    const serviceFn = jest.fn().mockResolvedValue({ ok: false, reason: "not_found" });
    const controller = loadController({ [serviceMethod]: serviceFn })[controllerExport];

    const res = makeRes();
    await controller(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("maps version_conflict to 409 and includes the current definition", async () => {
    const serviceFn = jest
      .fn()
      .mockResolvedValue({ ok: false, reason: "version_conflict", current: { id: VALID_ID, scheduleVersion: 9 } });
    const controller = loadController({ [serviceMethod]: serviceFn })[controllerExport];

    const res = makeRes();
    await controller(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = responseBody(res);
    expect(body.errorCode).toBe("SCHEDULE_VERSION_CONFLICT");
    expect(body.data).toEqual({ id: VALID_ID, scheduleVersion: 9 });
  });

  test("returns 500 with no raw error detail when the service throws", async () => {
    const serviceFn = jest.fn().mockRejectedValue(new Error("db exploded"));
    const controller = loadController({ [serviceMethod]: serviceFn })[controllerExport];

    const res = makeRes();
    await controller(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(responseBody(res))).not.toMatch(/db exploded/);
  });
});

describe("pauseRecurring / resumeRecurring / endRecurring -- reason-specific mappings", () => {
  test("pause maps already_paused to 409 ALREADY_PAUSED", async () => {
    const pauseDefinition = jest.fn().mockResolvedValue({ ok: false, reason: "already_paused" });
    const { pauseRecurring } = loadController({ pauseDefinition });

    const res = makeRes();
    await pauseRecurring(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(responseBody(res).errorCode).toBe("ALREADY_PAUSED");
  });

  test("resume maps already_active to 409 ALREADY_ACTIVE", async () => {
    const resumeDefinition = jest.fn().mockResolvedValue({ ok: false, reason: "already_active" });
    const { resumeRecurring } = loadController({ resumeDefinition });

    const res = makeRes();
    await resumeRecurring(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(responseBody(res).errorCode).toBe("ALREADY_ACTIVE");
  });

  test("any of pause/resume/end maps already_ended to 409 ALREADY_ENDED", async () => {
    const endDefinition = jest.fn().mockResolvedValue({ ok: false, reason: "already_ended" });
    const { endRecurring } = loadController({ endDefinition });

    const res = makeRes();
    await endRecurring(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(responseBody(res).errorCode).toBe("ALREADY_ENDED");
  });
});

describe("editRecurring", () => {
  test("returns 400 for a malformed id, without calling the service", async () => {
    const editDefinition = jest.fn();
    const { editRecurring } = loadController({ editDefinition });

    const res = makeRes();
    await editRecurring(makeReq({ scheduleVersion: 0, expenseName: "x" }, { id: "bad-id" }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(editDefinition).not.toHaveBeenCalled();
  });

  test("returns 400 for an invalid scheduleVersion, without calling the service", async () => {
    const editDefinition = jest.fn();
    const { editRecurring } = loadController({ editDefinition });

    const res = makeRes();
    await editRecurring(makeReq({ expenseName: "x" }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(editDefinition).not.toHaveBeenCalled();
  });

  test("passes the body (minus scheduleVersion) and scheduleVersion to the service", async () => {
    const editDefinition = jest
      .fn()
      .mockResolvedValue({ ok: true, definition: { id: VALID_ID, expenseName: "New" } });
    const { editRecurring } = loadController({ editDefinition });

    const req = makeReq({ scheduleVersion: 2, expenseName: "New", expenseAmount: 500 }, { id: VALID_ID });
    const res = makeRes();
    await editRecurring(req, res);

    expect(editDefinition).toHaveBeenCalledWith(
      req.userId,
      VALID_ID,
      { expenseName: "New", expenseAmount: 500 },
      2
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(responseBody(res)).toEqual({
      message: "Recurring expense updated",
      success: true,
      data: { id: VALID_ID, expenseName: "New" },
    });
  });

  test("maps invalid_amount to 400 INVALID_AMOUNT", async () => {
    const editDefinition = jest.fn().mockResolvedValue({ ok: false, reason: "invalid_amount" });
    const { editRecurring } = loadController({ editDefinition });

    const res = makeRes();
    await editRecurring(makeReq({ scheduleVersion: 0, expenseAmount: -5 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).errorCode).toBe("INVALID_AMOUNT");
  });

  test("maps no_fields_provided to 400", async () => {
    const editDefinition = jest.fn().mockResolvedValue({ ok: false, reason: "no_fields_provided" });
    const { editRecurring } = loadController({ editDefinition });

    const res = makeRes();
    await editRecurring(makeReq({ scheduleVersion: 0 }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).errorCode).toBe("NO_FIELDS_PROVIDED");
  });

  test("returns 500 with no raw error detail when the service throws", async () => {
    const editDefinition = jest.fn().mockRejectedValue(new Error("db exploded"));
    const { editRecurring } = loadController({ editDefinition });

    const res = makeRes();
    await editRecurring(makeReq({ scheduleVersion: 0, expenseName: "x" }, { id: VALID_ID }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(responseBody(res))).not.toMatch(/db exploded/);
  });
});
