#!/usr/bin/env node
"use strict";

// DAT-003-T04 -- CLI entry point for the migration driver.
//
// Usage:
//   node backend/migrations/run.js [--dry-run] [--batch=N] [--allow-no-backup-check]
//
// --dry-run                 Compute and log what would change; no writes,
//                            no lock, no ledger record (driver.js).
// --batch=N                 Apply at most N pending migrations this run,
//                            leaving the rest for the next invocation.
// --allow-no-backup-check   Bypasses the environment safety gate's backup
//                            check (environmentGate.js). Only for an
//                            isolated/ephemeral database (CI, local dev)
//                            with nothing to lose -- never pass this
//                            against a real deployment target.
//
// Exits non-zero on any migration failure or on the safety gate refusing
// to run, so CI/deploy scripts can gate on this command's exit code
// directly.
const connectDB = require("../config/db");
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

  let result;
  try {
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
    // Close the process explicitly -- an open mongoose connection would
    // otherwise keep this CLI invocation hanging after main() resolves.
    process.exit(process.exitCode || 0);
  });
