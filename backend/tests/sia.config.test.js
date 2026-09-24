// Unit tests for backend/sia/config.js and backend/sia/index.js.
"use strict";

const ENV_KEYS = [
  "SIA_ENABLED",
  "SIA_LLM_PROVIDER",
  "SIA_LLM_TIMEOUT_MS",
  "SIA_LLM_MODEL",
  "APP_TIME_ZONE",
  // SIA-001-T02 -- output-token/context budgets.
  "SIA_LLM_MAX_OUTPUT_TOKENS",
  "SIA_LLM_MAX_CONTEXT_CHARS",
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

describe("backend/sia/config", () => {
  it("returns all safe defaults when the SIA/APP_TIME_ZONE variables are absent", () => {
    delete process.env.SIA_ENABLED;
    delete process.env.SIA_LLM_PROVIDER;
    delete process.env.SIA_LLM_TIMEOUT_MS;
    delete process.env.SIA_LLM_MODEL;
    delete process.env.APP_TIME_ZONE;
    // SIA-001-T02 -- output-token/context budgets, additive.
    delete process.env.SIA_LLM_MAX_OUTPUT_TOKENS;
    delete process.env.SIA_LLM_MAX_CONTEXT_CHARS;
    // Workstream 2 -- voice input variables, additive.
    delete process.env.SIA_VOICE_ENABLED;
    delete process.env.SIA_STT_PROVIDER;
    delete process.env.SIA_STT_MODEL;
    delete process.env.SIA_STT_TIMEOUT_MS;
    delete process.env.SIA_STT_MAX_BYTES;
    delete process.env.SIA_STT_MAX_DURATION_SECONDS;

    const config = loadConfig();

    expect(config).toEqual({
      enabled: false,
      provider: null,
      timeoutMs: 8000,
      model: null,
      // SIA-001-T02 -- output-token/context budget defaults.
      maxOutputTokens: 1024,
      maxContextChars: 60000,
      appTimeZone: "Asia/Kolkata",
      // Workstream 2 -- voice input defaults, additive.
      voiceEnabled: false,
      sttProvider: "groq",
      sttModel: "whisper-large-v3-turbo",
      sttTimeoutMs: 30000,
      sttMaxBytes: 5242880,
      sttMaxDurationSeconds: 45,
    });
  });

  // Workstream 1 -- APP_TIME_ZONE, sia/periodResolver.js's timezone
  describe("appTimeZone", () => {
    it("defaults to Asia/Kolkata when APP_TIME_ZONE is absent", () => {
      delete process.env.APP_TIME_ZONE;
      expect(loadConfig().appTimeZone).toBe("Asia/Kolkata");
    });

    it("returns a valid configured IANA time zone unchanged", () => {
      process.env.APP_TIME_ZONE = "America/New_York";
      expect(loadConfig().appTimeZone).toBe("America/New_York");
    });

    it("trims a configured time zone", () => {
      process.env.APP_TIME_ZONE = "  UTC  ";
      expect(loadConfig().appTimeZone).toBe("UTC");
    });

    it("falls back to the default for a blank value", () => {
      process.env.APP_TIME_ZONE = "   ";
      expect(loadConfig().appTimeZone).toBe("Asia/Kolkata");
    });

    it("falls back to the default for an invalid/unrecognized IANA zone name", () => {
      process.env.APP_TIME_ZONE = "Not/A_Real_Zone";
      expect(loadConfig().appTimeZone).toBe("Asia/Kolkata");
    });
  });

  it('enables when SIA_ENABLED is exactly "true"', () => {
    process.env.SIA_ENABLED = "true";

    expect(loadConfig().enabled).toBe(true);
  });

  it("stays disabled for values that are not exactly \"true\"", () => {
    process.env.SIA_ENABLED = "TRUE";
    expect(loadConfig().enabled).toBe(false);

    process.env.SIA_ENABLED = "1";
    expect(loadConfig().enabled).toBe(false);

    process.env.SIA_ENABLED = "yes";
    expect(loadConfig().enabled).toBe(false);
  });

  it("returns the configured provider", () => {
    process.env.SIA_LLM_PROVIDER = "anthropic";

    expect(loadConfig().provider).toBe("anthropic");
  });

  it("converts a configured valid timeout to a number", () => {
    process.env.SIA_LLM_TIMEOUT_MS = "5000";

    const config = loadConfig();
    expect(config.timeoutMs).toBe(5000);
    expect(typeof config.timeoutMs).toBe("number");
  });

  it("blank provider becomes null", () => {
    process.env.SIA_LLM_PROVIDER = "   ";

    expect(loadConfig().provider).toBeNull();
  });

  it("returns null model when SIA_LLM_MODEL is missing", () => {
    delete process.env.SIA_LLM_MODEL;

    expect(loadConfig().model).toBeNull();
  });

  it("blank model becomes null", () => {
    process.env.SIA_LLM_MODEL = "   ";

    expect(loadConfig().model).toBeNull();
  });

  it("trims the configured model", () => {
    process.env.SIA_LLM_MODEL = "  gpt-4.1-mini  ";

    expect(loadConfig().model).toBe("gpt-4.1-mini");
  });

  it("returns the configured model unchanged when already trimmed", () => {
    process.env.SIA_LLM_MODEL = "gpt-4.1-mini";

    expect(loadConfig().model).toBe("gpt-4.1-mini");
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["non-numeric", "fast"],
    ["zero", "0"],
    ["negative", "-100"],
  ])("falls back to the default timeout when the value is %s", (_label, value) => {
    if (value === undefined) {
      delete process.env.SIA_LLM_TIMEOUT_MS;
    } else {
      process.env.SIA_LLM_TIMEOUT_MS = value;
    }

    expect(loadConfig().timeoutMs).toBe(8000);
  });

  // SIA-001-T02 -- output-token budget.
  describe("maxOutputTokens", () => {
    it("defaults to 1024 when SIA_LLM_MAX_OUTPUT_TOKENS is absent", () => {
      delete process.env.SIA_LLM_MAX_OUTPUT_TOKENS;
      expect(loadConfig().maxOutputTokens).toBe(1024);
    });

    it("converts a configured valid token count to a number", () => {
      process.env.SIA_LLM_MAX_OUTPUT_TOKENS = "512";
      const config = loadConfig();
      expect(config.maxOutputTokens).toBe(512);
      expect(typeof config.maxOutputTokens).toBe("number");
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
      ["non-numeric", "lots"],
      ["zero", "0"],
      ["negative", "-256"],
      ["non-integer", "512.5"],
    ])("falls back to the default when the value is %s", (_label, value) => {
      if (value === undefined) {
        delete process.env.SIA_LLM_MAX_OUTPUT_TOKENS;
      } else {
        process.env.SIA_LLM_MAX_OUTPUT_TOKENS = value;
      }
      expect(loadConfig().maxOutputTokens).toBe(1024);
    });
  });

  // SIA-001-T02 -- context budget.
  describe("maxContextChars", () => {
    it("defaults to 60000 when SIA_LLM_MAX_CONTEXT_CHARS is absent", () => {
      delete process.env.SIA_LLM_MAX_CONTEXT_CHARS;
      expect(loadConfig().maxContextChars).toBe(60000);
    });

    it("converts a configured valid character ceiling to a number", () => {
      process.env.SIA_LLM_MAX_CONTEXT_CHARS = "30000";
      const config = loadConfig();
      expect(config.maxContextChars).toBe(30000);
      expect(typeof config.maxContextChars).toBe("number");
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
      ["non-numeric", "big"],
      ["zero", "0"],
      ["negative", "-1000"],
    ])("falls back to the default when the value is %s", (_label, value) => {
      if (value === undefined) {
        delete process.env.SIA_LLM_MAX_CONTEXT_CHARS;
      } else {
        process.env.SIA_LLM_MAX_CONTEXT_CHARS = value;
      }
      expect(loadConfig().maxContextChars).toBe(60000);
    });

    it("accepts a non-integer positive character ceiling (unlike maxOutputTokens, no integer requirement)", () => {
      process.env.SIA_LLM_MAX_CONTEXT_CHARS = "30000.5";
      expect(loadConfig().maxContextChars).toBe(30000.5);
    });
  });

  it("does not throw when backend/sia/index.js is required", () => {
    expect(() => {
      jest.resetModules();
      require("../sia");
    }).not.toThrow();
  });
});
