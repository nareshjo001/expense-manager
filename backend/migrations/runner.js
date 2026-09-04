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

// Requires and validates every migration file in the directory. Throws on
// the first invalid file rather than skipping it -- a malformed migration
// must never be silently excluded from the plan.
function loadMigrations(dir = MIGRATIONS_DIR) {
  return loadMigrationFilenames(dir).map((filename) => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(path.join(dir, filename));
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
