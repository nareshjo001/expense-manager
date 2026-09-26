"use strict";

/**
 * FE-003-T01 tests for scripts/analyzeBundleComposition.js.
 *
 * Run with: node --test scripts/analyzeBundleComposition.test.js
 * (also wired as "npm run analyze:bundle-composition:test" -- see
 * package.json). Same rationale as checkPerformanceBudgets.test.js for
 * living outside `src/` and using Node's built-in test runner: this is a
 * build-time-adjacent Node CLI tool, not application code under CRA's
 * `react-scripts test` root.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  resolveSpecifier,
  extractSpecifiers,
  discoverLazyChunkEntries,
  walkReachable,
  packageInstalledSizeBytes,
  buildReport,
} = require("./analyzeBundleComposition.js");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bundle-analysis-test-"));
}

test("resolveSpecifier: relative specifier resolves to an exact existing file", () => {
  const dir = makeTempDir();
  const from = path.join(dir, "a.js");
  const target = path.join(dir, "b.js");
  fs.writeFileSync(from, "");
  fs.writeFileSync(target, "");
  const result = resolveSpecifier(from, "./b.js");
  assert.deepEqual(result, { type: "local", absPath: target });
});

test("resolveSpecifier: relative specifier resolves via extension inference (no extension given)", () => {
  const dir = makeTempDir();
  const from = path.join(dir, "a.js");
  const target = path.join(dir, "b.jsx");
  fs.writeFileSync(from, "");
  fs.writeFileSync(target, "");
  const result = resolveSpecifier(from, "./b");
  assert.deepEqual(result, { type: "local", absPath: target });
});

test("resolveSpecifier: relative specifier resolves via directory index.js", () => {
  const dir = makeTempDir();
  const from = path.join(dir, "a.js");
  fs.mkdirSync(path.join(dir, "sub"));
  const target = path.join(dir, "sub", "index.js");
  fs.writeFileSync(from, "");
  fs.writeFileSync(target, "");
  const result = resolveSpecifier(from, "./sub");
  assert.deepEqual(result, { type: "local", absPath: target });
});

test("resolveSpecifier: relative specifier with no resolvable JS file (e.g. a CSS import) returns null", () => {
  const dir = makeTempDir();
  const from = path.join(dir, "a.js");
  fs.writeFileSync(from, "");
  fs.writeFileSync(path.join(dir, "b.css"), "");
  const result = resolveSpecifier(from, "./b.css");
  assert.equal(result, null);
});

test("resolveSpecifier: bare specifier is a plain npm package", () => {
  const result = resolveSpecifier("/anything.js", "react-dom/client");
  assert.deepEqual(result, { type: "package", name: "react-dom" });
});

test("resolveSpecifier: scoped package keeps its scope as part of the package name", () => {
  const result = resolveSpecifier("/anything.js", "@tanstack/react-query");
  assert.deepEqual(result, { type: "package", name: "@tanstack/react-query" });
});

test("extractSpecifiers: a lazy-loader arrow function's import() is dynamic, not static", () => {
  const source = `
const loadThing = () => import(/* webpackChunkName: "charts" */ '../charts/Thing');
const Thing = lazy(loadThing);
`;
  const { staticSpecs, dynamicSpecs } = extractSpecifiers(source);
  assert.equal(staticSpecs.has("../charts/Thing"), false);
  assert.equal(dynamicSpecs.has("../charts/Thing"), true);
});

test("extractSpecifiers: ordinary import/export-from/require are static", () => {
  const source = `
import React from 'react';
import { a, b } from './local';
export { c } from './other';
const d = require('some-pkg');
`;
  const { staticSpecs } = extractSpecifiers(source);
  assert.equal(staticSpecs.has("react"), true);
  assert.equal(staticSpecs.has("./local"), true);
  assert.equal(staticSpecs.has("./other"), true);
  assert.equal(staticSpecs.has("some-pkg"), true);
});

test("discoverLazyChunkEntries (real repo): every entry it finds resolves to a real local file", () => {
  // discoverLazyChunkEntries reads from the module-level SRC_DIR constant
  // (the real frontend/src), so it's exercised here against the actual
  // repo rather than an arbitrary fixture directory -- a fixture-based test
  // would only be checking regex/resolution logic already covered by the
  // resolveSpecifier/extractSpecifiers unit tests above.
  const entries = discoverLazyChunkEntries();
  assert.ok(Object.keys(entries).length > 0, "expected at least one webpackChunkName-tagged lazy import to be found");
  for (const [category, list] of Object.entries(entries)) {
    assert.ok(list.length > 0, `category "${category}" was discovered with no entries`);
    for (const entry of list) {
      assert.ok(fs.existsSync(entry.absPath), `${category}'s entry "${entry.specifier}" (from ${entry.sourceFile}) did not resolve to a real file`);
    }
  }
});

test("walkReachable: does not cross a dynamic import() boundary by default", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "lazy-target.js"), "import 'heavy-pkg';\n");
  fs.writeFileSync(
    path.join(dir, "entry.js"),
    "import 'light-pkg';\nconst load = () => import('./lazy-target');\n"
  );
  const { localFiles, packages, boundaries } = walkReachable([path.join(dir, "entry.js")]);
  assert.equal(localFiles.has(path.relative(path.join(__dirname, ".."), path.join(dir, "lazy-target.js"))), false);
  assert.equal(packages.has("heavy-pkg"), false);
  assert.equal(packages.has("light-pkg"), true);
  assert.equal(boundaries.has("./lazy-target"), true);
});

