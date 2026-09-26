#!/usr/bin/env node
/**
 * FE-003-T01 -- static bundle composition and route baseline capture.
 *
 * T01's charter is "capture bundle composition and route baselines." The
 * literal reading of that -- run `npm run build`, read real gzip sizes out
 * of `build/static/js/*.js` -- is exactly what FE-003-T07 also needs, and
 * both are blocked by the same, repeatedly-reconfirmed limit: a full CRA
 * production build never finishes in this environment (2 vCPU / 3.8GB;
 * `npm run build` is killed mid-webpack-compile before emitting any
 * `static/js/*.js`, even with source maps and ESLint disabled -- confirmed
 * fresh on 2026-09-26, not just carried over from the FE-003-T02 notes).
 *
 * This script is the part of T01 that genuinely does not need a build:
 * it reads `src/` itself, without ever executing or bundling it, to answer
 * three real, static questions:
 *
 *   1. What does each FE-003-T02 budget category (main/charts/insights/
 *      sia/bill-upload/firebase-push) actually contain -- which local
 *      component files, and which direct npm package dependencies?
 *   2. Roughly how heavy is each category, using each package's raw
 *      on-disk install size (recursive byte count under its
 *      node_modules/<pkg> folder) as a proxy weight?
 *   3. Is any lazy chunk's entry file ALSO reachable from `src/index.js`
 *      via a plain, eager (non-`import()`) path somewhere else in the
 *      app? If so, the FE-003-T03..T06 split for that chunk isn't actually
 *      keeping it out of the main bundle, no matter what this script's
 *      other numbers say -- webpack would still pull it in eagerly via
 *      that second path.
 *
 * What this deliberately does NOT claim to be, so nobody mistakes it for
 * T07's job: a package's raw on-disk size is not its minified+gzipped,
 * tree-shaken, webpack-deduped contribution to a real bundle -- it is
 * usually a substantial overestimate (dev files, multiple builds/targets,
 * unused exports all count here but wouldn't ship). It is a *composition*
 * and *relative weight* signal, not a bundle-size measurement. The real
 * gzip numbers this script cannot produce are exactly FE-003-T07's job,
 * once a real build environment is available; `checkPerformanceBudgets.js`
 * (FE-003-T02) is what consumes those real numbers when that happens.
 *
 * Usage: node scripts/analyzeBundleComposition.js [--out <path>]
 *   --out <path>   Where to write the JSON report (default:
 *                   bundle-composition-baseline.json in the frontend dir).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.join(__dirname, "..", "src");
const NODE_MODULES_DIR = path.join(__dirname, "..", "node_modules");
const MAIN_ENTRY = path.join(SRC_DIR, "index.js");
const RESOLVE_EXTENSIONS = [".js", ".jsx", ".ts", ".tsx"];
const CODE_FILE_RE = /\.(js|jsx|ts|tsx)$/;

// Matches a lazy, chunk-named dynamic import: import(/* webpackChunkName: "x" */ '...')
const LAZY_IMPORT_RE =
  /import\(\s*\/\*\s*webpackChunkName:\s*"([^"]+)"\s*\*\/\s*['"]([^'"]+)['"]\s*\)/g;
// Any static import/export-from/require specifier (not a dynamic import()).
const STATIC_SPECIFIER_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
// Any dynamic import() at all (used to detect boundaries not to cross).
const ANY_DYNAMIC_IMPORT_RE = /import\(\s*(?:\/\*[^*]*\*\/\s*)?['"]([^'"]+)['"]\s*\)/g;

function readFile(absPath) {
  return fs.readFileSync(absPath, "utf8");
}

/** Resolves an import specifier relative to the file that imports it.
 *  Returns { type: "local", absPath } or { type: "package", name }, or
 *  null if a relative specifier can't be resolved to a real file (a CSS/
 *  asset import, most commonly -- deliberately not an error). */
function resolveSpecifier(fromAbsFile, specifier) {
  if (specifier.startsWith(".")) {
    const base = path.resolve(path.dirname(fromAbsFile), specifier);
    const candidates = [
      base,
      ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
      ...RESOLVE_EXTENSIONS.map((ext) => path.join(base, "index" + ext)),
    ];
    for (const candidate of candidates) {
      // Only resolve to a real JS/TS module -- a specifier that happens to
      // point at an exactly-matching non-code file (most commonly a CSS
      // import, e.g. `import './Thing.css'`) is deliberately left
      // unresolved rather than added to the walk, since there's nothing
      // further to extract specifiers from and counting it as a "local
      // file" would just be noise in the composition report.
      if (CODE_FILE_RE.test(candidate) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { type: "local", absPath: candidate };
      }
    }
    return null; // e.g. a .css/.svg/.png import -- not a JS module to walk further.
  }
  if (specifier.startsWith("/")) {
    return null; // absolute specifiers don't occur in this codebase; ignore defensively.
  }
  const scoped = specifier.startsWith("@");
  const parts = specifier.split("/");
  const name = scoped ? parts.slice(0, 2).join("/") : parts[0];
  return { type: "package", name };
}

/** Every static (non-dynamic) local/package specifier this file imports,
 *  plus every dynamic import() specifier found (kept separate so callers
 *  can decide whether to treat it as a boundary). */
function extractSpecifiers(source) {
  const staticSpecs = new Set();
  let m;
  STATIC_SPECIFIER_RE.lastIndex = 0;
  while ((m = STATIC_SPECIFIER_RE.exec(source))) staticSpecs.add(m[1]);
  REQUIRE_RE.lastIndex = 0;
  while ((m = REQUIRE_RE.exec(source))) staticSpecs.add(m[1]);

  const dynamicSpecs = new Set();
  ANY_DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = ANY_DYNAMIC_IMPORT_RE.exec(source))) dynamicSpecs.add(m[1]);

  return { staticSpecs, dynamicSpecs };
}

