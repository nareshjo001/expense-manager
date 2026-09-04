// TST-001-T06 -- genuine two-OS-process concurrency integration suite for
// the REAL recurring-expense cron job (cron/recurringJob.js), against a
// real MongoDB and a real Redis instance.
//
// What this closes: tests/recurringJob.reservationOwnership.test.js and
// tests/recurringJob.crashGapRecovery.test.js already prove the job's
// reservation/replay/crash-gap logic in exhaustive detail -- but entirely
// within ONE Node process, against FULLY MOCKED models, with
// utils/jobLease.js's real Redis-backed lease explicitly bypassed
// (`jest.doMock("../utils/jobLease", ...)` in both files). They prove the
// job's LOGIC is correct; they cannot prove it stays correct when two
// real, independent server instances actually race for the same due
// recurring expense over the network. tests/jobLease.concurrency.itest.js
// proves the generic job-lease PRIMITIVE holds under real multi-process
// concurrency -- but never touches cron/recurringJob.js, RecurringExpense,
// or Expense at all, so it can't prove the recurring job's own, documented
// backstop (utils/jobLease.js: "financial correctness for recurringJob.js
// does not depend on this lease at all, it already has its own
// occurrence-ID uniqueness constraint as the real backstop") actually
// holds for real, against a real Mongo unique index.
//
// This suite forks two genuinely separate OS processes
// (tests/fixtures/recurringJobWorker.js), each with its own Mongo
// connection and its own Redis connection, that race to process the SAME
// due RecurringExpense document -- and asserts the property that actually
// matters financially: however the two processes interleave, EXACTLY ONE
// Expense document ever exists for that occurrence afterward. Not "one
// worker won an abstract lease" -- an actual row count, queried from the
// real database after both processes have exited.
"use strict";

const crypto = require("crypto");
const path = require("path");
const { fork } = require("child_process");
const mongoose = require("mongoose");

const testServices = require("./setup/testServices");
const { ExpenseModel } = require("../config/Schemas");
const { RecurringExpenseModel } = require("../models/RecurringExpense");
const PendingSync = require("../models/PendingSync");
const Notification = require("../models/Notification");
const { redisClient } = require("../config/redis");
const { getRealRecurringJobName } = require("./fixtures/recurringJobName");

const WORKER_PATH = path.join(__dirname, "fixtures", "recurringJobWorker.js");

// Real jobs use LEASE_KEY_PREFIX ("job-lease:", from utils/jobLease.js,
// not exported) + the real JOB_NAME. tests/jobLease.concurrency.itest.js
// already establishes the convention of hardcoding the prefix here to
// match; JOB_NAME itself is read out of the real source (see
// recurringJobName.js) rather than duplicated as a second literal.
const JOB_NAME = getRealRecurringJobName();
const LEASE_KEY = `job-lease:${JOB_NAME}`;

jest.setTimeout(45000);

beforeAll(async () => {
  await testServices.connect();
  // Guarantee the real unique indexes (userId+id on ExpenseModel,
  // userId+expenseId on RecurringExpenseModel) are actually built before
  // any test races against them -- mongoose's default autoIndex builds
  // indexes asynchronously in the background after connect() resolves.
  await Promise.all([ExpenseModel.init(), RecurringExpenseModel.init()]);
});

afterAll(async () => {
  await testServices.disconnect();
});

function occurrenceIdFor(recurringId, nextDueDate) {
  return crypto.createHash("sha256").update(`${recurringId}:${nextDueDate.toISOString()}`).digest("hex");
}

// Seeds one due RecurringExpense document (nextDueDate safely in the past
// regardless of how long forking/connecting the workers takes) for a
// fresh, never-seen-before user, and returns everything a test needs to
// race against and then verify.
async function seedDueRecurring(overrides = {}) {
  const userId = new mongoose.Types.ObjectId();
  const nextDueDate = new Date(Date.now() - 60 * 1000);

  const recurring = await RecurringExpenseModel.create({
    userId,
    expenseId: new mongoose.Types.ObjectId(),
    expenseName: "TST-001-T06 Two-Worker Race",
    expenseCategory: "Subscriptions",
    expenseAmount: 999,
    lastLoggedDate: new Date(nextDueDate.getTime() - 30 * 24 * 60 * 60 * 1000),
    nextDueDate,
    ...overrides,
  });

  const occurrenceId = occurrenceIdFor(recurring._id, nextDueDate);

  return { userId, recurring, nextDueDate, occurrenceId };
}

async function cleanupUser(userId) {
  await Promise.all([
    RecurringExpenseModel.deleteMany({ userId }),
    ExpenseModel.deleteMany({ userId }),
    PendingSync.deleteMany({ user: userId }),
    Notification.deleteMany({ userId }),
  ]);
}

