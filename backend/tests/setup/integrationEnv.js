// Jest `setupFiles` module for the M0-2 integration suite ONLY (wired via
"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Resolved relative to THIS file's location (backend/tests/setup/), not the
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
