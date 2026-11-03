"use strict";

// OpenSSL-based encryption/decryption for backup archives.
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

// Streaming HMAC over a file -- never loads the whole archive into memory, so this scales to a dump much larger than this app's current data volume without a correctness or memory-pressure surprise later.
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

// Encrypts inputPath -> outputPath, then computes an HMAC over the resulting ciphertext.
async function encryptFile(inputPath, outputPath, key) {
  assertValidKey(key);
  await spawnProcess("openssl", buildEncryptArgs({ inputPath, outputPath }), { stdin: key });
  const hmacHex = await computeHmacHex(outputPath, key);
  return { hmacAlgorithm: HMAC_ALGORITHM, hmacHex };
}

// Verifies the ciphertext's HMAC (when `expectedHmacHex` is supplied) BEFORE attempting decryption, then decrypts inputPath -> outputPath.
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
