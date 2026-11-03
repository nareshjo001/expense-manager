// Env, and it has to run before anything resolves a hostname.
require("dotenv").config({ quiet: true });

// Node's default warning handler prints process warnings (deprecations, library notices such as Mongoose's) as plain text on stderr.
{
  const { logEvent: logWarning } = require("./utils/logger");
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    logWarning({
      level: "warn",
      scope: "process",
      event: "node_warning",
      warningName: warning && warning.name,
      code: warning && warning.code,
      message: warning && warning.message,
    });
  });
}

// 1"]) -- a local-network workaround that also took effect in production, where replacing the platform resolver can make every lookup fail with `querySrv ENOTFOUND`, indistinguishable from a wrong hostname.
require("./config/dns").applyDnsOverride();

// Process-level crash reporting. js) so a crash is reported with an environment tag before the process goes down.
const { reportError } = require("./utils/errorReporter");

process.on("uncaughtException", (err) => {
  reportError(err, { scope: "process", event: "uncaught_exception" });
  console.error("Uncaught exception:", err && err.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  reportError(err, { scope: "process", event: "unhandled_rejection" });
  console.error("Unhandled rejection:", err.message);
  process.exit(1);
});

// Validate configuration BEFORE anything connects or any cron is scheduled.
const { assertValidEnv, runsScheduledJobs, resolveProcessRole } = require("./config/env");
const { logEvent } = require("./utils/logger");

let processRole;
try {
  ({ processRole } = assertValidEnv());
} catch (err) {
  // Error and exit rather than routing through reportError: at this point we do not know that SENTRY_DSN or anything else is valid, and a config error must be readable in plain platform logs by whoever is staring at a failing first deploy.
  console.error(err.message);
  process.exit(1);
}

// Only the process that OWNS the scheduled jobs loads them.
if (runsScheduledJobs()) {
  require("./cron/recurringJob");
  require("./cron/retryPush");
  require("./cron/feedbackCollector");
  // PRV-001-T04 -- account-deletion purge cron (see cron/accountDeletionJob.js).
  require("./cron/accountDeletionJob");
  // NOT-003-T06 -- stale device-token sweep (see cron/staleDeviceCleanup.js).
  require("./cron/staleDeviceCleanup");
  // DAT-004-T03 -- queued financial-export generation (see cron/exportGeneration.js).
  require("./cron/exportGeneration");
  // DAT-004-T06 -- expired financial-export cleanup (see cron/exportCleanup.js).
  require("./cron/exportCleanup");
  // OCR-004-T07 -- unlinked receipt retention sweep (see cron/receiptRetention.js).
  require("./cron/receiptRetention");
  // IMP-001 -- uncommitted CSV import session retention sweep (see cron/importSessionRetention.js).
  require("./cron/importSessionRetention");
}

// Express application (routes, middleware) -- see app.js
const app = require("./app");

// Database
const connectDB = require("./config/db");

// Redis
const { connectRedis } = require("./config/redis");

// Port
const PORT = process.env.PORT || 8080;


// Start Server
const startServer = async () => {
  try {

    // Required. MongoDB is the authoritative store (ADR-0002); without it the process cannot serve a correct request, so a failure here still exit.
    await connectDB();

    // Disposable. connectRedis() no longer throws; it reports whether it connected and the process continues either way.
    const redis = await connectRedis();

    app.listen(PORT, "0.0.0.0", () => {
      logEvent({
        level: "info",
        scope: "process",
        event: "server_started",
        port: PORT,
        role: processRole || resolveProcessRole(),
        schedulesJobs: runsScheduledJobs(),
        redis: redis.connected ? "connected" : "degraded",
      });
    });


  } catch (err) {

    // Name, code and syscall only, never the raw error: a startup failure object can carry a connection string (see OBS-001-T01).
    logEvent({
      level: "error",
      scope: "process",
      event: "startup_failed",
      errorName: err && err.name,
      errorCode: err && err.code,
      errorSyscall: err && err.syscall,
    });

    reportError(err, { scope: "process", event: "startup_failed" });

    process.exit(1);
  }
};


startServer();
