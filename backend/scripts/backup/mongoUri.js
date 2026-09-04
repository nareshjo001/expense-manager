"use strict";

// Shared, dependency-free helpers for working with a MongoDB connection
// string (as read from MONGO_CONN / RESTORE_TARGET_MONGO_CONN) without
// ever logging it -- these strings carry credentials.
const fs = require("fs");
const os = require("os");
const path = require("path");

// Extracts the database name mongodump/mongorestore should target from a
// connection string. Deliberately NOT using the WHATWG URL parser:
// multi-host replica-set connection strings
// (mongodb://h1:27017,h2:27017,h3:27017/dbname?...) are not valid
// single-authority URLs and can throw or mis-parse under `new URL()`.
// Instead: strip the scheme, then take everything after the FIRST "/"
// in what remains (the host-list portion of a Mongo connection string
// can never itself contain a "/", so this is unambiguous), up to an
// optional "?". No "/" after the host list, or nothing between it and
// the next "/" or "?", both mean "no db name given" -> null.
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

// Writes a short-lived YAML config file mongodump/mongorestore can read
// via --config, so the connection string (which carries credentials)
// never appears as a plain --uri argv value visible to every other
// process on the host (e.g. `ps aux`). Mode 0600, written under the OS
// temp dir. Caller must clean up via cleanupTempMongoConfig (or use
// withTempMongoConfig below, which guarantees it).
function writeTempMongoConfig(connectionString) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-mongo-cfg-"));
  const filePath = path.join(dir, "mongo-config.yaml");
  // No user-controlled newlines expected in a connection string, but
  // strip them defensively so this can never become multi-line YAML
  // injection.
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
