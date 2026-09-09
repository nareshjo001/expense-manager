"use strict";

// OPS-004-T06 -- secret/config validation with startup fail-fast.
//
// The backend reads 31 environment variables and validated none of them at
// startup. A missing JWT_SECRET did not stop the process; it surfaced later
// as a failed login. A missing MONGO_CONN surfaced as a connection error
// several frames deep. A typo'd REDIS_URL surfaced as degraded caching
// nobody noticed. Each of those is the same bug -- a deployment that is
// misconfigured but running -- and each is far more expensive to diagnose
// after traffic arrives than at boot.
//
// The rule this file enforces: if a variable is REQUIRED for the process to
// do its job correctly, the process refuses to start without it. Anything
// else is optional, and its absence is reported once at startup as a
// disabled capability rather than left to be discovered.
//
// Why not a schema library: adding one to validate 31 strings would be a new
// production dependency for something ~120 lines of explicit code does more
// readably, and every rule here is a plain predicate a reviewer can check.
const { logEvent } = require("../utils/logger");

// A secret short enough to brute-force is worse than an obviously absent
// one, because it looks configured. 32 characters is the floor for the
// signing secrets; it is not a strength check, just a "this is clearly not
// a placeholder like 'secret' or 'changeme'" bar.
const MIN_SECRET_LENGTH = 32;

const isNonEmpty = (v) => typeof v === "string" && v.trim() !== "";
const isLongSecret = (v) => isNonEmpty(v) && v.trim().length >= MIN_SECRET_LENGTH;
const isUrl = (v, protocols) => {
  if (!isNonEmpty(v)) return false;
  try {
    return protocols.includes(new URL(v.trim()).protocol.replace(":", ""));
  } catch {
    return false;
  }
};

// REQUIRED EVERYWHERE. Without any of these the process cannot serve a
// correct request, so it must not start.
const REQUIRED = [
  {
    name: "MONGO_CONN",
    check: (v) => isUrl(v, ["mongodb", "mongodb+srv"]),
    why: "MongoDB is the authoritative store (ADR-0002). Must be a mongodb:// or mongodb+srv:// URL.",
  },
  {
    name: "JWT_SECRET",
    check: isLongSecret,
    why: `Signs access tokens. At least ${MIN_SECRET_LENGTH} characters -- a short secret looks configured while being forgeable.`,
  },
  {
    name: "REFRESH_TOKEN_SECRET",
    check: isLongSecret,
    why: `Signs refresh tokens. At least ${MIN_SECRET_LENGTH} characters, and MUST differ from JWT_SECRET.`,
  },
];

// REQUIRED IN PRODUCTION ONLY. Safe to omit locally, dangerous to omit in a
// deployed environment -- so this is enforced by NODE_ENV rather than by
// hoping someone remembers.
const REQUIRED_IN_PRODUCTION = [
  {
    name: "CORS_ALLOWED_ORIGINS",
    check: isNonEmpty,
    why: "Browser origin allowlist (SEC-001). Without it production CORS fails closed and the app cannot be used at all.",
  },
  {
    name: "REDIS_URL",
    check: (v) => isUrl(v, ["redis", "rediss"]),
    why: "Redis is disposable for correctness (ADR-0002) but required for cross-instance job leases (REC-001); without it every instance runs every scheduled job.",
  },
];

// OPTIONAL. Absence disables a capability. Reported once at startup so a
// deployment missing an integration is visible in the logs rather than
// discovered when a user hits the feature.
const OPTIONAL_CAPABILITIES = [
  { name: "FIREBASE_SERVICE_ACCOUNT", capability: "push notifications" },
  { name: "BREVO_API_KEY", capability: "transactional email (OTP, password reset)" },
  { name: "ML_ROUTE", capability: "ML category prediction and description generation" },
  { name: "SENTRY_DSN", capability: "error aggregation (OBS-001-T04)" },
  { name: "BACKUP_ENCRYPTION_KEY", capability: "encrypted backups (OPS-002)" },
];

// OPS-004-T05 -- which duties this process performs. Validated here rather
// than in server.js so a typo ("worker " with a trailing space, "workers")
// stops the deploy instead of silently producing a fleet where NOTHING runs
// the scheduled jobs -- the failure mode that is hardest to notice, because
// every instance is healthy and serving traffic.
const PROCESS_ROLES = ["web", "worker", "all"];

class ConfigValidationError extends Error {
  constructor(problems) {
    super(
      `Configuration invalid -- refusing to start.\n` +
        problems.map((p) => `  - ${p.name}: ${p.why}`).join("\n")
    );
    this.name = "ConfigValidationError";
    this.problems = problems;
  }
}

