// Remediation Workstream B -- income edit/delete report/cache
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EDIT_INCOME_PATH = "../Controllers/IncomeControllers/editIncome";
const DELETE_INCOME_PATH = "../Controllers/IncomeControllers/deleteIncome";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const INCOME_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadEditIncome({ updatedDoc }) {
  jest.resetModules();

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async (id) => ({ _id: id })) },
    IncomeModel: {
      findOneAndUpdate: jest.fn(async () => updatedDoc),
    },
  }));

  const synchronizeAfterMutationMock = jest.fn(async () => SYNCHRONIZED_RESULT);
  const reserveMock = jest.fn(async () => ({ reportReservation: { token: "report-token-1" } }));
  const abandonMock = jest.fn(async () => null);
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    reserve: reserveMock,
    abandon: abandonMock,
  }));

  const { editIncome } = require(EDIT_INCOME_PATH);
  return { editIncome, synchronizeAfterMutationMock, reserveMock, abandonMock };
}

function loadDeleteIncome({ deletedDoc }) {
  jest.resetModules();

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async (id) => ({ _id: id })) },
    IncomeModel: {
      findOneAndDelete: jest.fn(async () => deletedDoc),
    },
  }));

  const synchronizeAfterMutationMock = jest.fn(async () => SYNCHRONIZED_RESULT);
  const reserveMock = jest.fn(async () => ({ reportReservation: { token: "report-token-2" } }));
  const abandonMock = jest.fn(async () => null);
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    reserve: reserveMock,
    abandon: abandonMock,
  }));

  const { deleteIncome } = require(DELETE_INCOME_PATH);
  return { deleteIncome, synchronizeAfterMutationMock, reserveMock, abandonMock };
}

describe("Remediation Workstream B: editIncome report/cache synchronization", () => {
  it("10. a successful edit reserves before the write and refreshes the report after", async () => {
    const { editIncome, synchronizeAfterMutationMock, reserveMock } = loadEditIncome({
      updatedDoc: { _id: INCOME_ID, incomeAmount: 750 },
    });

    const req = { userId: USER_ID, body: { incomeId: INCOME_ID, newAmount: 750 } };
    const res = mockRes();

    await editIncome(req, res);

    expect(reserveMock).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, reserveReport: true }));
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, reportToken: "report-token-1" })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, derivedData: SYNCHRONIZED_RESULT })
    );
  });

  it("11. a not-found edit abandons the reservation and never calls synchronizeAfterMutation", async () => {
    const { editIncome, synchronizeAfterMutationMock, abandonMock } = loadEditIncome({
      updatedDoc: null,
    });

    const req = { userId: USER_ID, body: { incomeId: INCOME_ID, newAmount: 750 } };
    const res = mockRes();

    await editIncome(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
    expect(abandonMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, reportToken: "report-token-1" })
    );
  });

  it("15. edit remains user-isolated -- the update query is always scoped to req.userId", async () => {
    const { editIncome } = loadEditIncome({ updatedDoc: { _id: INCOME_ID, incomeAmount: 100 } });
    const { IncomeModel } = require(SCHEMAS_PATH);

    const req = { userId: USER_ID, body: { incomeId: INCOME_ID, newAmount: 100 } };
    const res = mockRes();
    await editIncome(req, res);

    expect(IncomeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: INCOME_ID, userId: USER_ID }),
      expect.anything(),
      expect.anything()
    );
  });
});

describe("Remediation Workstream B: deleteIncome report/cache synchronization", () => {
  it("12. a successful delete reserves before the write and refreshes the report after", async () => {
    const { deleteIncome, synchronizeAfterMutationMock, reserveMock } = loadDeleteIncome({
      deletedDoc: { _id: INCOME_ID },
    });

    const req = { userId: USER_ID, body: { deleteIncomeId: INCOME_ID } };
    const res = mockRes();

    await deleteIncome(req, res);

    expect(reserveMock).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID, reserveReport: true }));
    expect(synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, reportToken: "report-token-2" })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("13. a not-found delete abandons the reservation and never calls synchronizeAfterMutation", async () => {
    const { deleteIncome, synchronizeAfterMutationMock, abandonMock } = loadDeleteIncome({
      deletedDoc: null,
    });

    const req = { userId: USER_ID, body: { deleteIncomeId: INCOME_ID } };
    const res = mockRes();

    await deleteIncome(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
    expect(abandonMock).toHaveBeenCalled();
  });

  it("15b. delete remains user-isolated -- the delete query is always scoped to req.userId", async () => {
    const { deleteIncome } = loadDeleteIncome({ deletedDoc: { _id: INCOME_ID } });
    const { IncomeModel } = require(SCHEMAS_PATH);

    const req = { userId: USER_ID, body: { deleteIncomeId: INCOME_ID } };
    const res = mockRes();
    await deleteIncome(req, res);

    expect(IncomeModel.findOneAndDelete).toHaveBeenCalledWith(
      expect.objectContaining({ _id: INCOME_ID, userId: USER_ID })
    );
  });
});
