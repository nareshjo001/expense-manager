// Migration file discovery and shape validation only. md for the up()/verify() contract this file's shape check enforces (T03).
"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const MIGRATIONS_DIR = path.join(__dirname, "scripts");

const REQUIRED_EXPORTS = ["id", "description", "up"];

// Every migration file must export this shape.
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

// G. js"). js").
function loadMigrationFilenames(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

// Evaluates a migration file's *current on-disk content* fresh, every single call -- deliberately bypassing require()'s module cache rather than trying to invalidate it.
function loadMigrationModule(fullPath) {
  const source = fs.readFileSync(fullPath, "utf8");
  const scopedRequire = createRequire(fullPath);
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  const wrapper = new Function("exports", "require", "module", "__filename", "__dirname", source);
  wrapper(mod.exports, scopedRequire, mod, fullPath, path.dirname(fullPath));
  return mod.exports;
}

// Requires and validates every migration file in the directory.
function loadMigrations(dir = MIGRATIONS_DIR) {
  return loadMigrationFilenames(dir).map((filename) => {
    const fullPath = path.join(dir, filename);
    // Always re-read from disk and re-evaluate fresh -- see loadMigrationModule's comment above for why this isn't a plain require() (with or without cache-busting).
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

// T01 scope: what WOULD run, not what runs.
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