// Validates configuration. Throws ConfigValidationError listing EVERY
// problem, not just the first -- someone fixing a fresh deployment should
// see the whole list in one pass rather than rediscovering it one restart at
// a time.
//
// Secret VALUES are never logged or included in the error, only names.
function validateEnv(env = process.env, { isProduction = env.NODE_ENV === "production" } = {}) {
  const problems = [];

  for (const rule of REQUIRED) {
    if (!rule.check(env[rule.name])) problems.push(rule);
  }

  if (isProduction) {
    for (const rule of REQUIRED_IN_PRODUCTION) {
      if (!rule.check(env[rule.name])) problems.push(rule);
    }
  }

  // Distinct-secrets check: reusing one secret for both token types means a
  // leaked access token is also a valid refresh token, collapsing the whole
  // point of having two.
  if (
    isNonEmpty(env.JWT_SECRET) &&
    isNonEmpty(env.REFRESH_TOKEN_SECRET) &&
    env.JWT_SECRET.trim() === env.REFRESH_TOKEN_SECRET.trim()
  ) {
    problems.push({
      name: "REFRESH_TOKEN_SECRET",
      why: "must not be identical to JWT_SECRET -- otherwise a leaked access token is also a valid refresh token.",
    });
  }

  // PROCESS_ROLE is optional -- absent means "web", which is what a
  // single-process deployment has always effectively been. But a value that
  // is PRESENT and unrecognised is a typo, and the consequence of shrugging
  // at it is a fleet that runs no scheduled jobs at all.
  if (isNonEmpty(env.PROCESS_ROLE) && !PROCESS_ROLES.includes(env.PROCESS_ROLE.trim())) {
    problems.push({
      name: "PROCESS_ROLE",
      why: `must be one of ${PROCESS_ROLES.join(", ")} when set (omit it for "web").`,
    });
  }

  if (problems.length) throw new ConfigValidationError(problems);

  const disabled = OPTIONAL_CAPABILITIES.filter((c) => !isNonEmpty(env[c.name]));
  return {
    disabledCapabilities: disabled.map((c) => `${c.capability} (${c.name} not set)`),
    processRole: resolveProcessRole(env),
  };
}

// The role this process should perform.
//
// Absent means "all" -- HTTP *and* the scheduled jobs -- because that is
// exactly what every process did before OPS-004-T05, and the default has to
// be the behaviour-preserving one. Defaulting to "web" would have been the
// tidier-looking choice and the wrong one: a deployment that upgrades
// without setting anything would quietly stop running recurring expenses,
// push retries and ML feedback collection, with every instance still
// healthy and serving traffic. Splitting the roles is an opt-in a deployer
// makes by setting PROCESS_ROLE on both services, and the render.yaml
// blueprint (OPS-004-T02) sets it on both.
function resolveProcessRole(env = process.env) {
  const raw = isNonEmpty(env.PROCESS_ROLE) ? env.PROCESS_ROLE.trim() : "all";
  return PROCESS_ROLES.includes(raw) ? raw : "all";
}

// Does this process own the scheduled jobs? Exactly one role in a fleet
// should answer true, or the job leases (REC-001) are doing work that the
// topology should have prevented.
function runsScheduledJobs(env = process.env) {
  return resolveProcessRole(env) !== "web";
}

// Called from server.js before anything connects. Logs the disabled
// capabilities, then returns; throwing is the caller's signal to exit.
function assertValidEnv(env = process.env) {
  const { disabledCapabilities, processRole } = validateEnv(env);

  if (disabledCapabilities.length) {
    // logEvent's field sanitiser handles strings, numbers and booleans; an
    // array would reach it as String(array). Join here so the log line says
    // what it means rather than relying on that coercion.
    logEvent({
      level: "warn",
      scope: "config",
      event: "optional_capability_disabled",
      disabledCapabilities: disabledCapabilities.join("; "),
      disabledCount: disabledCapabilities.length,
    });
  }

  logEvent({
    level: "info",
    scope: "config",
    event: "config_validated",
    environment: env.NODE_ENV || "development",
    role: processRole,
  });

  return { disabledCapabilities, processRole };
}

module.exports = {
  assertValidEnv,
  validateEnv,
  resolveProcessRole,
  runsScheduledJobs,
  ConfigValidationError,
  MIN_SECRET_LENGTH,
  PROCESS_ROLES,
  REQUIRED,
  REQUIRED_IN_PRODUCTION,
  OPTIONAL_CAPABILITIES,
};