function spawnWorker(mode, extraArgs = []) {
  const args = [mode, ...extraArgs.map(String)];
  // env must be passed explicitly: Jest's test-environment sandbox gives
  // each test file its own `process.env` object, and child_process.fork()'s
  // *default* env argument is resolved against the real Node process's env
  // (not the sandboxed one) -- without this, the child silently loses
  // MONGO_CONN/REDIS_URL (set by tests/setup/integrationEnv.js) and falls
  // back to the ordinary default targets instead of the test instances.
  // (Same requirement, same fix, as tests/jobLease.concurrency.itest.js.)
  const child = fork(WORKER_PATH, args, {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: process.env,
  });

  const messages = [];
  child.on("message", (msg) => messages.push(msg));

  const exited = new Promise((resolve) => {
    child.on("exit", (code) => resolve(code));
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  return {
    child,
    messages,
    exited,
    getStderr: () => stderr,
    sendGo() {
      child.send({ type: "go" });
    },
    async waitForPhase(phase, timeoutMs = 15000) {
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const found = messages.find((m) => m.phase === phase);
        if (found) return found;
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `Timed out waiting for phase "${phase}" from recurring-job worker. ` +
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

describe("recurringJob two-worker concurrency (real Mongo + real Redis, real separate OS processes)", () => {
  let activeUserId = null;

  afterEach(async () => {
    if (activeUserId) {
      await cleanupUser(activeUserId);
      activeUserId = null;
    }
    // Defensive: clear a real lease key a failed test might have left
    // behind, so it can never bleed into the next test.
    await redisClient.del(LEASE_KEY).catch(() => {});
  });

  test(
    "two truly-simultaneous real worker processes race the SAME due " +
      "recurring expense: exactly one materializes it, the other's job " +
      "body never runs at all, and the database ends up with exactly one " +
      "resulting Expense document",
    async () => {
      const { userId, recurring, occurrenceId } = await seedDueRecurring();
      activeUserId = userId;

      const w1 = spawnWorker("run-job");
      const w2 = spawnWorker("run-job");

      await Promise.all([w1.waitForPhase("ready"), w2.waitForPhase("ready")]);
      w1.sendGo();
      w2.sendGo();

      const [d1, d2] = await Promise.all([w1.waitForPhase("done"), w2.waitForPhase("done")]);
      await Promise.all([w1.exited, w2.exited]);

      const results = [d1.leaseResult, d2.leaseResult];
      const ranCount = results.filter((r) => r && r.ran === true).length;
      const skippedCount = results.filter((r) => r && r.ran === false).length;

      // The job-level lease (utils/jobLease.js, real Redis SET NX) is the
      // FIRST line of defense: exactly one process's job body ever runs;
      // the other's runWithLease() returns { ran: false } WITHOUT ever
      // calling runRecurringJob -- proven generically by
      // tests/jobLease.concurrency.itest.js, exercised here through the
      // real recurringJob.js module and its real hardcoded job name.
      expect(ranCount).toBe(1);
      expect(skippedCount).toBe(1);

      // The property that actually matters financially: regardless of
      // which mechanism provided the exclusion, the real database ends up
      // with exactly one Expense document for this occurrence -- an
      // actual row count, not an inference from which worker "won".
      const expenseDocs = await ExpenseModel.find({ userId, id: occurrenceId }).lean();
      expect(expenseDocs).toHaveLength(1);
      expect(expenseDocs[0].expenseAmount).toBe(recurring.expenseAmount);

      // The winner's run also actually completed the full job body (not
      // just the insert): the schedule advanced exactly once, and exactly
      // one notification was recorded -- not zero (job body never ran)
      // and not two (double-processed).
      const updatedRecurring = await RecurringExpenseModel.findById(recurring._id).lean();
      expect(updatedRecurring.nextDueDate.getTime()).toBeGreaterThan(recurring.nextDueDate.getTime());

      const notifications = await Notification.find({ userId }).lean();
      expect(notifications).toHaveLength(1);
    }
  );

  test(
    "a worker that crashes immediately after acquiring the real job lease " +
      "(never releases it) does not permanently block a second, genuinely " +
      "separate worker process -- once the lease's own Redis TTL really " +
      "expires, the second worker still completes the real job for real, " +
      "materializing the still-due recurring expense exactly once",
    async () => {
      const { userId, recurring, occurrenceId } = await seedDueRecurring();
      activeUserId = userId;

      // W1: acquires the REAL job-lease key with a short, real TTL, then
      // process.exit()s without releasing -- a genuinely separate process
      // that crashed mid-job, not a simulated one.
      const crashTtlMs = 300;
      const w1 = spawnWorker("acquire-and-crash", [crashTtlMs]);
      await w1.waitForPhase("ready");
      w1.sendGo();

      const acquireResult = await w1.waitForPhase("acquire-result");
      expect(acquireResult.acquired).toBe(true);
      await w1.exited; // confirms the "crash" (process actually terminated).

      // Real wall-clock wait, comfortably past W1's TTL (same 300ms/700ms
      // margin already proven reliable by
      // tests/jobLease.concurrency.itest.js's own stale-release test), so
      // the lease has genuinely expired inside Redis -- not simulated.
      await sleep(700);
      const keyAfterExpiry = await redisClient.get(LEASE_KEY);
      expect(keyAfterExpiry).toBeNull();

      // W2: a second, independent process/connection, running the REAL
      // recurring job. Because the crashed W1 never actually touched the
      // recurring expense or inserted anything, this is W2's first real
      // attempt at it -- exercising TTL-based cross-instance lease
      // recovery composed with a genuine Mongo write, a combination none
      // of the existing suites cover (jobLease.concurrency.itest.js never
      // touches recurringJob.js/Mongo; the mocked recurring-job tests
      // bypass the lease, and therefore its TTL, entirely).
      const w2 = spawnWorker("run-job");
      await w2.waitForPhase("ready");
      w2.sendGo();
      const d2 = await w2.waitForPhase("done");
      await w2.exited;

      expect(d2.leaseResult).toEqual({ ran: true });

      const expenseDocs = await ExpenseModel.find({ userId, id: occurrenceId }).lean();
      expect(expenseDocs).toHaveLength(1);

      const updatedRecurring = await RecurringExpenseModel.findById(recurring._id).lean();
      expect(updatedRecurring.nextDueDate.getTime()).toBeGreaterThan(recurring.nextDueDate.getTime());

      // W2 released its own (validly-held, non-crashed) lease normally on
      // completion -- the key is gone again, not just expired.
      const keyAfterW2 = await redisClient.get(LEASE_KEY);
      expect(keyAfterW2).toBeNull();
    }
  );
});
