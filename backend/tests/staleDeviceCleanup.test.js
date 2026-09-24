// NOT-003-T06/T07 -- cron/staleDeviceCleanup.js's runStaleDeviceCleanup.
// node-cron's own schedule() is not exercised here (no real clock/interval
// -- matches this codebase's other cron tests, which test the JOB BODY
// directly, not node-cron itself).
"use strict";

const DEVICE_TOKEN_PATH = "../models/DeviceToken";

function loadJob({ deleteManyImpl } = {}) {
  jest.resetModules();
  jest.doMock("node-cron", () => ({ schedule: jest.fn() }));
  const deleteManyMock = jest.fn(deleteManyImpl || (async () => ({ deletedCount: 0 })));
  jest.doMock(DEVICE_TOKEN_PATH, () => ({ deleteMany: deleteManyMock }));
  const mod = require("../cron/staleDeviceCleanup");
  return { ...mod, deleteManyMock };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("runStaleDeviceCleanup", () => {
  test("deletes DeviceToken documents whose updatedAt is older than the configured cutoff", async () => {
    const { runStaleDeviceCleanup, deleteManyMock, STALE_AFTER_DAYS } = loadJob({
      deleteManyImpl: async () => ({ deletedCount: 3 }),
    });

    await runStaleDeviceCleanup();

    expect(deleteManyMock).toHaveBeenCalledTimes(1);
    const filter = deleteManyMock.mock.calls[0][0];
    expect(filter.updatedAt.$lt).toBeInstanceOf(Date);

    const expectedCutoff = Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
    // Allow a small tolerance for time elapsed between the cutoff being
    // computed inside the job and this assertion running.
    expect(Math.abs(filter.updatedAt.$lt.getTime() - expectedCutoff)).toBeLessThan(5000);
  });

  test("does not throw when the DB call fails", async () => {
    const { runStaleDeviceCleanup } = loadJob({
      deleteManyImpl: async () => { throw new Error("db down"); },
    });

    await expect(runStaleDeviceCleanup()).resolves.toBeUndefined();
  });
});
