#!/usr/bin/env node
/**
 * FE-003-T02 -- performance budget enforcement for the frontend production
 * bundle.
 *
 * Run after `npm run build` (see frontend/package.json's "perf:budgets"
 * script and the "Performance budget check" step in .github/workflows/ci.yml).
 * Wired into real CI, where a full production build actually completes --
 * unlike the sandbox this task was authored in (2 vCPU / 3.8GB), where
 * `npm run build` cannot finish within this environment's per-command time
 * budget even with source maps and ESLint disabled (confirmed directly,
 * three separate attempts, see FE-003-T01/T07 notes in the feature doc).
 * That is why this script's budgets are seeded as a self-calibrating
 * baseline-plus-growth-margin system rather than hand-picked target sizes
 * for chunks nobody in this environment has been able to measure yet: doing
 * that would mean inventing numbers and presenting them as real
 * measurements, which this script deliberately never does. The one
 * exception is the "main" category's `maxGzipKB` ceiling, which is not
 * invented -- it is the pre-optimization figure already recorded in this
 * feature's own 2026-09-08 audit (378 KB gzip, before FE-003-T03..T06 split
 * charts/insights/SIA/bill-upload/firebase-push out of the main bundle), so
 * it is safe to encode as a hard "must not regress past this" backstop.
 *
 * How budgets are established for everything else: the first time this
 * script runs against a real build for a given category, if that category
 * has no recorded `baselineGzipKB`, it reports the measured size and skips
 * enforcement for that category ("RECORD" mode) -- it does not fail the
 * build. A maintainer reviews that number (ideally as part of FE-003-T01/T07
 * once a real build environment is available) and runs this script again
 * with `--update-baseline` to persist it into performance-budgets.json.
 * From that point on, the category is enforced: a build fails if that
 * chunk's gzip size exceeds `baselineGzipKB * (1 + allowedGrowthPercent /
 * 100)`, and also fails if it exceeds `maxGzipKB` when one is set.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DEFAULT_BUILD_DIR = "build";
const DEFAULT_CONFIG_PATH = "performance-budgets.json";

// Ordered specific-to-generic. "main" must be checked before the generic
// numeric-chunk fallback. Category keys here must match the keys under
// `budgets` in performance-budgets.json -- see loadBudgetsConfig's
// validation, which catches a typo'd/missing category instead of silently
// never enforcing it.
const CATEGORY_MATCHERS = [
  { category: "main", test: (name) => /^main\.[^./]+\.js$/.test(name) },
  { category: "charts", test: (name) => /^charts\./.test(name) },
  { category: "insights", test: (name) => /^insights\./.test(name) },
  { category: "sia", test: (name) => /^sia\./.test(name) },
  { category: "bill-upload", test: (name) => /^bill-upload\./.test(name) },
  { category: "firebase-push", test: (name) => /^firebase-push\./.test(name) },
];
const FALLBACK_CATEGORY = "other-chunks";

/**
 * Classify a build output filename (e.g. "main.a1b2c3d4.js",
 * "charts.9f8e7d6c.chunk.js", "453.11223344.chunk.js") into a budget
 * category. Anything that doesn't match a named chunk produced by this
 * app's own webpackChunkName comments (see LandingPage.js, AddExpense.js,
 * SiaEntryPoint.js, useWebPush.js) falls into "other-chunks" -- webpack's
 * own automatic vendor/runtime splits, or a future lazy import that hasn't
 * been given a name yet. Tracking that bucket in aggregate means a new,
 * unnamed chunk cannot silently grow unbounded without ever being counted.
 */
function categorize(filename) {
  for (const { category, test } of CATEGORY_MATCHERS) {
    if (test(filename)) return category;
  }
  return FALLBACK_CATEGORY;
}

/** Gzip size in KB (2 decimal places), the standard unit for JS bundle budgets. */
function gzipSizeKB(buffer) {
  const gzipped = zlib.gzipSync(buffer, { level: zlib.constants.Z_BEST_COMPRESSION });
  return Math.round((gzipped.length / 1024) * 100) / 100;
}

