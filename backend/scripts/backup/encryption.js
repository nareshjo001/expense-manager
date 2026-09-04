"use strict";

// OPS-002-T03 -- OpenSSL-based encryption/decryption for backup
// archives.
//
// DESIGN NOTE -- deviates from the literal `openssl enc -aes-256-gcm`
// suggested in the task spec, and this deviation was confirmed by a
// real, live test on this dev host, not assumed: `openssl enc` (the CLI
// subcommand this module shells out to) does NOT support AEAD ciphers
// at all -- `openssl enc -aes-256-gcm ...` fails immediately with
// "enc: AEAD ciphers not supported" (openssl 3.0.2 here; this is a
// long-standing, version-independent limitation of the `enc` subcommand
// specifically -- it has no on-disk slot for an authentication tag --
// not something newer/older openssl fixes). Run `openssl enc -ciphers`
// or see the `enc` man page's cipher list to confirm the same on any
// other host.
//
// This module instead builds a real authenticated-encryption
// construction out of primitives `openssl enc` DOES support, so the
// actual security property the task asked for (confidentiality +
// tamper-evidence) is still delivered:
//   1. Confidentiality: `openssl enc -aes-256-cbc -pbkdf2` (still the
//      OpenSSL CLI, per the task's instruction to shell out to it).
//   2. Integrity/authentication: encrypt-then-MAC -- an HMAC-SHA256 over
//      the ciphertext, keyed by a value independently derived from the
//      same passphrase via PBKDF2 with a distinct, hardcoded salt
//      string (domain separation from whatever internal salt `openssl
//      enc -salt` picks for the cipher key). Computed with Node's
//      built-in `crypto` module -- not a new dependency, and it avoids
//      the argv-exposure problem entirely (openssl's `dgst -hmac` CLI
//      option takes its key as a plain CLI argument, which `ps aux`
//      would leak; Node's crypto computes the MAC in-process instead).
//      The MAC is verified BEFORE any decryption is attempted, so a
//      corrupted or tampered archive is rejected outright rather than
//      fed to openssl.
//
// The passphrase (BACKUP_ENCRYPTION_KEY) is NEVER passed as a CLI
// argument to openssl (`ps aux` would leak it) and NEVER logged -- it
// is piped to openssl's stdin via `-pass stdin`. This module never
// invents, stores, defaults, or reads the key from anywhere other than
// the argument its caller passes in -- same "vendor/credential is the
// owner's responsibility" pattern as backend/utils/errorReporter.js
// (SENTRY_DSN) and ml-service's config validation.
const crypto = require("crypto");
const fs = require("fs");
const { spawnProcess } = require("./processRunner");

const CIPHER = "aes-256-cbc";
const PBKDF2_ITERATIONS = 100000;
const MIN_KEY_LENGTH = 32;
const HMAC_ALGORITHM = "sha256";
// Fixed, public, non-secret domain-separation string -- NOT a secret by
// itself, only meaningful combined with the real passphrase via PBKDF2.
const HMAC_KEY_SALT = "expense-manager-backup-hmac-v1";

class IntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntegrityError";
  }
}

// Never interpolates the key itself into the thrown message.
function assertValidKey(key) {
  if (typeof key !== "string" || key.length < MIN_KEY_LENGTH) {
    throw new Error(
      `BACKUP_ENCRYPTION_KEY is missing or shorter than the required ${MIN_KEY_LENGTH} characters. ` +
        "Set it to a long, random passphrase -- this script never generates or stores one itself."
    );
  }
}

function deriveHmacKey(key) {
  return crypto.pbkdf2Sync(key, HMAC_KEY_SALT, PBKDF2_ITERATIONS, 32, "sha256");
}

// Streaming HMAC over a file -- never loads the whole archive into
// memory, so this scales to a dump much larger than this app's current
// data volume without a correctness or memory-pressure surprise later.
function computeHmacHex(filePath, key) {
  return new Promise((resolve, reject) => {
    const hmac = crypto.createHmac(HMAC_ALGORITHM, deriveHmacKey(key));
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hmac.update(chunk));
    stream.on("end", () => resolve(hmac.digest("hex")));
  });
}

async function verifyHmacHex(filePath, key, expectedHex) {
  const actualHex = await computeHmacHex(filePath, key);
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

// Pure argv builders -- unit-testable without spawning any process.
function buildEncryptArgs({ inputPath, outputPath }) {
  return [
    "enc",
    `-${CIPHER}`,
    "-salt",
    "-pbkdf2",
    "-iter",
    String(PBKDF2_ITERATIONS),
    "-pass",
    "stdin",
    "-in",
    inputPath,
    "-out",
    outputPath,
  ];
}

function buildDecryptArgs({ inputPath, outputPath }) {
  return [
    "enc",
    "-d",
    `-${CIPHER}`,
    "-pbkdf2",
    "-iter",
    String(PBKDF2_ITERATIONS),
    "-pass",
    "stdin",
    "-in",
    inputPath,
    "-out",
    outputPath,
  ];
}

// Encrypts inputPath -> outputPath, then computes an HMAC over the
// resulting ciphertext. Returns { hmacAlgorithm, hmacHex } for the
// caller to persist in the backup manifest -- this module deliberately
// does not write the manifest itself (see manifest.js).
async function encryptFile(inputPath, outputPath, key) {
  assertValidKey(key);
  await spawnProcess("openssl", buildEncryptArgs({ inputPath, outputPath }), { stdin: key });
  const hmacHex = await computeHmacHex(outputPath, key);
  return { hmacAlgorithm: HMAC_ALGORITHM, hmacHex };
}

// Verifies the ciphertext's HMAC (when `expectedHmacHex` is supplied)
// BEFORE attempting decryption, then decrypts inputPath -> outputPath.
// Throws IntegrityError (never attempting decryption) on a mismatch --
// a caller that omits expectedHmacHex explicitly opts out of that check
// (e.g. a manifest from before this field existed); every current
// caller in this codebase always supplies it.
async function decryptFile(inputPath, outputPath, key, { expectedHmacHex } = {}) {
  assertValidKey(key);
  if (expectedHmacHex) {
    const ok = await verifyHmacHex(inputPath, key, expectedHmacHex);
    if (!ok) {
      throw new IntegrityError(
        "Backup archive failed HMAC integrity verification -- refusing to decrypt. " +
          "The archive may be corrupted, tampered with, or encrypted with a different key."
      );
    }
  }
  await spawnProcess("openssl", buildDecryptArgs({ inputPath, outputPath }), { stdin: key });
}

module.exports = {
  CIPHER,
  PBKDF2_ITERATIONS,
  MIN_KEY_LENGTH,
  HMAC_ALGORITHM,
  IntegrityError,
  assertValidKey,
  deriveHmacKey,
  computeHmacHex,
  verifyHmacHex,
  buildEncryptArgs,
  buildDecryptArgs,
  encryptFile,
  decryptFile,
};
