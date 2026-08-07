// Jest `setupFiles` module for the M0-2 integration suite ONLY (wired via
// jest.integration.config.js -- backend/jest.config.js and the M0-T smoke
// test are untouched and never load this file).
//
// Runs once per test file, in the SAME process/environment as the test
// file, before the test file's own top-level `require`s execute. This is
// what makes it safe to map env vars here and have
// tests/report.integration.itest.js's later `require("../app")` see the
// mapped values -- unlike Jest's `globalSetup`, which runs in a separate
// process and cannot mutate this process's `process.env`.
//
// Responsibilities, strictly in this order:
//   1. Snapshot whatever MONGO_CONN/REDIS_URL/JWT_SECRET already exist in
//      process.env -- comparison only, never reassigned back.
//   2. Parse backend/.env (if present) into memory ONLY, for comparison --
//      never assigned to process.env, never logged, whole or in part.
//   3. Parse backend/.env.test (if present), allowlisting only
//      TEST_MONGO_CONN / TEST_REDIS_URL / TEST_JWT_SECRET -- any other key
//      present in that file is ignored, never imported.
//   4. Validate all three TEST_* values are non-empty, that TEST_MONGO_CONN
//      names an explicit database whose name contains "test", and that
//      neither TEST_MONGO_CONN nor TEST_REDIS_URL resolves to the same
//      target as the ordinary MONGO_CONN/REDIS_URL (when available).
//   5. Only once every validation has passed: map TEST_* onto the real
//      MONGO_CONN/REDIS_URL/JWT_SECRET keys and set NODE_ENV=test.
//   6. Any failure throws synchronously, before any application module is
//      ever required by the test file -- this module never connects to
//      anything itself.
"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Resolved relative to THIS file's location (backend/tests/setup/), not the
// caller's working directory -- so `.env`/`.env.test` are always read from
// the backend/ directory regardless of where `jest`/`npm` was invoked from.
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

function readParsedEnvFile(fileName) {
  const filePath = path.join(BACKEND_ROOT, fileName);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  // dotenv.parse() never touches process.env -- it only returns an object.
  return dotenv.parse(fs.readFileSync(filePath));
}

function fail(message) {
  // Deliberately never includes a raw connection string, credential, or
  // secret value -- only non-secret metadata (e.g. a parsed database name)
  // is ever included in a thrown message.
  throw new Error(`[integrationEnv] ${message}`);
}

// --- Step 1: snapshot whatever is already in process.env -------------------
const originalProcessEnv = {
  MONGO_CONN: process.env.MONGO_CONN,
  REDIS_URL: process.env.REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET,
};

// --- Step 2: parse backend/.env in memory only, for comparison -------------
const ordinaryEnvFile = readParsedEnvFile(".env");

const ordinaryMongoConn =
  originalProcessEnv.MONGO_CONN || ordinaryEnvFile.MONGO_CONN || null;
const ordinaryRedisUrl =
  originalProcessEnv.REDIS_URL || ordinaryEnvFile.REDIS_URL || null;

// --- Step 3: parse backend/.env.test, allowlisted keys only ----------------
const ALLOWLIST = ["TEST_MONGO_CONN", "TEST_REDIS_URL", "TEST_JWT_SECRET"];
const testEnvFile = readParsedEnvFile(".env.test");

const testValues = {};
for (const key of ALLOWLIST) {
  // A real CI-injected process.env value takes precedence over the file,
  // mirroring dotenv's own "never override an already-set var" convention
  // -- but only for these three allowlisted names. Nothing else from
  // .env.test is ever read.
  testValues[key] = process.env[key] || testEnvFile[key] || "";
}

// --- Step 4a: all three must be non-empty -----------------------------------
for (const key of ALLOWLIST) {
  if (!testValues[key]) {
    fail(
      `${key} is required for the integration suite and was not found in ` +
        `process.env or ${path.join(BACKEND_ROOT, ".env.test")}.`
    );
  }
}

