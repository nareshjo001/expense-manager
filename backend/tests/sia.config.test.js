// Unit tests for backend/sia/config.js and backend/sia/index.js.
//
// Pure environment-variable parsing -- no network, MongoDB, Redis,
// ML-service, or provider calls of any kind. Picked up by the default
// backend/jest.config.js (`npm test`), same as tests/report.route.smoke.test.js.
//
// Each case resets Jest's module registry and re-requires config.js, so it
// re-reads process.env fresh -- mirroring how a real process only reads its
// configuration once, at load time.
"use strict";

const ENV_KEYS = ["SIA_ENABLED", "SIA_LLM_PROVIDER", "SIA_LLM_TIMEOUT_MS", "SIA_LLM_MODEL"];

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
  it("returns all four safe defaults when the SIA variables are absent", () => {
    delete process.env.SIA_ENABLED;
    delete process.env.SIA_LLM_PROVIDER;
    delete process.env.SIA_LLM_TIMEOUT_MS;
    delete process.env.SIA_LLM_MODEL;

    const config = loadConfig();

    expect(config).toEqual({
      enabled: false,
      provider: null,
      timeoutMs: 8000,
      model: null,
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

  it("does not throw when backend/sia/index.js is required", () => {
    expect(() => {
      jest.resetModules();
      require("../sia");
    }).not.toThrow();
  });
});
