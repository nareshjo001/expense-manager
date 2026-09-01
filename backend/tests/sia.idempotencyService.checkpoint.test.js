// Unit tests for backend/sia/idempotencyService.js's additive
"use strict";

const MODEL_PATH = "../models/SiaRequest";
const SERVICE_PATH = "../sia/idempotencyService";

const { REQUEST_STATUS } = jest.requireActual("../models/SiaRequest");

function loadService() {
  jest.resetModules();

  const requestDocs = {
    findOne: jest.fn(async () => null),
    create: jest.fn(async (attrs) => ({ _id: "req-1", ...attrs })),
    findOneAndUpdate: jest.fn(async () => null),
    deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
  };
  requestDocs.REQUEST_STATUS = REQUEST_STATUS;

  jest.doMock(MODEL_PATH, () => requestDocs);
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", timeoutMs: 8000 }));

  const service = require(SERVICE_PATH);
  return { service, requestDocs };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const SAMPLE_PLAN = {
  version: 1,
  outcome: "supported",
  metrics: ["EXPENSE_TOTAL"],
  operation: "LOOKUP",
  period: { type: "CURRENT_MONTH" },
  grouping: "NONE",
  responseMode: "DETERMINISTIC",
};

describe("sia/idempotencyService -- saveRoutingCheckpoint", () => {
  it("writes the plan checkpoint scoped to (id, ownerToken, status=processing) and renews the lease", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOneAndUpdate.mockResolvedValueOnce({
      _id: "req-1",
      ownerToken: "owner-1",
      status: REQUEST_STATUS.PROCESSING,
      planCheckpoint: SAMPLE_PLAN,
    });

    const result = await service.saveRoutingCheckpoint({
      requestId: "req-1",
      ownerToken: "owner-1",
      planCheckpoint: SAMPLE_PLAN,
    });

    expect(result.planCheckpoint).toEqual(SAMPLE_PLAN);
    const [filter, update] = requestDocs.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: "req-1", ownerToken: "owner-1", status: REQUEST_STATUS.PROCESSING });
    expect(update.$set.planCheckpoint).toEqual(SAMPLE_PLAN);
    expect(update.$set.processingExpiresAt).toBeInstanceOf(Date);
  });

  it("never writes a checkpoint for a request that is not owned/processing (CAS filter excludes it)", async () => {
    const { service, requestDocs } = loadService();
    requestDocs.findOneAndUpdate.mockResolvedValueOnce(null); // CAS filter didn't match

    const result = await service.saveRoutingCheckpoint({
      requestId: "req-1",
      ownerToken: "wrong-owner",
      planCheckpoint: SAMPLE_PLAN,
    });

    expect(result).toBeNull();
  });
});