/** Discovers every `import(/* webpackChunkName: "x" *\/ '...')` call site
 *  under src/, by scanning every source file directly (not by walking a
 *  graph) -- this is what makes the category list self-updating rather
 *  than hand-maintained: a new lazy split with a webpackChunkName comment
 *  is picked up automatically the next time this script runs. */
function discoverLazyChunkEntries() {
  const entries = {}; // category -> [{ sourceFile, specifier, absPath }]
  walkAllFiles(SRC_DIR, (absPath) => {
    if (!CODE_FILE_RE.test(absPath)) return;
    const source = readFile(absPath);
    let m;
    LAZY_IMPORT_RE.lastIndex = 0;
    while ((m = LAZY_IMPORT_RE.exec(source))) {
      const [, category, specifier] = m;
      const resolved = resolveSpecifier(absPath, specifier);
      if (!resolved || resolved.type !== "local") continue; // shouldn't happen for a real chunk split
      entries[category] = entries[category] || [];
      entries[category].push({
        sourceFile: path.relative(path.join(__dirname, ".."), absPath),
        specifier,
        absPath: resolved.absPath,
      });
    }
  });
  return entries;
}

function walkAllFiles(dir, onFile) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAllFiles(abs, onFile);
    } else if (entry.isFile()) {
      onFile(abs);
    }
  }
}

/** BFS over local files reachable from `entryAbsPaths`, following static
 *  imports only. Dynamic import() specifiers are recorded as boundaries
 *  (not expanded) unless `crossBoundaries` is true. Returns
 *  { localFiles: Set<relPath>, packages: Set<string>, boundaries: Set<string> }. */
function walkReachable(entryAbsPaths, { crossBoundaries = false } = {}) {
  const localFiles = new Set();
  const packages = new Set();
  const boundaries = new Set(); // dynamic-import specifiers encountered, not expanded
  const queue = [...entryAbsPaths];
  const seen = new Set(entryAbsPaths);

  while (queue.length) {
    const current = queue.shift();
    if (!fs.existsSync(current)) continue;
    localFiles.add(path.relative(path.join(__dirname, ".."), current));
    const source = readFile(current);
    const { staticSpecs, dynamicSpecs } = extractSpecifiers(source);

    for (const spec of dynamicSpecs) {
      boundaries.add(spec);
      if (!crossBoundaries) continue;
      const resolved = resolveSpecifier(current, spec);
      if (resolved && resolved.type === "local" && !seen.has(resolved.absPath)) {
        seen.add(resolved.absPath);
        queue.push(resolved.absPath);
      }
    }

    for (const spec of staticSpecs) {
      const resolved = resolveSpecifier(current, spec);
      if (!resolved) continue;
      if (resolved.type === "package") {
        packages.add(resolved.name);
      } else if (!seen.has(resolved.absPath)) {
        seen.add(resolved.absPath);
        queue.push(resolved.absPath);
      }
    }
  }

  return { localFiles, packages, boundaries };
}

/** Raw on-disk byte size of everything under node_modules/<pkg> -- an
 *  upper-bound weight proxy, not a bundle size (see module header). */
const packageSizeCache = new Map();
function packageInstalledSizeBytes(name) {
  if (packageSizeCache.has(name)) return packageSizeCache.get(name);
  const dir = path.join(NODE_MODULES_DIR, name);
  let total = 0;
  if (fs.existsSync(dir)) {
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
      } else {
        total += stat.size;
      }
    }
  }
  packageSizeCache.set(name, total);
  return total;
}

