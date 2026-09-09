// OPS-004-T06 -- startup configuration validation.
"use strict";

const {
  validateEnv,
  resolveProcessRole,
  runsScheduledJobs,
  ConfigValidationError,
  MIN_SECRET_LENGTH,
} = require("../config/env");

const LONG_A = "a".repeat(MIN_SECRET_LENGTH);
const LONG_B = "b".repeat(MIN_SECRET_LENGTH);

// A configuration that passes, so each test can remove exactly one thing and
// attribute the failure to that removal.
function validEnv(overrides = {}) {
  return {
    NODE_ENV: "development",
    MONGO_CONN: "mongodb://localhost:27017/balenisa",
    JWT_SECRET: LONG_A,
    REFRESH_TOKEN_SECRET: LONG_B,
    ...overrides,
  };
}

function problemNames(env, options) {
  try {
    validateEnv(env, options);
  } catch (err) {
    return err.problems.map((p) => p.name);
  }
  throw new Error("expected validateEnv to throw, but it did not");
}

describe("validateEnv -- required everywhere", () => {
  test("a complete configuration passes", () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
  });

  test("reports EVERY problem at once, not just the first", () => {
    // Someone fixing a fresh deployment should see the whole list in one
    // pass. Failing on the first missing variable turns a five-minute fix
    // into five deploy-and-rediscover cycles.
    const names = problemNames({ NODE_ENV: "development" });

    expect(names).toEqual(
      expect.arrayContaining(["MONGO_CONN", "JWT_SECRET", "REFRESH_TOKEN_SECRET"])
    );
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  test("rejects a MONGO_CONN that is not a mongodb URL", () => {
    expect(problemNames(validEnv({ MONGO_CONN: "localhost:27017" }))).toContain("MONGO_CONN");
    expect(problemNames(validEnv({ MONGO_CONN: "https://example.com" }))).toContain("MONGO_CONN");
  });

  test("accepts the mongodb+srv form Atlas issues", () => {
    expect(() =>
      validateEnv(validEnv({ MONGO_CONN: "mongodb+srv://u:p@cluster0.abcd.mongodb.net/db" }))
    ).not.toThrow();
  });

  test("rejects a signing secret short enough to look configured but be forgeable", () => {
    // "secret" and "changeme" are the values this rule exists to catch; an
    // absent secret is loud, a placeholder one is silent.
    expect(problemNames(validEnv({ JWT_SECRET: "secret" }))).toContain("JWT_SECRET");
    expect(problemNames(validEnv({ JWT_SECRET: "a".repeat(MIN_SECRET_LENGTH - 1) }))).toContain(
      "JWT_SECRET"
    );
  });

  test("treats a whitespace-only value as absent", () => {
    expect(problemNames(validEnv({ MONGO_CONN: "   " }))).toContain("MONGO_CONN");
  });

  test("rejects JWT_SECRET and REFRESH_TOKEN_SECRET being identical", () => {
    // Reusing one secret for both token types means a leaked access token is
    // also a valid refresh token, which collapses the reason for having two.
    const names = problemNames(validEnv({ JWT_SECRET: LONG_A, REFRESH_TOKEN_SECRET: LONG_A }));
    expect(names).toContain("REFRESH_TOKEN_SECRET");
  });
});

describe("validateEnv -- production-only rules", () => {
  test("CORS_ALLOWED_ORIGINS and REDIS_URL are optional outside production", () => {
    expect(() => validateEnv(validEnv(), { isProduction: false })).not.toThrow();
  });

  test("both are required in production", () => {
    const names = problemNames(validEnv({ NODE_ENV: "production" }), { isProduction: true });
    expect(names).toEqual(expect.arrayContaining(["CORS_ALLOWED_ORIGINS", "REDIS_URL"]));
  });

  test("production passes once they are supplied", () => {
    expect(() =>
      validateEnv(
        validEnv({
          NODE_ENV: "production",
          CORS_ALLOWED_ORIGINS: "https://balenisa.example",
          REDIS_URL: "rediss://default:token@fly-x.upstash.io:6379",
        }),
        { isProduction: true }
      )
    ).not.toThrow();
  });

  test("isProduction is derived from NODE_ENV when not passed explicitly", () => {
    expect(problemNames(validEnv({ NODE_ENV: "production" }))).toContain("CORS_ALLOWED_ORIGINS");
  });

  test("rejects a REDIS_URL that is not a redis URL", () => {
    const names = problemNames(
      validEnv({
        NODE_ENV: "production",
        CORS_ALLOWED_ORIGINS: "https://balenisa.example",
        REDIS_URL: "https://fly-x.upstash.io",
      }),
      { isProduction: true }
    );
    expect(names).toContain("REDIS_URL");
  });
});

describe("ConfigValidationError never discloses a secret value", () => {
  test("the message names variables, never their contents", () => {
    const secret = "SUPER-SECRET-VALUE-THAT-MUST-NOT-BE-LOGGED";

    let err;
    try {
      // Both secrets present, identical, and too short: two rules fire, so
      // the value passes through two different code paths into the message.
      validateEnv(validEnv({ JWT_SECRET: secret, REFRESH_TOKEN_SECRET: secret }));
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err.message).toContain("JWT_SECRET");
    expect(err.message).not.toContain(secret);
    expect(JSON.stringify(err.problems)).not.toContain(secret);
  });

  test("a valid-but-secret MONGO_CONN password is not echoed either", () => {
    const conn = "mongodb+srv://admin:hunter2hunter2@cluster0.mongodb.net/db";
    let err;
    try {
      validateEnv({ NODE_ENV: "development", MONGO_CONN: conn });
    } catch (e) {
      err = e;
    }
    expect(err.message).not.toContain("hunter2hunter2");
  });
});

describe("optional capabilities", () => {
  test("absent integrations are reported as disabled, not as failures", () => {
    const { disabledCapabilities } = validateEnv(validEnv());

    expect(disabledCapabilities.join(" ")).toContain("FIREBASE_SERVICE_ACCOUNT");
    expect(disabledCapabilities.join(" ")).toContain("ML_ROUTE");
  });

  test("a configured integration drops off the disabled list", () => {
    const { disabledCapabilities } = validateEnv(
      validEnv({ ML_ROUTE: "https://ml.example.com" })
    );
    expect(disabledCapabilities.join(" ")).not.toContain("ML_ROUTE");
  });
});

describe("PROCESS_ROLE (OPS-004-T05)", () => {
  test("defaults to 'all' so an existing single-process deploy keeps its cron jobs", () => {
    // This default is behaviour-preserving on purpose. Defaulting to "web"
    // would mean a deployment that upgrades without setting PROCESS_ROLE
    // silently stops running recurring expenses and push retries, while
    // every instance still looks healthy.
    expect(resolveProcessRole({})).toBe("all");
    expect(runsScheduledJobs({})).toBe(true);
  });

  test("'web' opts out of the scheduled jobs", () => {
    expect(runsScheduledJobs({ PROCESS_ROLE: "web" })).toBe(false);
  });

  test("'worker' runs them", () => {
    expect(runsScheduledJobs({ PROCESS_ROLE: "worker" })).toBe(true);
  });

  test("a typo'd role fails validation rather than being quietly ignored", () => {
    // The failure mode this prevents: PROCESS_ROLE="workers" on the worker
    // service falls back to a default, and depending on that default either
    // nothing runs the jobs or everything does. Both are invisible at a
    // glance because no instance is unhealthy.
    expect(problemNames(validEnv({ PROCESS_ROLE: "workers" }))).toContain("PROCESS_ROLE");
  });

  test("an unset role is not a validation problem", () => {
    expect(() => validateEnv(validEnv())).not.toThrow();
  });
});
