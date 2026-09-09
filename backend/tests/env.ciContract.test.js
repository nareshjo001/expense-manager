// OPS-004-T06 -- the environments that actually launch `node server.js` must
// satisfy the startup validator.
//
// This test exists because the first version of the validator broke CI, and
// broke it in the slowest possible place: the E2E job spins up Mongo, Redis,
// three npm installs and a browser, and only then discovers that the backend
// refuses to start. That is a minute of CI to learn something a unit test can
// establish in milliseconds.
//
// The specific thing it caught was worth catching. The E2E config deliberately
// omitted REFRESH_TOKEN_SECRET, with a comment noting that
// Services/AuthServices/session.service.js falls back to JWT_SECRET when it is
// unset. That fallback is real, and it is the problem: refresh sessions get
// signed with the access-token secret, so a leaked access token is also a
// valid refresh token -- and because the fallback is silent, nothing ever
// says so. The fix was to give E2E two distinct secrets like a real
// deployment, not to relax the rule.
//
// Reading the config files as text is deliberate. Requiring playwright.config
// .js would pull in @playwright/test, which is not a backend dependency, and
// the point here is the declared values rather than the module's behaviour.
"use strict";

const fs = require("fs");
const path = require("path");

const { validateEnv } = require("../config/env");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CI_WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");
const PLAYWRIGHT_CONFIG = path.join(REPO_ROOT, "e2e", "playwright.config.js");

// Both files live outside the backend package. If this test ever runs against
// a checkout that does not include them, skip rather than fail -- a missing
// sibling directory is not a backend defect.
const filesPresent = fs.existsSync(CI_WORKFLOW) && fs.existsSync(PLAYWRIGHT_CONFIG);
const describeIfPresent = filesPresent ? describe : describe.skip;

describeIfPresent("environments that launch a real server satisfy validateEnv", () => {
  test("the CI end-to-end job supplies a valid configuration", () => {
    const workflow = fs.readFileSync(CI_WORKFLOW, "utf8");

    // The E2E job is the only one in this workflow that runs `node server.js`.
    // Its env block sets the same variable names the app reads.
    const read = (key) => {
      const match = workflow.match(new RegExp(`^\\s+${key}:\\s*(\\S+)\\s*$`, "m"));
      return match ? match[1] : undefined;
    };

    const env = {
      NODE_ENV: "test",
      MONGO_CONN: read("MONGO_CONN"),
      JWT_SECRET: read("JWT_SECRET"),
      REFRESH_TOKEN_SECRET: read("REFRESH_TOKEN_SECRET"),
    };

    expect(env.REFRESH_TOKEN_SECRET).toBeDefined();
    expect(() => validateEnv(env, { isProduction: false })).not.toThrow();
  });

  test("the Playwright config's fallback values are a valid configuration", () => {
    const config = fs.readFileSync(PLAYWRIGHT_CONFIG, "utf8");

    // Each is declared as `process.env.X || '<default>'`; the default is what
    // a developer running the suite locally without a .env actually gets, so
    // that is the value worth validating.
    const fallback = (key) => {
      const match = config.match(new RegExp(`process\\.env\\.${key}\\s*\\|\\|\\s*'([^']+)'`));
      return match ? match[1] : undefined;
    };

    const env = {
      NODE_ENV: "test",
      MONGO_CONN: fallback("MONGO_CONN"),
      JWT_SECRET: fallback("JWT_SECRET"),
      REFRESH_TOKEN_SECRET: fallback("REFRESH_TOKEN_SECRET"),
    };

    expect(env.REFRESH_TOKEN_SECRET).toBeDefined();
    expect(() => validateEnv(env, { isProduction: false })).not.toThrow();
  });

  test("neither environment reuses one secret for both token types", () => {
    // Stated separately from the validateEnv calls above because this is the
    // property that matters, and a future change that weakened the validator
    // would let the two tests above keep passing while this one fails.
    for (const file of [CI_WORKFLOW, PLAYWRIGHT_CONFIG]) {
      const text = fs.readFileSync(file, "utf8");
      const jwt = text.match(/JWT_SECRET[:\s|']*['"]?([\w-]{16,})/);
      const refresh = text.match(/REFRESH_TOKEN_SECRET[:\s|']*['"]?([\w-]{16,})/);

      expect(refresh).not.toBeNull();
      expect(refresh[1]).not.toBe(jwt && jwt[1]);
    }
  });
});