function toKB(bytes) {
  return Math.round((bytes / 1024) * 10) / 10;
}

function buildReport() {
  const lazyEntries = discoverLazyChunkEntries();

  // "main": everything reachable from src/index.js without crossing a
  // dynamic import() boundary -- i.e. what actually ships in the initial
  // chunk today, as far as static analysis alone can tell.
  const mainWalk = walkReachable([MAIN_ENTRY], { crossBoundaries: false });

  const categories = {};
  for (const [category, entryList] of Object.entries(lazyEntries)) {
    const entryAbsPaths = entryList.map((e) => e.absPath);
    const walk = walkReachable(entryAbsPaths, { crossBoundaries: false });
    const packagesWithSize = [...walk.packages]
      .map((name) => ({ name, installedSizeKB: toKB(packageInstalledSizeBytes(name)) }))
      .sort((a, b) => b.installedSizeKB - a.installedSizeKB);

    // A package this chunk imports that main's own static walk ALSO
    // reaches: splitting this chunk out doesn't remove that package's
    // weight from the initial load, because main already pulls it in
    // through some other, eager path.
    const sharedWithMain = packagesWithSize
      .filter((p) => mainWalk.packages.has(p.name))
      .map((p) => p.name);

    // Is this chunk's own entry file reachable from main through a plain
    // (non-lazy) static path too? If so the "split" isn't actually
    // splitting anything for that file -- main would still pull it in
    // eagerly regardless of the lazy() wrapper elsewhere.
    const entryLeaksIntoMain = entryList
      .filter((e) => mainWalk.localFiles.has(path.relative(path.join(__dirname, ".."), e.absPath)))
      .map((e) => e.sourceFile);

    categories[category] = {
      loadedFrom: entryList.map((e) => ({ sourceFile: e.sourceFile, specifier: e.specifier })),
      localFileCount: walk.localFiles.size,
      localFiles: [...walk.localFiles].sort(),
      directPackages: packagesWithSize,
      totalInstalledSizeKB: Math.round(packagesWithSize.reduce((s, p) => s + p.installedSizeKB, 0) * 10) / 10,
      packagesAlsoInMain: sharedWithMain,
      entryLeaksIntoMainBundle: entryLeaksIntoMain.length > 0 ? entryLeaksIntoMain : null,
    };
  }

  const mainPackagesWithSize = [...mainWalk.packages]
    .map((name) => ({ name, installedSizeKB: toKB(packageInstalledSizeBytes(name)) }))
    .sort((a, b) => b.installedSizeKB - a.installedSizeKB);

  return {
    description:
      "FE-003-T01 static bundle composition baseline. Generated by node scripts/analyzeBundleComposition.js " +
      "from source alone (no build step) -- see the script's header comment for exactly what these numbers " +
      "do and don't mean. installedSizeKB is each package's raw on-disk size, not a real gzip/minified bundle " +
      "contribution; treat all sizes here as relative composition signal, not FE-003-T07's real measurement.",
    generatedAt: new Date().toISOString(),
    main: {
      entry: path.relative(path.join(__dirname, ".."), MAIN_ENTRY),
      localFileCount: mainWalk.localFiles.size,
      directPackages: mainPackagesWithSize,
      totalInstalledSizeKB: Math.round(mainPackagesWithSize.reduce((s, p) => s + p.installedSizeKB, 0) * 10) / 10,
      lazyBoundariesEncountered: [...mainWalk.boundaries].sort(),
    },
    categories,
  };
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outPath =
    outIdx !== -1 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1])
      : path.join(__dirname, "..", "bundle-composition-baseline.json");

  const report = buildReport();
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

  console.log(`Bundle composition baseline written to ${path.relative(process.cwd(), outPath)}`);
  console.log(`main: ${report.main.localFileCount} local files, ${report.main.directPackages.length} direct packages, ~${report.main.totalInstalledSizeKB} KB installed size`);
  for (const [category, data] of Object.entries(report.categories)) {
    console.log(
      `${category}: ${data.localFileCount} local files, ${data.directPackages.length} direct packages, ~${data.totalInstalledSizeKB} KB installed size` +
        (data.entryLeaksIntoMainBundle ? ` -- WARNING: also reachable from main (${data.entryLeaksIntoMainBundle.join(", ")})` : "")
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveSpecifier,
  extractSpecifiers,
  discoverLazyChunkEntries,
  walkReachable,
  packageInstalledSizeBytes,
  buildReport,
};
