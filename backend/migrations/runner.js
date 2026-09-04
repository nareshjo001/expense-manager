// DAT-003-T01 -- migration file discovery and shape validation only. See
// docs/decisions/ADR-0004-migration-runner-choice.md for why this is
// hand-rolled rather than a third-party framework, and
// docs/decisions/ADR-0006-migration-up-verify-forward-fix-conventions.md
// for the up()/verify() contract this file's shape check enforces (T03).
// migrations/ledger.js and migrations/lock.js (T02) now exist. What is
// still deliberately NOT here: no execution driver that actually calls a
// migration's up() (T04's dry-run/batch/resume), no backup gate (T05).
// Actually running a migration is deferred until T04 builds that driver
// on top of T02's lock/ledger -- calling a migration's up() by hand today
// would run unprotected and unrecorded.
"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const MIGRATIONS_DIR = path.join(__dirname, "scripts");

const REQUIRED_EXPORTS = ["id", "description", "up"];

// Every migration file must export this shape. Thrown errors always name
// the offending filename -- this runs at startup/CI time, not in a
// request path, so a loud failure with a clear filename is exactly what
// an operator needs, not a caught/degraded state.
function validateMigrationModule(mod, filename) {
  if (!mod || typeof mod !== "object") {
    throw new Error(`Migration ${filename} must export an object`);
  }
  for (const key of REQUIRED_EXPORTS) {
    if (mod[key] === undefined) {
      throw new Error(`Migration ${filename} is missing required export "${key}"`);
    }
  }
  if (typeof mod.id !== "string" || mod.id.trim() === "") {
    throw new Error(`Migration ${filename}'s "id" export must be a non-empty string`);
  }
  if (typeof mod.description !== "string" || mod.description.trim() === "") {
    throw new Error(`Migration ${filename}'s "description" export must be a non-empty string`);
  }
  if (typeof mod.up !== "function") {
    throw new Error(`Migration ${filename}'s "up" export must be a function`);
  }
  if (mod.verify !== undefined && typeof mod.verify !== "function") {
    throw new Error(`Migration ${filename}'s "verify" export must be a function when present`);
  }
}

// Lists migration filenames in the scripts directory, lexicographically
// sorted -- chronological order, given the id-prefixed filename
// convention this ADR sets (e.g. "20260903-example-change.js"). Returns
// [] when the directory does not exist yet rather than throwing, so a
// fresh checkout with no migrations authored yet is a normal, valid state.
function loadMigrationFilenames(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

// Evaluates a migration file's *current on-disk content* fresh, every
// single call -- deliberately bypassing require()'s module cache rather
// than trying to invalidate it.
//
// The previous implementation did `delete require.cache[resolved];
// require(resolved)`, which is the standard Node technique and does work
// under plain Node (verified directly). It does NOT reliably work under
// Jest: Jest's `require.cache` is a compatibility shim over Jest's own
// internal module registry, and deleting a key from that shim does not
// reliably evict Jest's registry entry, so a migration file rewritten in
// place (the legitimate "fix a failed migration and retry" flow this
// function's callers exist to support) can silently keep re-executing
// its old, broken code from Jest's cache -- while `loadMigrationFilenames`
// above correctly reports the fresh filename list, the module content
// itself stays stale. This was caught by
// tests/migrationDriver.test.js's "resuming after a failure" case, which
// fixes a failing migration in place and re-runs it, and reproduced
// identically in real CI (Jest there too), not just locally.
//
// Reading the file's text and evaluating it by hand sidesteps the whole
// problem: there is no cache (Node's or any host runtime's) covering
// this file's own execution to go stale, because this never calls
// require() on `fullPath` at all. `require("module").createRequire`
// gives the evaluated code a real, correctly-scoped `require` for its
// own nested requires (resolved relative to `fullPath`, exactly as a
// normal require() would), so a migration file requiring a sibling
// project module (e.g. `require("../../utils/money")`) still resolves
// correctly.
function loadMigrationModule(fullPath) {
  const source = fs.readFileSync(fullPath, "utf8");
  const scopedRequire = createRequire(fullPath);
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  const wrapper = new Function("exports", "require", "module", "__filename", "__dirname", source);
  wrapper(mod.exports, scopedRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

// Requires and validates every migration file in the directory. Throws on
// the first invalid file rather than skipping it -- a malformed migration
// must never be silently excluded from the plan.
function loadMigrations(dir = MIGRATIONS_DIR) {
  return loadMigrationFilenames(dir).map((filename) => {
    const fullPath = path.join(dir, filename);
    // Always re-read from disk and re-evaluate fresh -- see
    // loadMigrationModule's comment above for why this isn't a plain
    // require() (with or without cache-busting). A failed
    // (not-yet-applied) migration is legitimately edited in place before
    // being retried -- ADR-0006's forward-fix policy only forbids
    // editing an *already-applied* migration, not one that threw and
    // never took effect. Without this, a long-lived process that calls
    // loadMigrations() more than once (a retry loop, an admin tool, this
    // driver's own tests) would silently keep re-running the old,
    // broken code instead of the fix, with nothing to signal it.
    const mod = loadMigrationModule(fullPath);
    validateMigrationModule(mod, filename);
    return {
      filename,
      id: mod.id,
      description: mod.description,
      up: mod.up,
      verify: mod.verify,
    };
  });
}

// T01 scope: what WOULD run, not what runs. There is no ledger yet (T02),
// so every discovered migration is always "pending" -- this cannot yet
// know which have already been applied to a given environment.
function planPending(dir = MIGRATIONS_DIR) {
  return loadMigrations(dir).map(({ id, description, filename }) => ({
    id,
    description,
    filename,
  }));
}

module.exports = {
  MIGRATIONS_DIR,
  validateMigrationModule,
  loadMigrationFilenames,
  loadMigrations,
  planPending,
};
