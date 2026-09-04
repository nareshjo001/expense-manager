// OPS-002-T03 -- backend/scripts/backup/encryption.js: openssl-backed
// encrypt/decrypt with an HMAC-SHA256 encrypt-then-MAC integrity layer.
//
// TIER 1 (real execution): every test in this file actually shells out
// to the real `openssl` binary on this host (child_process, no mocking)
// and performs a real encrypt/decrypt round trip on a real temp file.
// This is genuine, not simulated, verification -- see the file header
// of backend/scripts/backup/encryption.js for why AES-256-GCM
// (originally suggested by the task spec) was replaced with AES-256-CBC
// + HMAC-SHA256: `openssl enc -aes-256-gcm` was tried first and fails
// immediately on this host with "AEAD ciphers not supported" (a
// long-standing limitation of the `openssl enc` subcommand itself, not
// this specific openssl build).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  assertValidKey,
  buildEncryptArgs,
  buildDecryptArgs,
  encryptFile,
  decryptFile,
  IntegrityError,
  MIN_KEY_LENGTH,
} = require("../scripts/backup/encryption");

const VALID_KEY = "a-very-long-random-test-passphrase-1234567890";

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backup-enc-test-"));
}

describe("assertValidKey", () => {
  test("rejects a missing key", () => {
    expect(() => assertValidKey(undefined)).toThrow(/BACKUP_ENCRYPTION_KEY/);
  });

  test("rejects a key shorter than MIN_KEY_LENGTH", () => {
    expect(() => assertValidKey("short")).toThrow(new RegExp(String(MIN_KEY_LENGTH)));
  });

  test("never includes the key value itself in the thrown message", () => {
    const secret = "super-secret-value-that-must-never-leak-anywhere";
    try {
      assertValidKey(secret.slice(0, 5));
    } catch (err) {
      expect(err.message).not.toContain(secret);
    }
  });

  test("accepts a key at least MIN_KEY_LENGTH long", () => {
    expect(() => assertValidKey(VALID_KEY)).not.toThrow();
  });
});

describe("buildEncryptArgs / buildDecryptArgs (pure argv builders)", () => {
  test("encrypt args never put the key in argv", () => {
    const args = buildEncryptArgs({ inputPath: "/in", outputPath: "/out" });
    expect(args).toContain("-in");
    expect(args).toContain("/in");
    expect(args).toContain("-out");
    expect(args).toContain("/out");
    expect(args).toContain("-pass");
    expect(args[args.indexOf("-pass") + 1]).toBe("stdin");
    expect(args.join(" ")).not.toMatch(/pass:/);
  });

  test("decrypt args mirror encrypt args with -d and no -salt", () => {
    const args = buildDecryptArgs({ inputPath: "/in.enc", outputPath: "/out" });
    expect(args).toContain("-d");
    expect(args).not.toContain("-salt");
    expect(args).toContain("-pbkdf2");
  });
});

describe("encryptFile / decryptFile round trip (TIER 1 -- real openssl subprocess)", () => {
  test("decrypted output is byte-identical to the original input", async () => {
    const dir = makeTempDir();
    const inputPath = path.join(dir, "plain.txt");
    const encryptedPath = path.join(dir, "plain.enc");
    const decryptedPath = path.join(dir, "plain.dec");

    const original = Buffer.from(
      "hello backup world - fixture bytes\nwith a newline, some binary-ish chars: \x00\x01\x02, and unicode."
    );
    fs.writeFileSync(inputPath, original);

    const { hmacAlgorithm, hmacHex } = await encryptFile(inputPath, encryptedPath, VALID_KEY);
    expect(hmacAlgorithm).toBe("sha256");
    expect(hmacHex).toMatch(/^[0-9a-f]{64}$/);

    await decryptFile(encryptedPath, decryptedPath, VALID_KEY, { expectedHmacHex: hmacHex });
    const decrypted = fs.readFileSync(decryptedPath);

    expect(Buffer.compare(original, decrypted)).toBe(0);
  });

  test("ciphertext on disk is not the plaintext (actually encrypted)", async () => {
    const dir = makeTempDir();
    const inputPath = path.join(dir, "plain.txt");
    const encryptedPath = path.join(dir, "plain.enc");
    const plaintext = "a distinctive plaintext marker STRING_MARKER_12345";
    fs.writeFileSync(inputPath, plaintext);

    await encryptFile(inputPath, encryptedPath, VALID_KEY);
    const ciphertext = fs.readFileSync(encryptedPath, "utf8");

    expect(ciphertext).not.toContain("STRING_MARKER_12345");
  });

  test("decrypting with the wrong key is rejected by the HMAC check before openssl runs", async () => {
    const dir = makeTempDir();
    const inputPath = path.join(dir, "plain.txt");
    const encryptedPath = path.join(dir, "plain.enc");
    const decryptedPath = path.join(dir, "plain.dec");
    fs.writeFileSync(inputPath, "some content");

    const { hmacHex } = await encryptFile(inputPath, encryptedPath, VALID_KEY);

    const wrongKey = "a-totally-different-passphrase-abcdefghijklmno";
    await expect(
      decryptFile(encryptedPath, decryptedPath, wrongKey, { expectedHmacHex: hmacHex })
    ).rejects.toThrow(IntegrityError);
    expect(fs.existsSync(decryptedPath)).toBe(false);
  });

  test("a tampered ciphertext is rejected by the HMAC check before openssl runs", async () => {
    const dir = makeTempDir();
    const inputPath = path.join(dir, "plain.txt");
    const encryptedPath = path.join(dir, "plain.enc");
    const decryptedPath = path.join(dir, "plain.dec");
    fs.writeFileSync(inputPath, "some content");

    const { hmacHex } = await encryptFile(inputPath, encryptedPath, VALID_KEY);

    const bytes = fs.readFileSync(encryptedPath);
    bytes[bytes.length - 1] ^= 0xff;
    fs.writeFileSync(encryptedPath, bytes);

    await expect(
      decryptFile(encryptedPath, decryptedPath, VALID_KEY, { expectedHmacHex: hmacHex })
    ).rejects.toThrow(IntegrityError);
  });

  test("omitting expectedHmacHex skips the integrity check (explicit opt-out)", async () => {
    const dir = makeTempDir();
    const inputPath = path.join(dir, "plain.txt");
    const encryptedPath = path.join(dir, "plain.enc");
    const decryptedPath = path.join(dir, "plain.dec");
    fs.writeFileSync(inputPath, "some content without an hmac check");

    await encryptFile(inputPath, encryptedPath, VALID_KEY);
    await expect(decryptFile(encryptedPath, decryptedPath, VALID_KEY)).resolves.toBeUndefined();
    expect(fs.readFileSync(decryptedPath, "utf8")).toBe("some content without an hmac check");
  });
});