/**
 * Scan `${buildDir}/static/js` for non-sourcemap .js files and return
 * per-file category + gzip size. Throws a descriptive error if the build
 * directory doesn't exist or contains no JS output, so a missing build
 * produces a clear message rather than an empty, silently-passing report.
 */
function collectBuildChunks(buildDir) {
  const jsDir = path.join(buildDir, "static", "js");
  if (!fs.existsSync(jsDir)) {
    throw new Error(
      `No production build found at "${jsDir}". Run "npm run build" first, then re-run this script.`
    );
  }
  const files = fs
    .readdirSync(jsDir)
    .filter((name) => name.endsWith(".js") && !name.endsWith(".js.map"));
  if (files.length === 0) {
    throw new Error(
      `"${jsDir}" exists but contains no .js files. The build may be incomplete -- re-run "npm run build".`
    );
  }
  return files.map((name) => {
    const filePath = path.join(jsDir, name);
    const buffer = fs.readFileSync(filePath);
    return { file: name, category: categorize(name), sizeKB: gzipSizeKB(buffer) };
  });
}

/** Sum per-category sizes from collectBuildChunks's per-file list. */
function aggregateByCategory(chunks) {
  const totals = {};
  for (const { category, sizeKB } of chunks) {
    totals[category] = Math.round(((totals[category] || 0) + sizeKB) * 100) / 100;
  }
  return totals;
}

function loadBudgetsConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Performance budgets config not found at "${configPath}".`);
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!parsed.budgets || typeof parsed.budgets !== "object") {
    throw new Error(`"${configPath}" is missing a "budgets" object.`);
  }
  if (typeof parsed.allowedGrowthPercent !== "number") {
    throw new Error(`"${configPath}" is missing a numeric top-level "allowedGrowthPercent".`);
  }
  return parsed;
}

function writeBudgetsConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * Evaluate one category's measured size against its budget entry.
 * Returns { status: "PASS" | "FAIL" | "RECORD" | "UNBUDGETED", reason }.
 *
 * - "RECORD": no baselineGzipKB set yet (and no maxGzipKB violated) -- not
 *   a failure, just not yet enforced.
 * - "UNBUDGETED": a chunk category exists in the build with no entry at all
 *   in performance-budgets.json (e.g. "other-chunks" was removed from the
 *   config by mistake). Treated as a failure so the config can't silently
 *   drift out of sync with the real build output.
 */
function evaluateCategory(category, measuredKB, budgetEntry, allowedGrowthPercent) {
  if (!budgetEntry) {
    return {
      status: "UNBUDGETED",
      reason: `category "${category}" was found in the build but has no entry in performance-budgets.json`,
    };
  }
  const { maxGzipKB = null, baselineGzipKB = null } = budgetEntry;

  if (maxGzipKB !== null && measuredKB > maxGzipKB) {
    return {
      status: "FAIL",
      reason: `${measuredKB} KB exceeds the hard ceiling of ${maxGzipKB} KB`,
    };
  }

  if (baselineGzipKB === null) {
    return {
      status: "RECORD",
      reason: `no baseline set yet -- measured ${measuredKB} KB; run with --update-baseline to start enforcing`,
    };
  }

  const allowed = Math.round(baselineGzipKB * (1 + allowedGrowthPercent / 100) * 100) / 100;
  if (measuredKB > allowed) {
    return {
      status: "FAIL",
      reason: `${measuredKB} KB exceeds baseline ${baselineGzipKB} KB + ${allowedGrowthPercent}% margin (${allowed} KB)`,
    };
  }

  return { status: "PASS", reason: `${measuredKB} KB within baseline ${baselineGzipKB} KB + ${allowedGrowthPercent}% margin (${allowed} KB)` };
}

/**
 * Run the full check: collect chunks, aggregate, evaluate every category
 * that's either in the build or in the config (so a category that
 * disappeared from the build, e.g. a chunk that got merged away, is still
 * visible in the report rather than silently dropped). Pure function of
 * its inputs -- no process.exit, no console output -- so it's easy to unit
 * test; `main()` below is the thin CLI wrapper around it.
 */
function runCheck({ buildDir, config }) {
  const chunks = collectBuildChunks(buildDir);
  const measured = aggregateByCategory(chunks);
  const allCategories = new Set([...Object.keys(measured), ...Object.keys(config.budgets)]);
  const results = [...allCategories].sort().map((category) => {
    const measuredKB = measured[category] || 0;
    const evaluation = evaluateCategory(
      category,
      measuredKB,
      config.budgets[category],
      config.allowedGrowthPercent
    );
    return { category, measuredKB, ...evaluation };
  });
  const ok = results.every((r) => r.status === "PASS" || r.status === "RECORD");
  return { chunks, results, ok };
}

/**
 * Fill in `baselineGzipKB` for every category currently null (or, with
 * `force: true`, every measured category regardless of its current value).
 * Returns the updated config; does not write it -- callers write via
 * writeBudgetsConfig so this stays a pure transform for testing.
 */
function updateBaselines(config, measured, { force = false } = {}) {
  const updated = JSON.parse(JSON.stringify(config));
  for (const [category, measuredKB] of Object.entries(measured)) {
    if (!updated.budgets[category]) continue; // don't invent new categories here
    const current = updated.budgets[category].baselineGzipKB;
    if (force || current === null || current === undefined) {
      updated.budgets[category].baselineGzipKB = measuredKB;
    }
  }
  return updated;
}

function formatReport(results) {
  const lines = ["", "Performance budget report", "=".repeat(60)];
  for (const r of results) {
    lines.push(`[${r.status}] ${r.category}: ${r.reason}`);
  }
  lines.push("=".repeat(60));
  return lines.join("\n");
}

function main(argv) {
  const args = argv.slice(2);
  const getFlag = (name) => args.includes(`--${name}`);
  const getOpt = (name, fallback) => {
    const prefix = `--${name}=`;
    const match = args.find((a) => a.startsWith(prefix));
    return match ? match.slice(prefix.length) : fallback;
  };

  const buildDir = path.resolve(getOpt("build-dir", DEFAULT_BUILD_DIR));
  const configPath = path.resolve(getOpt("config", DEFAULT_CONFIG_PATH));
  const updateBaseline = getFlag("update-baseline");
  const force = getFlag("force");

  let chunks;
  let config;
  try {
    config = loadBudgetsConfig(configPath);
    chunks = collectBuildChunks(buildDir);
  } catch (err) {
    console.error(`Performance budget check could not run: ${err.message}`);
    process.exit(2);
    return;
  }

  const measured = aggregateByCategory(chunks);

  if (updateBaseline) {
    const updated = updateBaselines(config, measured, { force });
    writeBudgetsConfig(configPath, updated);
    console.log(`Baselines updated in "${configPath}" for: ${Object.keys(measured).join(", ")}`);
    process.exit(0);
    return;
  }

  const { results, ok } = runCheck({ buildDir, config });
  console.log(formatReport(results));

  if (!ok) {
    console.error(
      "\nPerformance budget check FAILED. See the [FAIL]/[UNBUDGETED] lines above."
    );
    process.exit(1);
    return;
  }

  const recordCount = results.filter((r) => r.status === "RECORD").length;
  if (recordCount > 0) {
    console.log(
      `\n${recordCount} categor${recordCount === 1 ? "y has" : "ies have"} no baseline yet (not a failure). ` +
        `Review the sizes above, then run "node scripts/checkPerformanceBudgets.js --update-baseline" to start enforcing them.`
    );
  }
  console.log("\nPerformance budget check passed.");
  process.exit(0);
}

module.exports = {
  categorize,
  gzipSizeKB,
  collectBuildChunks,
  aggregateByCategory,
  loadBudgetsConfig,
  writeBudgetsConfig,
  evaluateCategory,
  runCheck,
  updateBaselines,
  formatReport,
  main,
};

if (require.main === module) {
  main(process.argv);
}
