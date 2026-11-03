"use strict";

// Shared, dependency-free helpers for working with a MongoDB connection string (as read from MONGO_CONN / RESTORE_TARGET_MONGO_CONN) without ever logging it -- these strings carry credentials.
const fs = require("fs");
const os = require("os");
const path = require("path");

// Extracts the database name mongodump/mongorestore should target from a connection string.
function extractDbName(connectionString) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    return null;
  }
  const withoutScheme = connectionString.replace(/^mongodb(\+srv)?:\/\//, "");
  const slashIndex = withoutScheme.indexOf("/");
  if (slashIndex === -1) return null;

  const dbSegment = withoutScheme.slice(slashIndex + 1).split("?")[0];
  if (dbSegment === "") return null;

  try {
    return decodeURIComponent(dbSegment);
  } catch {
    return dbSegment;
  }
}

// G. `ps aux`). `ps aux`).
function writeTempMongoConfig(connectionString) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-mongo-cfg-"));
  const filePath = path.join(dir, "mongo-config.yaml");
  // No user-controlled newlines expected in a connection string, but strip them defensively so this can never become multi-line YAML injection.
  const sanitized = String(connectionString).replace(/[\r\n]/g, "");
  fs.writeFileSync(filePath, `uri: "${sanitized.replace(/"/g, '\\"')}"\n`, { mode: 0o600 });
  return { filePath, dir };
}

function cleanupTempMongoConfig(temp) {
  if (!temp) return;
  try {
    if (temp.filePath && fs.existsSync(temp.filePath)) fs.unlinkSync(temp.filePath);
    if (temp.dir && fs.existsSync(temp.dir)) fs.rmdirSync(temp.dir);
  } catch {
    // best-effort cleanup only -- a leftover temp file under os.tmpdir()
    // is not a correctness problem, just untidy.
  }
}

// Runs `fn(configFilePath)` with a freshly-written temp Mongo config
// file, guaranteeing cleanup (including when fn throws).
async function withTempMongoConfig(connectionString, fn) {
  const temp = writeTempMongoConfig(connectionString);
  try {
    return await fn(temp.filePath);
  } finally {
    cleanupTempMongoConfig(temp);
  }
}

module.exports = {
  extractDbName,
  writeTempMongoConfig,
  cleanupTempMongoConfig,
  withTempMongoConfig,
};
