// REC-001-T07 -- genuine multi-process concurrency integration suite for
// backend/utils/jobLease.js, against a real Redis instance (TEST_REDIS_URL,
// wired via tests/setup/integrationEnv.js). jobLease.test.js only proves the
// module's logic branches with a mocked redisClient inside a single Node
// process/event loop -- including its "two concurrent acquisitions" case,
// which is really just two synchronous calls racing a JS closure flag, not
// two independent processes racing a real network round-trip to Redis. This
// suite forks two genuinely separate OS processes (tests/fixtures/
// jobLeaseWorker.js) that each open their own Redis connection and race for
// the same lease, to prove mutual exclusion and the atomic
// release-if-owner Lua script actually hold under real concurrency.
"use strict";

const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");
const { redisClient, connectRedis } = require("../config/redis");

const WORKER_PATH = path.join(__dirname, "fixtures", "jobLeaseWorker.js");

jest.setTimeout(20000);

beforeAll(async () => {
  await connectRedis();
});

afterAll(async () => {
  if (redisClient.isOpen) {
    await redisClient.quit().catch(() => {});
  }
});

function freshJobName(label) {
  return `it-joblease-${label}-${crypto.randomUUID()}`;
}

function spawnWorker(jobName, mode, ttlMs, extra) {
  const args = [jobName, mode, String(ttlMs)];
  if (extra !== undefined) {
    args.push(String(extra));
  }
  // env must be passed explicitly: Jest's test-environment sandbox gives
  // each test file its own `process.env` object, and child_process.fork()'s
  // *default* env argument is resolved against the real Node process's env
  // (not the sandboxed one) -- without this, the child silently loses
  // REDIS_URL (set by tests/setup/integrationEnv.js) and falls back to the
  // ordinary default Redis target instead of the test instance.
  const child = fork(WORKER_PATH, args, {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: process.env,
  });

  const messages = [];
  child.on("message", (msg) => messages.push(msg));

  const exited = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  // Surface anything the worker printed to stderr on the actual test
  // failure output, rather than a silent hang -- makes a real Redis
  // connectivity problem in this environment immediately diagnosable.
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    messages,
    exited,
    getStderr: () => stderr,
    async waitForPhase(phase, timeoutMs = 10000) {
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const found = messages.find((m) => m.phase === phase);
        if (found) return found;
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `Timed out waiting for phase "${phase}" from worker (jobName-scoped). ` +
              `Messages so far: ${JSON.stringify(messages)}. Stderr: ${stderr}`
          );
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("jobLease concurrency (real Redis, real separate OS processes)", () => {
  test("exactly one of two truly-simultaneous processes wins the same job lease and runs its body", async () => {
    const jobName = freshJobName("race");

    const w1 = spawnWorker(jobName, "run-with-lease", 5000, 100);
    const w2 = spawnWorker(jobName, "run-with-lease", 5000, 100);

    const [d1, d2] = await Promise.all([
      w1.waitForPhase("done"),
      w2.waitForPhase("done"),
    ]);
    await Promise.all([w1.exited, w2.exited]);

    const results = [d1.result, d2.result];
    const ranCount = results.filter((r) => r && r.ran === true).length;
    const skippedCount = results.filter((r) => r && r.ran === false).length;

    expect(ranCount).toBe(1);
    expect(skippedCount).toBe(1);
  });

  test("two processes with different job names never contend -- both acquire and run", async () => {
    const jobNameA = freshJobName("independent-a");
    const jobNameB = freshJobName("independent-b");

    const w1 = spawnWorker(jobNameA, "run-with-lease", 5000, 50);
    const w2 = spawnWorker(jobNameB, "run-with-lease", 5000, 50);

    const [d1, d2] = await Promise.all([
      w1.waitForPhase("done"),
      w2.waitForPhase("done"),
    ]);
    await Promise.all([w1.exited, w2.exited]);

    expect(d1.result).toEqual({ ran: true });
    expect(d2.result).toEqual({ ran: true });
  });

  test(
    "a slow worker's delayed release (past its own TTL) does not delete a " +
      "different process's lease that legitimately re-acquired the key " +
      "after real Redis TTL expiry",
    async () => {
      const jobName = freshJobName("stale-release");

      // W1: short TTL, but holds the "job" far longer than that TTL --
      // models a stuck/slow worker. It only calls releaseLease() after
      // holdMs, by which point Redis will have already expired its key on
      // its own.
      const w1 = spawnWorker(jobName, "hold-then-release", 300, 2000);
      const w1Acquire = await w1.waitForPhase("acquire-result");
      expect(w1Acquire.acquired).toBe(true);

      // Real wall-clock wait, comfortably past W1's 300ms TTL, so its lease
      // key has genuinely expired inside Redis before W2 ever starts.
      await sleep(700);

      // W2: a second, independent process/connection racing for the SAME
      // job name. Because W1's key already expired for real, W2 must be
      // able to acquire it -- this is the actual cross-process stale-lease
      // recovery path, not a simulated one.
      const w2 = spawnWorker(jobName, "hold-then-release", 5000, 2000);
      const w2Acquire = await w2.waitForPhase("acquire-result");
      expect(w2Acquire.acquired).toBe(true);
      expect(w2Acquire.owner).not.toBe(w1Acquire.owner);

      // W2 is still actively holding its lease at this point (holdMs=2000,
      // only just acquired). Confirm the real Redis key reflects W2's
      // ownership.
      const keyDuringW2Hold = await redisClient.get(`job-lease:${jobName}`);
      expect(keyDuringW2Hold).toBe(w2Acquire.owner);

      // W1 now finally gets around to releasing -- using its OLD owner
      // token, which no longer matches what's in Redis (W2 holds it now).
      // The release-if-owner Lua script must refuse to delete it.
      await w1.waitForPhase("released");
      await w1.exited;

      const keyAfterW1StaleRelease = await redisClient.get(`job-lease:${jobName}`);
      expect(keyAfterW1StaleRelease).toBe(w2Acquire.owner);

      // W2 finishes and releases its own (still-valid) lease -- the key
      // should now be gone, proving the earlier survival wasn't just an
      // unrelated TTL coincidence.
      await w2.waitForPhase("released");
      await w2.exited;

      const keyAfterW2RealRelease = await redisClient.get(`job-lease:${jobName}`);
      expect(keyAfterW2RealRelease).toBeNull();
    }
  );
});
