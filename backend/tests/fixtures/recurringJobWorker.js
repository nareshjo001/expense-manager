// TST-001-T06 -- real OS-process worker for the recurring-expense job's
// two-worker concurrency integration suite
// (tests/recurringJob.twoWorker.itest.js). Forked so the REAL
// cron/recurringJob.js module (real Redis-backed job lease from
// utils/jobLease.js, real Mongo occurrence-ID uniqueness constraint on
// ExpenseModel) genuinely races across separate OS processes/connections,
// instead of the single-process/fully-mocked-models race simulated by
// tests/recurringJob.reservationOwnership.test.js and
// tests/recurringJob.crashGapRecovery.test.js.
//
// Two modes, selected by argv[2]:
//   "run-job"           -- connects for real, captures node-cron's
//                           scheduled callback (recurringJob.js never
//                           exports it), waits for the parent's "go"
//                           message, then invokes the REAL callback --
//                           i.e. the real runWithLease(...runRecurringJob)
//                           call, completely unmodified.
//   "acquire-and-crash" -- squats directly on the SAME real job-lease
//                           Redis key (see recurringJobName.js) with a
//                           short, caller-supplied TTL, reports that it
//                           acquired it, then exits WITHOUT releasing --
//                           simulating a server instance that crashes
//                           mid-job, so the lease can only ever be
//                           reclaimed by real Redis TTL expiry, never a
//                           cooperative release.
"use strict";

const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const { redisClient } = require("../../config/redis");
const { getRealRecurringJobName } = require("./recurringJobName");

function waitForGo() {
  return new Promise((resolve) => {
    process.on("message", function handler(msg) {
      if (msg && msg.type === "go") {
        process.off("message", handler);
        resolve();
      }
    });
  });
}

async function runJobMode() {
  // Capture node-cron's scheduled callback the same way
  // tests/recurringJob.reservationOwnership.test.js and
  // tests/recurringJob.crashGapRecovery.test.js do via jest.doMock --
  // except this is a plain forked Node process (no Jest here), so the
  // equivalent trick is mutating node-cron's OWN cached exports object
  // before cron/recurringJob.js requires it: Node's require cache
  // resolves both requires to the very same module.exports object, so
  // patching `.schedule` here is visible to recurringJob.js's own
  // `cron.schedule(...)` call below. No real cron timer is ever started.
  const cron = require("node-cron");
  let capturedCallback = null;
  cron.schedule = (_expr, callback) => {
    capturedCallback = callback;
  };

  // recurringJob.js's scheduled callback awaits runWithLease(...) but
  // never returns or exposes its { ran } result -- production has no
  // reason to. This suite needs it, to assert the LOSING worker's job
  // body never ran at all rather than just inferring that from DB side
  // effects, so wrap the real runWithLease with a pass-through that also
  // stashes its result -- same monkey-patch trick as above, applied to
  // utils/jobLease.js's exports instead of node-cron's. The real
  // acquisition/execution logic underneath is completely untouched.
  const jobLeaseModule = require("../../utils/jobLease");
  const realRunWithLease = jobLeaseModule.runWithLease;
  let lastLeaseResult = null;
  jobLeaseModule.runWithLease = async (jobName, ttlMs, fn) => {
    const result = await realRunWithLease(jobName, ttlMs, fn);
    lastLeaseResult = result;
    return result;
  };

  // Now require the REAL job module. Nothing else about it is mocked --
  // real Mongo models, real syncRecoveryService, real push.service, real
  // occurrence-ID hashing.
  require("../../cron/recurringJob");

  if (typeof capturedCallback !== "function") {
    throw new Error(
      "recurringJobWorker: node-cron's schedule() was never called by cron/recurringJob.js -- module shape changed?"
    );
  }

  process.send({ phase: "ready" });
  await waitForGo();

  await capturedCallback();

  process.send({ phase: "done", leaseResult: lastLeaseResult });
}

async function acquireAndCrashMode(ttlMs) {
  const { acquireLease } = require("../../utils/jobLease");
  const jobName = getRealRecurringJobName();

  process.send({ phase: "ready" });
  await waitForGo();

  const owner = await acquireLease(jobName, ttlMs);

  // Flush the IPC message before "crashing": process.send() writes to an
  // async pipe, so exiting immediately afterwards can drop the message
  // before the parent ever reads it. The optional callback fires once the
  // write has actually been handed off.
  await new Promise((resolve) => {
    process.send({ phase: "acquire-result", acquired: owner !== null, owner }, resolve);
  });

  // Deliberately no releaseLease() call, no redisClient.quit(), no
  // mongoose.disconnect() -- this models a process that crashes right
  // after acquiring the lease. The lease's own Redis TTL (not a
  // cooperative release) is the only thing that can ever free it again.
  process.exit(0);
}

async function main() {
  const mode = process.argv[2];

  try {
    if (mode === "run-job") {
      await connectDB();
      await redisClient.connect();
      await runJobMode();
      await mongoose.disconnect().catch(() => {});
      await redisClient.quit().catch(() => {});
    } else if (mode === "acquire-and-crash") {
      await redisClient.connect();
      const ttlMs = Number(process.argv[3]);
      await acquireAndCrashMode(ttlMs); // never returns -- process.exit()s.
    } else {
      throw new Error(`recurringJobWorker: unknown mode "${mode}"`);
    }
  } catch (err) {
    try {
      process.send({ phase: "error", error: (err && err.message) || String(err) });
    } catch (_sendErr) {
      // IPC channel already gone -- nothing more we can do.
    }
    await mongoose.disconnect().catch(() => {});
    await redisClient.quit().catch(() => {});
    process.exitCode = 1;
  }
}

main();
