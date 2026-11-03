#!/usr/bin/env node
"use strict";

// CLI entry point for the migration driver. js).
const connectDB = require("../config/db");
const { connectRedis } = require("../config/redis");
const { runMigrations } = require("./driver");

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const allowNoBackupCheck = argv.includes("--allow-no-backup-check");
  const batchArg = argv.find((a) => a.startsWith("--batch="));
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : Infinity;
  return { dryRun, batchSize, allowNoBackupCheck };
}

function serializeResult(result) {
  return JSON.stringify(
    result,
    (key, value) => (key === "error" && value instanceof Error ? { message: value.message } : value),
    2
  );
}

async function main() {
  const { dryRun, batchSize, allowNoBackupCheck } = parseArgs(process.argv.slice(2));

  await connectDB();
  // Js's own startup connects both databases before anything that needs them runs.
  const redis = await connectRedis();

  let result;
  try {
    // Raised as a pre-flight refusal so it takes the same path, and prints the same "Migration run refused" prefix, as the environment gate -- both are "this run must not start", and they should not read like two different kinds of event to whoever is looking at the output.
    if (!redis.connected && !dryRun) {
      // Error` is absent when the connection TIMED OUT rather than failed -- which is the common case, since connect() against an absent Redis never settles at all.
      const cause = redis.timedOut
        ? `no response within the startup timeout`
        : `${(redis.error && (redis.error.message || redis.error.code)) || "unknown error"}`;
      throw new Error(
        "Redis is unreachable, so the migration lock cannot be acquired. Two concurrent " +
          "deploys could otherwise apply the same migration to the same database. " +
          `Cause: ${cause}`
      );
    }

    result = await runMigrations({ dryRun, batchSize, allowNoBackupCheck });
  } catch (err) {
    // The environment gate (and any other pre-flight rejection) throws
    // before runMigrations gets far enough to return a result object.
    console.error("Migration run refused:", err && err.message);
    process.exitCode = 1;
    return;
  }

  console.log(serializeResult(result));
  if (result.failed) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Migration run crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Close the process explicitly -- an open mongoose connection (and now an open Redis connection too) would otherwise keep this CLI invocation hanging after main() resolves.
    process.exit(process.exitCode || 0);
  });
