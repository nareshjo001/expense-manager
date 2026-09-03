// REC-001 -- backend/utils/jobLease.js: Redis-backed job-level lease.
"use strict";

const REDIS_CONFIG_PATH = "../config/redis";
const JOB_LEASE_PATH = "../utils/jobLease";

function loadJobLease({ setImpl, evalImpl } = {}) {
  jest.resetModules();

  const redisClient = {
    set: jest.fn(setImpl || (async () => "OK")),
    eval: jest.fn(evalImpl || (async () => 1)),
  };

  jest.doMock(REDIS_CONFIG_PATH, () => ({ redisClient }));

  const jobLease = require(JOB_LEASE_PATH);
  return { jobLease, redisClient };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("jobLease.runWithLease", () => {
  test("runs fn and releases the lease when acquisition succeeds", async () => {
    const { jobLease, redisClient } = loadJobLease({ setImpl: async () => "OK" });
    const fn = jest.fn(async () => "done");

    const result = await jobLease.runWithLease("test-job", 1000, fn);

    expect(result).toEqual({ ran: true });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redisClient.set).toHaveBeenCalledWith(
      "job-lease:test-job",
      expect.any(String),
      { NX: true, PX: 1000 }
    );
    expect(redisClient.eval).toHaveBeenCalledTimes(1);
  });

  test("skips fn entirely when another instance already holds the lease", async () => {
    const { jobLease } = loadJobLease({ setImpl: async () => null });
    const fn = jest.fn(async () => "done");

    const result = await jobLease.runWithLease("test-job", 1000, fn);

    expect(result).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
  });

  test("fails open (still runs fn) when Redis is unavailable", async () => {
    const { jobLease } = loadJobLease({
      setImpl: async () => {
        throw new Error("connection closed");
      },
    });
    const fn = jest.fn(async () => "done");

    const result = await jobLease.runWithLease("test-job", 1000, fn);

    expect(result).toEqual({ ran: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("does not attempt to release the lease when Redis was unavailable at acquire time", async () => {
    const { jobLease, redisClient } = loadJobLease({
      setImpl: async () => {
        throw new Error("connection closed");
      },
    });

    await jobLease.runWithLease("test-job", 1000, async () => {});

    expect(redisClient.eval).not.toHaveBeenCalled();
  });

  test("still releases the lease and reports failure when fn throws", async () => {
    const { jobLease, redisClient } = loadJobLease({ setImpl: async () => "OK" });
    const boom = new Error("job body failed");

    await expect(jobLease.runWithLease("test-job", 1000, async () => {
      throw boom;
    })).rejects.toThrow("job body failed");

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
  });

  test("two concurrent acquisitions for the same job name: only one wins", async () => {
    let held = false;
    const { jobLease } = loadJobLease({
      setImpl: async () => {
        if (held) return null;
        held = true;
        return "OK";
      },
    });

    const [first, second] = await Promise.all([
      jobLease.acquireLease("shared-job", 1000),
      jobLease.acquireLease("shared-job", 1000),
    ]);

    const winners = [first, second].filter((owner) => owner !== null);
    expect(winners).toHaveLength(1);
  });
});

describe("jobLease.releaseLease", () => {
  test("never throws even when the eval call itself fails", async () => {
    const { jobLease } = loadJobLease({
      evalImpl: async () => {
        throw new Error("redis down");
      },
    });

    await expect(jobLease.releaseLease("test-job", "some-owner")).resolves.toBeUndefined();
  });
});