// --- Mongo URI parsing -------------------------------------------------------
// Supports exactly the two real forms this repository's driver (mongoose 9 /
// mongodb 6) and server.js's own DNS-SRV-fix comment indicate are in use:
//   mongodb://[user:pass@]host[,host...][/db][?opts]
//   mongodb+srv://[user:pass@]host[/db][?opts]
// This is NOT a general-purpose MongoDB connection-string parser -- any
// other scheme or an unparseable string fails closed with a clear error,
// per the explicit instruction not to claim broader support than this.
const MONGO_URI_PATTERN = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i;

function parseMongoTarget(uri, label) {
  const match = MONGO_URI_PATTERN.exec(uri);
  if (!match) {
    fail(
      `${label} is not a supported MongoDB URI form (expected mongodb:// ` +
        `or mongodb+srv://).`
    );
  }
  const hostPart = match[2].toLowerCase();
  const dbName = (match[3] || "").split("?")[0];
  return { hostPart, dbName };
}

const testMongoTarget = parseMongoTarget(
  testValues.TEST_MONGO_CONN,
  "TEST_MONGO_CONN"
);

// --- Step 4b: explicit database name containing "test" ---------------------
if (!testMongoTarget.dbName) {
  fail("TEST_MONGO_CONN must include an explicit database name in its path.");
}
if (!testMongoTarget.dbName.toLowerCase().includes("test")) {
  fail(
    `TEST_MONGO_CONN's database name ("${testMongoTarget.dbName}") must ` +
      `contain "test".`
  );
}

// --- Step 4c: reject the same cluster/host + database as the ordinary target
if (ordinaryMongoConn) {
  let ordinaryMongoTarget = null;
  try {
    ordinaryMongoTarget = parseMongoTarget(ordinaryMongoConn, "MONGO_CONN");
  } catch (err) {
    // The ordinary target being unparseable does not block TEST_MONGO_CONN's
    // own validation above -- it only means this specific same-target
    // comparison is skipped, never silently treated as a pass.
    ordinaryMongoTarget = null;
  }
  if (
    ordinaryMongoTarget &&
    ordinaryMongoTarget.hostPart === testMongoTarget.hostPart &&
    ordinaryMongoTarget.dbName.toLowerCase() ===
      testMongoTarget.dbName.toLowerCase()
  ) {
    fail(
      "TEST_MONGO_CONN resolves to the same host and database as the " +
        "ordinary MONGO_CONN target. Refusing to run."
    );
  }
}

// --- Redis URI parsing -------------------------------------------------------
// Supports redis:// and rediss://. Host is lowercased; an omitted port is
// treated as the Redis default, 6379, per the approved normalization rule.
const REDIS_URI_PATTERN = /^rediss?:\/\/(?:[^@/]*@)?([^/:?]+)(?::(\d+))?/i;

function parseRedisTarget(uri, label) {
  const match = REDIS_URI_PATTERN.exec(uri);
  if (!match) {
    fail(
      `${label} is not a supported Redis URI form (expected redis:// or ` +
        `rediss://).`
    );
  }
  const host = match[1].toLowerCase();
  const port = match[2] ? Number(match[2]) : 6379;
  return { host, port };
}

const testRedisTarget = parseRedisTarget(
  testValues.TEST_REDIS_URL,
  "TEST_REDIS_URL"
);

if (ordinaryRedisUrl) {
  let ordinaryRedisTarget = null;
  try {
    ordinaryRedisTarget = parseRedisTarget(ordinaryRedisUrl, "REDIS_URL");
  } catch (err) {
    ordinaryRedisTarget = null;
  }
  if (
    ordinaryRedisTarget &&
    ordinaryRedisTarget.host === testRedisTarget.host &&
    ordinaryRedisTarget.port === testRedisTarget.port
  ) {
    fail(
      "TEST_REDIS_URL resolves to the same host and port as the ordinary " +
        "REDIS_URL target. Refusing to run."
    );
  }
}

// --- Step 5: every validation passed -- map onto the real variable names ---
process.env.NODE_ENV = "test";
process.env.MONGO_CONN = testValues.TEST_MONGO_CONN;
process.env.REDIS_URL = testValues.TEST_REDIS_URL;
process.env.JWT_SECRET = testValues.TEST_JWT_SECRET;
