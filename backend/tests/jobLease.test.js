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

  // REC-001-T03 -- this assertion is INVERTED from its original form, which
  // expected the job to run anyway whenever Redis was unreachable. That
  // default made a Redis outage cause every instance to execute the job at
  // once: precisely the duplicate execution this feature exists to prevent.
  // Failing open is now an explicit per-job opt-in, asserted below.
  test("fails CLOSED by default -- skips the run when Redis is unavailable", async () => {
    const { jobLease } = loadJobLease({
      setImpl: async () => {
        throw new Error("connection closed");
      },
    });
    const fn = jest.fn(async () => "done");

    const result = await jobLease.runWithLease("test-job", 1000, fn);

    expect(result).toEqual({ ran: false });
    expect(fn).not.toHaveBeenCalled();
  });

  test("fails open only when the job explicitly opts in", async () => {
    const { jobLease } = loadJobLease({
      setImpl: async () => {
        throw new Error("connection closed");
      },
    });
    const fn = jest.fn(async () => "done");

    const result = await jobLease.runWithLease("test-job", 1000, fn, { failOpen: true });

    expect(result).toEqual({ ran: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("passes a lease handle that reports the lease as held during a normal run", async () => {
    const { jobLease } = loadJobLease({ setImpl: async () => "OK" });
    let seen;
    await jobLease.runWithLease("test-job", 1000, async (lease) => {
      seen = lease.isHeld();
    });

    expect(seen).toBe(true);
  });
});

// REC-001-T03 -- renewal. Before this, the lease expired purely by TTL, so a
// job running longer than its TTL kept executing after losing exclusivity.
describe("jobLease.runWithLease -- renewal", () => {
  test("extends the TTL while fn is still running", async () => {
    jest.useFakeTimers();
    try {
      const { jobLease, redisClient } = loadJobLease({ setImpl: async () => "OK" });

      let release;
      const body = new Promise((resolve) => {
        release = resolve;
      });
      const run = jobLease.runWithLease("test-job", 3000, () => body);

      // TTL 3000 renews every 1000ms.
      await jest.advanceTimersByTimeAsync(2500);
      const renewCalls = redisClient.eval.mock.calls.filter((c) =>
        String(c[0]).includes("PEXPIRE")
      );
      expect(renewCalls.length).toBeGreaterThanOrEqual(2);

      release();
      await run;
    } finally {
      jest.useRealTimers();
    }
  });

  test("marks the lease lost, and stops renewing, when another owner holds it", async () => {
    jest.useFakeTimers();
    try {
      // eval returns 0 for the renew script -- i.e. we are no longer owner.
      const { jobLease } = loadJobLease({
        setImpl: async () => "OK",
        evalImpl: async () => 0,
      });

      const held = [];
      let release;
      const body = new Promise((resolve) => {
        release = resolve;
      });

      const run = jobLease.runWithLease("test-job", 3000, async (lease) => {
        held.push(lease.isHeld());
        await body;
        held.push(lease.isHeld());
      });

      await jest.advanceTimersByTimeAsync(1200);
      release();
      await run;

      expect(held[0]).toBe(true);
      // The renewal proved another instance owns the lease now.
      expect(held[1]).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a failed renewal is not treated as proof of loss", async () => {
    jest.useFakeTimers();
    try {
      const { jobLease } = loadJobLease({
        setImpl: async () => "OK",
        evalImpl: async () => {
          throw new Error("connection reset");
        },
      });

      let observed;
      let release;
      const body = new Promise((resolve) => {
        release = resolve;
      });

      const run = jobLease.runWithLease("test-job", 3000, async (lease) => {
        await body;
        observed = lease.isHeld();
      });

      await jest.advanceTimersByTimeAsync(1200);
      release();
      await run;

      // An unreachable Redis means "unknown", not "lost" -- the lease may
      // still be held. Declaring it lost here would stop legitimate work.
      expect(observed).toBe(true);
    } finally {
      jest.useRealTimers();
    }
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
