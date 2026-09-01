// Unit tests for the Workstream 2 (voice input) additions to
"use strict";

const ENV_KEYS = [
  "SIA_VOICE_ENABLED",
  "SIA_STT_PROVIDER",
  "SIA_STT_MODEL",
  "SIA_STT_TIMEOUT_MS",
  "SIA_STT_MAX_BYTES",
  "SIA_STT_MAX_DURATION_SECONDS",
];

let originalEnv;

beforeAll(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
  }
});

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
}

afterEach(() => {
  restoreEnv();
  jest.resetModules();
});

afterAll(() => {
  restoreEnv();
});

function loadConfig() {
  jest.resetModules();
  return require("../sia/config");
}

describe("backend/sia/config -- voice input (Workstream 2)", () => {
  describe("voiceEnabled", () => {
    it("defaults to false when SIA_VOICE_ENABLED is absent", () => {
      expect(loadConfig().voiceEnabled).toBe(false);
    });

    it('is true only when SIA_VOICE_ENABLED is exactly "true"', () => {
      process.env.SIA_VOICE_ENABLED = "true";
      expect(loadConfig().voiceEnabled).toBe(true);
    });

    it.each(["TRUE", "1", "yes"])("stays false for %s (not exactly \"true\")", (value) => {
      process.env.SIA_VOICE_ENABLED = value;
      expect(loadConfig().voiceEnabled).toBe(false);
    });

    it('trims surrounding whitespace before comparing, matching normalizeEnabled()\'s existing behavior', () => {
      process.env.SIA_VOICE_ENABLED = "  true  ";
      expect(loadConfig().voiceEnabled).toBe(true);
    });

    it("is independent of SIA_ENABLED -- neither flag affects the other's config value", () => {
      process.env.SIA_ENABLED = "true";
      process.env.SIA_VOICE_ENABLED = "false";
      const config = loadConfig();
      expect(config.enabled).toBe(true);
      expect(config.voiceEnabled).toBe(false);
      delete process.env.SIA_ENABLED;
    });
  });

  describe("sttProvider", () => {
    it('defaults to "groq" when SIA_STT_PROVIDER is absent (unlike SIA_LLM_PROVIDER, which defaults to null)', () => {
      expect(loadConfig().sttProvider).toBe("groq");
    });

    it("defaults to \"groq\" for a blank value", () => {
      process.env.SIA_STT_PROVIDER = "   ";
      expect(loadConfig().sttProvider).toBe("groq");
    });

    it("returns a configured provider, trimmed", () => {
      process.env.SIA_STT_PROVIDER = "  future-provider  ";
      expect(loadConfig().sttProvider).toBe("future-provider");
    });
  });

  describe("sttModel", () => {
    it('defaults to "whisper-large-v3-turbo" when SIA_STT_MODEL is absent', () => {
      expect(loadConfig().sttModel).toBe("whisper-large-v3-turbo");
    });

    it("defaults for a blank value", () => {
      process.env.SIA_STT_MODEL = "   ";
      expect(loadConfig().sttModel).toBe("whisper-large-v3-turbo");
    });

    it("returns a configured model, trimmed", () => {
      process.env.SIA_STT_MODEL = "  whisper-large-v3  ";
      expect(loadConfig().sttModel).toBe("whisper-large-v3");
    });
  });

  describe("sttTimeoutMs", () => {
    it("defaults to 30000 when absent", () => {
      expect(loadConfig().sttTimeoutMs).toBe(30000);
    });

    it("converts a configured valid timeout to a number", () => {
      process.env.SIA_STT_TIMEOUT_MS = "15000";
      const config = loadConfig();
      expect(config.sttTimeoutMs).toBe(15000);
      expect(typeof config.sttTimeoutMs).toBe("number");
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
      ["non-numeric", "fast"],
      ["zero", "0"],
      ["negative", "-100"],
    ])("falls back to the default timeout when the value is %s", (_label, value) => {
      if (value === undefined) delete process.env.SIA_STT_TIMEOUT_MS;
      else process.env.SIA_STT_TIMEOUT_MS = value;
      expect(loadConfig().sttTimeoutMs).toBe(30000);
    });
  });

  describe("sttMaxBytes", () => {
    it("defaults to 5242880 (5 MiB) when absent", () => {
      expect(loadConfig().sttMaxBytes).toBe(5242880);
    });

    it("converts a configured valid value to a number", () => {
      process.env.SIA_STT_MAX_BYTES = "1048576";
      const config = loadConfig();
      expect(config.sttMaxBytes).toBe(1048576);
      expect(typeof config.sttMaxBytes).toBe("number");
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
      ["non-numeric", "big"],
      ["zero", "0"],
      ["negative", "-5"],
    ])("falls back to the default when the value is %s", (_label, value) => {
      if (value === undefined) delete process.env.SIA_STT_MAX_BYTES;
      else process.env.SIA_STT_MAX_BYTES = value;
      expect(loadConfig().sttMaxBytes).toBe(5242880);
    });
  });

  describe("sttMaxDurationSeconds", () => {
    it("defaults to 45 when absent", () => {
      expect(loadConfig().sttMaxDurationSeconds).toBe(45);
    });

    it("converts a configured valid value to a number", () => {
      process.env.SIA_STT_MAX_DURATION_SECONDS = "60";
      const config = loadConfig();
      expect(config.sttMaxDurationSeconds).toBe(60);
      expect(typeof config.sttMaxDurationSeconds).toBe("number");
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
      ["non-numeric", "long"],
      ["zero", "0"],
      ["negative", "-10"],
    ])("falls back to the default when the value is %s", (_label, value) => {
      if (value === undefined) delete process.env.SIA_STT_MAX_DURATION_SECONDS;
      else process.env.SIA_STT_MAX_DURATION_SECONDS = value;
      expect(loadConfig().sttMaxDurationSeconds).toBe(45);
    });
  });

  it("importing with no SIA_VOICE_*/SIA_STT_* variables set is always safe and yields documented defaults", () => {
    expect(() => loadConfig()).not.toThrow();
    const config = loadConfig();
    expect(config).toMatchObject({
      voiceEnabled: false,
      sttProvider: "groq",
      sttModel: "whisper-large-v3-turbo",
      sttTimeoutMs: 30000,
      sttMaxBytes: 5242880,
      sttMaxDurationSeconds: 45,
    });
  });
});