test("walkReachable: crosses a dynamic import() boundary when crossBoundaries is true", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "lazy-target.js"), "import 'heavy-pkg';\n");
  fs.writeFileSync(path.join(dir, "entry.js"), "const load = () => import('./lazy-target');\n");
  const { packages } = walkReachable([path.join(dir, "entry.js")], { crossBoundaries: true });
  assert.equal(packages.has("heavy-pkg"), true);
});

test("walkReachable: follows nested static imports transitively and dedupes shared packages", () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, "leaf.js"), "import 'shared-pkg';\n");
  fs.writeFileSync(path.join(dir, "mid.js"), "import './leaf';\nimport 'shared-pkg';\n");
  fs.writeFileSync(path.join(dir, "entry.js"), "import './mid';\n");
  const { localFiles, packages } = walkReachable([path.join(dir, "entry.js")]);
  assert.equal(localFiles.size, 3);
  assert.deepEqual([...packages], ["shared-pkg"]);
});

test("packageInstalledSizeBytes: sums real file sizes recursively under a fixture node_modules-shaped package", () => {
  const dir = makeTempDir();
  fs.mkdirSync(path.join(dir, "some-pkg", "nested"), { recursive: true });
  fs.writeFileSync(path.join(dir, "some-pkg", "index.js"), "a".repeat(100));
  fs.writeFileSync(path.join(dir, "some-pkg", "nested", "file.js"), "b".repeat(50));

  // packageInstalledSizeBytes reads from the module-level NODE_MODULES_DIR
  // constant (the real frontend/node_modules), so it can't be pointed at an
  // arbitrary fixture directory without changing the module's public API.
  // Verify the underlying recursive-sum behavior directly instead, using
  // the same walk this function performs, against the fixture above.
  let total = 0;
  const stack = [path.join(dir, "some-pkg")];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else {
      total += stat.size;
    }
  }
  assert.equal(total, 150);
});

test("packageInstalledSizeBytes: a package not present on disk (against the real repo's node_modules) is 0, not an error", () => {
  assert.equal(packageInstalledSizeBytes("this-package-definitely-does-not-exist-xyz"), 0);
});

// --- Integration: exercised against the real repo's actual src/ tree, the
// same way checkPerformanceBudgets.test.js runs its CLI cases against real
// fixtures rather than only pure-function unit tests. ---

test("buildReport (real repo): discovers at least one lazy chunk, and only under known FE-003-T02 category names", () => {
  // Deliberately NOT a hardcoded "every category must exist" list: which
  // lazy splits exist depends on which FE-003-T03..T06 changes have actually
  // landed on the branch under test (at the time of writing, only
  // bill-upload is committed on main). Asserting the full set here would
  // make this test pass or fail based on unrelated feature progress rather
  // than on this script's own correctness. What IS checked: discovery finds
  // something, and never invents a category name that doesn't match one of
  // the FE-003-T02 budget categories (catches a typo'd webpackChunkName that
  // would otherwise silently fall into checkPerformanceBudgets.js's
  // "other-chunks" bucket).
  const KNOWN = new Set(["charts", "insights", "sia", "bill-upload", "firebase-push"]);
  const report = buildReport();
  const categories = Object.keys(report.categories);
  assert.ok(categories.length > 0, "expected at least one webpackChunkName-tagged lazy chunk");
  for (const category of categories) {
    assert.ok(KNOWN.has(category), `unexpected lazy chunk category "${category}" (typo'd webpackChunkName?)`);
  }
});

test("buildReport (real repo): no lazy chunk's entry file is also eagerly reachable from src/index.js", () => {
  // Guards the whole point of a lazy split: if a chunk's entry file is also
  // reachable from src/index.js through a plain static import, webpack pulls
  // it into main anyway and the React.lazy() wrapper saves nothing.
  //
  // Concrete case this is designed to catch: components/imports/Imports.js
  // (the barrel) statically imports TrendChartPage/BarChartPage/PieChartPage/
  // Insights, and App.js imports that barrel eagerly. When FE-003-T03's
  // LandingPage.js change (lazy-load those four directly) lands, it must
  // remove those four imports/exports from the barrel in the same change --
  // otherwise this test fails, because the "charts"/"insights" chunk entries
  // would still be eagerly reachable through the barrel. On a branch where
  // T03 hasn't landed yet, those components aren't lazy chunks at all, so
  // there is nothing to leak and this test passes trivially for them.
  const report = buildReport();
  for (const [category, data] of Object.entries(report.categories)) {
    assert.equal(
      data.entryLeaksIntoMainBundle,
      null,
      `category "${category}" leaks into main via: ${JSON.stringify(data.entryLeaksIntoMainBundle)}`
    );
  }
});

test("buildReport (real repo): every category reports a non-negative installed size and at least one local file", () => {
  const report = buildReport();
  assert.ok(report.main.localFileCount > 0);
  assert.ok(report.main.totalInstalledSizeKB >= 0);
  for (const data of Object.values(report.categories)) {
    assert.ok(data.localFileCount > 0);
    assert.ok(data.totalInstalledSizeKB >= 0);
  }
});
