"use strict";

/**
 * FE-003-T02 tests for scripts/checkPerformanceBudgets.js.
 *
 * Run with: node --test scripts/checkPerformanceBudgets.test.js
 * (also wired as "npm run test:perf-budgets" -- see package.json).
 *
 * This script lives outside CRA's `src/` tree on purpose (it's a build-time
 * Node CLI tool, not application code), so it's outside `react-scripts
 * test`'s default root and is tested with Node's own built-in test runner
 * instead -- no extra dependency needed, and it exercises the real script
 * exactly as CI invokes it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const {
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
} = require("./checkPerformanceBudgets.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "perf-budgets-test-"));
}

function writeChunk(buildDir, filename, contentSizeBytes) {
  const jsDir = path.join(buildDir, "static", "js");
  fs.mkdirSync(jsDir, { recursive: true });
  // Repeated content so gzip compresses it, like real JS -- an all-random
  // buffer wouldn't compress and would make the "gzip size" assertions
  // meaningless.
  const content = "x".repeat(contentSizeBytes);
  fs.writeFileSync(path.join(jsDir, filename), content, "utf8");
  return path.join(jsDir, filename);
}

function baseConfig(overrides = {}) {
  return {
    allowedGrowthPercent: 10,
    budgets: {
      main: { maxGzipKB: 378, baselineGzipKB: null },
      charts: { maxGzipKB: null, baselineGzipKB: null },
      ...overrides,
    },
  };
}

// --- categorize ---------------------------------------------------------

test("categorize: matches named chunks by their webpackChunkName prefix", () => {
  assert.equal(categorize("main.a1b2c3d4.js"), "main");
  assert.equal(categorize("charts.9f8e7d6c.chunk.js"), "charts");
  assert.equal(categorize("insights.11112222.chunk.js"), "insights");
  assert.equal(categorize("sia.33334444.chunk.js"), "sia");
  assert.equal(categorize("bill-upload.55556666.chunk.js"), "bill-upload");
  assert.equal(categorize("firebase-push.77778888.chunk.js"), "firebase-push");
});

test("categorize: unnamed/unknown chunks fall back to other-chunks", () => {
  assert.equal(categorize("453.abcd1234.chunk.js"), "other-chunks");
  assert.equal(categorize("runtime-main.deadbeef.js"), "other-chunks");
});

// --- gzipSizeKB ----------------------------------------------------------

test("gzipSizeKB: larger repetitive input compresses to a larger (but still small) gzip size", () => {
  const small = gzipSizeKB(Buffer.from("a".repeat(1000)));
  const large = gzipSizeKB(Buffer.from("a".repeat(100000)));
  assert.ok(small > 0);
  assert.ok(large > small);
});

// --- collectBuildChunks ---------------------------------------------------

test("collectBuildChunks: throws a clear error when the build directory is missing", () => {
  const dir = makeTempDir();
  assert.throws(
    () => collectBuildChunks(path.join(dir, "nonexistent-build")),
    /No production build found/
  );
});

test("collectBuildChunks: throws when static/js exists but has no .js files", () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, "static", "js"), { recursive: true });
  assert.throws(() => collectBuildChunks(dir), /contains no \.js files/);
});

test("collectBuildChunks: ignores .js.map files and categorizes real chunks", () => {
  const dir = makeTempDir();
  writeChunk(dir, "main.aaaa1111.js", 5000);
  writeChunk(dir, "main.aaaa1111.js.map", 20000);
  writeChunk(dir, "charts.bbbb2222.chunk.js", 3000);
  const chunks = collectBuildChunks(dir);
  const names = chunks.map((c) => c.file).sort();
  assert.deepEqual(names, ["charts.bbbb2222.chunk.js", "main.aaaa1111.js"]);
  assert.equal(chunks.find((c) => c.file.startsWith("main")).category, "main");
  assert.equal(chunks.find((c) => c.file.startsWith("charts")).category, "charts");
});

// --- aggregateByCategory --------------------------------------------------

test("aggregateByCategory: sums multiple files in the same category", () => {
  const chunks = [
    { file: "charts.a.chunk.js", category: "charts", sizeKB: 10 },
    { file: "charts.b.chunk.js", category: "charts", sizeKB: 5.5 },
    { file: "main.x.js", category: "main", sizeKB: 100 },
  ];
  const totals = aggregateByCategory(chunks);
  assert.equal(totals.charts, 15.5);
  assert.equal(totals.main, 100);
});

// --- config load/write -----------------------------------------------------

test("loadBudgetsConfig: throws when the file doesn't exist", () => {
  const dir = makeTempDir();
  assert.throws(
    () => loadBudgetsConfig(path.join(dir, "missing.json")),
    /not found/
  );
});

test("loadBudgetsConfig: throws when budgets or allowedGrowthPercent is missing", () => {
  const dir = makeTempDir();
  const p1 = path.join(dir, "no-budgets.json");
  fs.writeFileSync(p1, JSON.stringify({ allowedGrowthPercent: 10 }));
  assert.throws(() => loadBudgetsConfig(p1), /missing a "budgets" object/);

  const p2 = path.join(dir, "no-growth.json");
  fs.writeFileSync(p2, JSON.stringify({ budgets: {} }));
  assert.throws(() => loadBudgetsConfig(p2), /allowedGrowthPercent/);
});

test("writeBudgetsConfig then loadBudgetsConfig round-trips", () => {
  const dir = makeTempDir();
  const p = path.join(dir, "config.json");
  const config = baseConfig();
  writeBudgetsConfig(p, config);
  const reloaded = loadBudgetsConfig(p);
  assert.deepEqual(reloaded, config);
  assert.ok(fs.readFileSync(p, "utf8").endsWith("\n"));
});

// --- evaluateCategory ------------------------------------------------------

test("evaluateCategory: UNBUDGETED when the category has no config entry", () => {
  const result = evaluateCategory("mystery", 50, undefined, 10);
  assert.equal(result.status, "UNBUDGETED");
});

test("evaluateCategory: RECORD when baseline is null and under any maxGzipKB", () => {
  const result = evaluateCategory("charts", 42, { maxGzipKB: null, baselineGzipKB: null }, 10);
  assert.equal(result.status, "RECORD");
});

test("evaluateCategory: FAIL when measured exceeds the hard maxGzipKB ceiling, even with no baseline", () => {
  const result = evaluateCategory("main", 400, { maxGzipKB: 378, baselineGzipKB: null }, 10);
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /exceeds the hard ceiling/);
});

test("evaluateCategory: PASS when within baseline + growth margin", () => {
  const result = evaluateCategory(
    "sia",
    54,
    { maxGzipKB: null, baselineGzipKB: 50 },
    10
  ); // allowed = 55
  assert.equal(result.status, "PASS");
});

test("evaluateCategory: FAIL when exceeding baseline + growth margin", () => {
  const result = evaluateCategory(
    "sia",
    56,
    { maxGzipKB: null, baselineGzipKB: 50 },
    10
  ); // allowed = 55
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /margin/);
});

test("evaluateCategory: maxGzipKB still applies as a backstop even once a baseline exists", () => {
  const result = evaluateCategory(
    "main",
    380,
    { maxGzipKB: 378, baselineGzipKB: 200 }, // growth margin alone would allow 220
    10
  );
  assert.equal(result.status, "FAIL");
  assert.match(result.reason, /hard ceiling/);
});

// --- runCheck (integration of the pieces above) ---------------------------

test("runCheck: overall ok=true when every category PASSes or RECORDs", () => {
  const dir = makeTempDir();
  writeChunk(dir, "main.a.js", 2000);
  writeChunk(dir, "charts.b.chunk.js", 1000);
  const config = baseConfig();
  const { ok, results } = runCheck({ buildDir: dir, config });
  assert.equal(ok, true);
  assert.equal(results.find((r) => r.category === "main").status, "RECORD");
});

test("runCheck: overall ok=false when any category FAILs", () => {
  const dir = makeTempDir();
  // 400KB of repeated text still gzips down well below 378KB, so force a
  // real failure by lowering the ceiling instead of relying on compression
  // ratio assumptions.
  writeChunk(dir, "main.a.js", 50000);
  const config = baseConfig();
  config.budgets.main.maxGzipKB = 0.01;
  const { ok, results } = runCheck({ buildDir: dir, config });
  assert.equal(ok, false);
  assert.equal(results.find((r) => r.category === "main").status, "FAIL");
});

test("runCheck: a category present in config but absent from the build reports 0 KB, not a crash", () => {
  const dir = makeTempDir();
  writeChunk(dir, "main.a.js", 1000);
  const config = baseConfig(); // includes "charts" with no chunk written
  const { results } = runCheck({ buildDir: dir, config });
  const charts = results.find((r) => r.category === "charts");
  assert.equal(charts.measuredKB, 0);
});

// --- updateBaselines -------------------------------------------------------

test("updateBaselines: fills only null baselines by default", () => {
  const config = baseConfig({
    sia: { maxGzipKB: null, baselineGzipKB: 20 },
  });
  const measured = { main: 150, charts: 30, sia: 25 };
  const updated = updateBaselines(config, measured);
  assert.equal(updated.budgets.main.baselineGzipKB, 150);
  assert.equal(updated.budgets.charts.baselineGzipKB, 30);
  assert.equal(updated.budgets.sia.baselineGzipKB, 20); // untouched, not forced
});

test("updateBaselines: force=true overwrites existing baselines too", () => {
  const config = baseConfig({
    sia: { maxGzipKB: null, baselineGzipKB: 20 },
  });
  const measured = { sia: 25 };
  const updated = updateBaselines(config, measured, { force: true });
  assert.equal(updated.budgets.sia.baselineGzipKB, 25);
});

test("updateBaselines: does not mutate the input config (pure transform)", () => {
  const config = baseConfig();
  const before = JSON.stringify(config);
  updateBaselines(config, { main: 999 });
  assert.equal(JSON.stringify(config), before);
});

test("updateBaselines: ignores measured categories with no matching budget entry", () => {
  const config = baseConfig();
  const updated = updateBaselines(config, { "totally-unknown": 12 });
  assert.equal(updated.budgets["totally-unknown"], undefined);
});

// --- formatReport ------------------------------------------------------------

test("formatReport: includes every result's status and category", () => {
  const text = formatReport([
    { category: "main", status: "PASS", reason: "fine" },
    { category: "charts", status: "RECORD", reason: "no baseline" },
  ]);
  assert.match(text, /\[PASS\] main: fine/);
  assert.match(text, /\[RECORD\] charts: no baseline/);
});

// --- end-to-end CLI invocation -----------------------------------------------

test("CLI: exits 0 and prints a passing report for a build under budget", () => {
  const dir = makeTempDir();
  writeChunk(dir, "main.a.js", 1000);
  const configPath = path.join(dir, "performance-budgets.json");
  writeBudgetsConfig(configPath, baseConfig());

  const result = execFileSync(
    process.execPath,
    [
      path.join(__dirname, "checkPerformanceBudgets.js"),
      `--build-dir=${dir}`,
      `--config=${configPath}`,
    ],
    { encoding: "utf8" }
  );
  assert.match(result, /Performance budget check passed/);
});

test("CLI: exits non-zero when a build directory is missing", () => {
  const dir = makeTempDir();
  const configPath = path.join(dir, "performance-budgets.json");
  writeBudgetsConfig(configPath, baseConfig());

  assert.throws(() => {
    execFileSync(
      process.execPath,
      [
        path.join(__dirname, "checkPerformanceBudgets.js"),
        `--build-dir=${path.join(dir, "no-such-build")}`,
        `--config=${configPath}`,
      ],
      { encoding: "utf8", stdio: "pipe" }
    );
  }, /Command failed/);
});

test("CLI: --update-baseline writes measured sizes back to the config file on disk", () => {
  const dir = makeTempDir();
  writeChunk(dir, "main.a.js", 1000);
  const configPath = path.join(dir, "performance-budgets.json");
  writeBudgetsConfig(configPath, baseConfig());

  execFileSync(
    process.execPath,
    [
      path.join(__dirname, "checkPerformanceBudgets.js"),
      `--build-dir=${dir}`,
      `--config=${configPath}`,
      "--update-baseline",
    ],
    { encoding: "utf8" }
  );

  const reloaded = loadBudgetsConfig(configPath);
  assert.ok(reloaded.budgets.main.baselineGzipKB > 0);
});
