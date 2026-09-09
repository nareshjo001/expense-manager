#!/usr/bin/env node
/**
 * OPS-001-T06 -- ratchet for the backend lint gate.
 *
 * `npm run lint` fails on any ESLint *error*. That alone would let the
 * warning list grow without limit, which is how a "pragmatic" lint gate
 * quietly becomes a decorative one. This script adds the missing half: it
 * fails when the warning count rises above a frozen baseline, so warnings
 * can only ever shrink.
 *
 * Usage:
 *   node scripts/lintBaseline.js --run       lint, print a report, check the baseline
 *   node scripts/lintBaseline.js --run --update   ... and rewrite the baseline
 *   npx eslint . --format json | node scripts/lintBaseline.js   (report on stdin)
 *
 * --run drives ESLint through its Node API rather than a shell pipeline, so
 * the single `npm run lint:ci` command behaves identically on Windows and
 * Linux and cannot lose ESLint's exit code to a shell separator.
 *
 * To lower the baseline after cleaning warnings up, run with --update and
 * commit the change. Raising it requires the same deliberate edit, which is
 * the point: it should be an argued decision, not a side effect.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BASELINE_PATH = path.join(__dirname, "lint-baseline.json");

function readInput() {
  const fileArg = process.argv.find((arg) => arg.startsWith("--input="));
  if (fileArg) {
    return fs.readFileSync(fileArg.slice("--input=".length), "utf8");
  }
  return fs.readFileSync(0, "utf8");
}

// Runs ESLint over the whole package through its Node API and prints the
// human-readable report, so --run is a drop-in for `eslint .` plus the
// baseline check.
async function runEslint() {
  const { ESLint } = require("eslint");
  const eslint = new ESLint({ cwd: path.join(__dirname, "..") });
  const results = await eslint.lintFiles(["."]);
  const formatter = await eslint.loadFormatter("stylish");
  const output = await formatter.format(results);
  if (output.trim()) {
    console.log(output);
  }
  // Keep only the plain-data fields the baseline check needs; the raw
  // results carry non-serialisable extras that JSON.parse round-tripping
  // would drop anyway.
  return results.map((result) => ({
    filePath: result.filePath,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
  }));
}

async function main() {
  let report;

  if (process.argv.includes("--run")) {
    try {
      report = await runEslint();
    } catch (err) {
      console.error("lintBaseline: ESLint failed to run:", err.message);
      return 1;
    }
  } else {
    try {
      report = JSON.parse(readInput());
    } catch (err) {
      console.error("lintBaseline: could not parse the ESLint JSON report:", err.message);
      return 1;
    }
  }

  if (!Array.isArray(report)) {
    console.error("lintBaseline: expected an ESLint JSON array report");
    return 1;
  }

  const errors = report.reduce((total, file) => total + (file.errorCount || 0), 0);
  const warnings = report.reduce((total, file) => total + (file.warningCount || 0), 0);

  if (process.argv.includes("--update")) {
    fs.writeFileSync(
      BASELINE_PATH,
      JSON.stringify({ maxWarnings: warnings }, null, 2) + "\n"
    );
    console.log(`lintBaseline: baseline updated to ${warnings} warning(s).`);
    return 0;
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    console.error(
      `lintBaseline: no baseline at ${BASELINE_PATH}. Create one with:\n` +
        "  npx eslint . --format json | node scripts/lintBaseline.js --update"
    );
    return 1;
  }

  const max = Number(baseline.maxWarnings);
  if (!Number.isInteger(max) || max < 0) {
    console.error("lintBaseline: baseline.maxWarnings must be a non-negative integer");
    return 1;
  }

  if (errors > 0) {
    console.error(`lintBaseline: ${errors} lint error(s) -- these always fail the build.`);
    return 1;
  }

  if (warnings > max) {
    console.error(
      `lintBaseline: warnings rose to ${warnings}, above the frozen baseline of ${max}.\n` +
        "Fix the new warnings. Raise the baseline only as a deliberate, reviewed change:\n" +
        "  npx eslint . --format json | node scripts/lintBaseline.js --update"
    );
    return 1;
  }

  if (warnings < max) {
    console.log(
      `lintBaseline: ${warnings} warning(s), below the baseline of ${max}. ` +
        "Lower the baseline to lock the improvement in:\n" +
        "  npx eslint . --format json | node scripts/lintBaseline.js --update"
    );
    return 0;
  }

  console.log(`lintBaseline: ${warnings} warning(s), at the baseline of ${max}. OK.`);
  return 0;
}

// main() returns an exit code rather than assigning process.exitCode from
// inside an async function: that keeps the single point of process mutation
// synchronous, and avoids the require-atomic-updates false positive this
// repo's lint config documents.
main()
  .catch((err) => {
    console.error("lintBaseline: unexpected failure:", err && err.message);
    return 1;
  })
  .then((code) => {
    process.exitCode = code;
  });
