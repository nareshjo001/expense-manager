// REC-001-T07 -- real OS-process worker for the job-lease concurrency
// integration suite. Forked by jobLease.concurrency.itest.js so that lease
// acquisition genuinely races across separate Node processes/connections
// against a real Redis instance, instead of the single-process/mocked
// concurrency simulated by jobLease.test.js.
"use strict";

const { runWithLease, acquireLease, releaseLease } = require("../../utils/jobLease");
const { redisClient } = require("../../config/redis");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const [, , jobName, mode, ttlMsRaw, extraRaw] = process.argv;
  const ttlMs = Number(ttlMsRaw);

  await redisClient.connect();

  try {
    if (mode === "run-with-lease") {
      const workMs = Number(extraRaw) || 0;
      const result = await runWithLease(jobName, ttlMs, async () => {
        if (workMs > 0) {
          await sleep(workMs);
        }
      });
      process.send({ phase: "done", result });
      return;
    }

    if (mode === "hold-then-release") {
      const holdMs = Number(extraRaw) || 0;
      const owner = await acquireLease(jobName, ttlMs);
      process.send({ phase: "acquire-result", acquired: owner !== null, owner });

      if (owner !== null) {
        await sleep(holdMs);
        await releaseLease(jobName, owner);
        process.send({ phase: "released" });
      } else {
        process.send({ phase: "released", skipped: true });
      }
      return;
    }

    process.send({ phase: "error", error: `Unknown mode: ${mode}` });
  } catch (err) {
    process.send({ phase: "error", error: (err && err.message) || String(err) });
  } finally {
    await redisClient.quit().catch(() => {});
  }
}

main();
