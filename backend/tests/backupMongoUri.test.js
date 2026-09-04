// OPS-002-T03/T05 -- backend/scripts/backup/mongoUri.js: db-name
// extraction from a connection string, and the temp Mongo `--config`
// YAML file this module writes so a credential-bearing connection
// string never appears as a plain CLI argument. writeTempMongoConfig /
// withTempMongoConfig write real files to a real temp directory (Tier 1
// for the filesystem mechanics) -- no live Mongo is involved.
"use strict";

const fs = require("fs");

const { extractDbName, writeTempMongoConfig, cleanupTempMongoConfig, withTempMongoConfig } = require("../scripts/backup/mongoUri");

describe("extractDbName", () => {
  test("extracts the db name from a simple standalone connection string", () => {
    expect(extractDbName("mongodb://127.0.0.1:27017/expense_manager")).toBe("expense_manager");
  });

  test("extracts the db name when query params are present", () => {
    expect(extractDbName("mongodb://user:pass@host:27017/mydb?retryWrites=true&w=majority")).toBe("mydb");
  });

  test("extracts the db name from a multi-host replica-set connection string", () => {
    expect(extractDbName("mongodb://h1:27017,h2:27017,h3:27017/mydb?replicaSet=rs0")).toBe("mydb");
  });

  test("extracts the db name from a mongodb+srv connection string", () => {
    expect(extractDbName("mongodb+srv://user:pass@cluster0.example.mongodb.net/proddb?retryWrites=true")).toBe("proddb");
  });

  test("returns null for an empty or missing connection string", () => {
    expect(extractDbName("")).toBeNull();
    expect(extractDbName(undefined)).toBeNull();
    expect(extractDbName(null)).toBeNull();
  });

  test("returns null when there is no db name segment", () => {
    expect(extractDbName("mongodb://127.0.0.1:27017")).toBeNull();
    expect(extractDbName("mongodb://127.0.0.1:27017/")).toBeNull();
  });

  test("URL-decodes a percent-encoded db name", () => {
    expect(extractDbName("mongodb://127.0.0.1:27017/my%20db")).toBe("my db");
  });
});

describe("writeTempMongoConfig / cleanupTempMongoConfig", () => {
  test("writes a YAML file containing the uri, mode 0600, and cleans it up", () => {
    const conn = "mongodb://user:pass@127.0.0.1:27017/testdb";
    const temp = writeTempMongoConfig(conn);

    expect(fs.existsSync(temp.filePath)).toBe(true);
    const content = fs.readFileSync(temp.filePath, "utf8");
    expect(content).toContain(conn);
    expect(content.startsWith("uri:")).toBe(true);

    // Windows/NTFS has no POSIX rwx permission model -- Node's fs mode
    // argument is only meaningful on POSIX filesystems there, so
    // fs.statSync().mode on Windows reports 0o666 for a writable file
    // regardless of what mode writeFileSync was called with (this is a
    // documented Node/libuv limitation, not a bug in writeTempMongoConfig --
    // the real CI target, GitHub Actions' ubuntu-latest runners, is POSIX
    // and does enforce 0600 there, which is what actually matters for the
    // credential-bearing temp file this writes).
    if (process.platform !== "win32") {
      const mode = fs.statSync(temp.filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    cleanupTempMongoConfig(temp);
    expect(fs.existsSync(temp.filePath)).toBe(false);
    expect(fs.existsSync(temp.dir)).toBe(false);
  });

  test("strips embedded newlines defensively (no multi-line YAML injection)", () => {
    const temp = writeTempMongoConfig("mongodb://127.0.0.1:27017/db\nmalicious: true");
    const content = fs.readFileSync(temp.filePath, "utf8");
    expect(content.split("\n")).toHaveLength(2); // the uri line + trailing newline only
    cleanupTempMongoConfig(temp);
  });

  test("escapes embedded double quotes", () => {
    const temp = writeTempMongoConfig('mongodb://127.0.0.1:27017/db?x="quoted"');
    const content = fs.readFileSync(temp.filePath, "utf8");
    expect(content).toContain('\\"quoted\\"');
    cleanupTempMongoConfig(temp);
  });

  test("cleanupTempMongoConfig never throws even if called twice", () => {
    const temp = writeTempMongoConfig("mongodb://127.0.0.1:27017/db");
    cleanupTempMongoConfig(temp);
    expect(() => cleanupTempMongoConfig(temp)).not.toThrow();
  });
});

describe("withTempMongoConfig", () => {
  test("passes a valid config file path to fn and cleans up on success", async () => {
    let capturedPath;
    await withTempMongoConfig("mongodb://127.0.0.1:27017/testdb", async (configPath) => {
      capturedPath = configPath;
      expect(fs.existsSync(configPath)).toBe(true);
    });
    expect(fs.existsSync(capturedPath)).toBe(false);
  });

  test("cleans up even when fn throws", async () => {
    let capturedPath;
    await expect(
      withTempMongoConfig("mongodb://127.0.0.1:27017/testdb", async (configPath) => {
        capturedPath = configPath;
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(fs.existsSync(capturedPath)).toBe(false);
  });

  test("returns fn's resolved value", async () => {
    const result = await withTempMongoConfig("mongodb://127.0.0.1:27017/testdb", async () => 42);
    expect(result).toBe(42);
  });
});
