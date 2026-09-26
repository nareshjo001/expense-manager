// dotenv first: the DNS override below reads its setting from .env, and it
// has to run before anything resolves a hostname.
// quiet: dotenv 17 otherwise prints an unstructured "injecting env" banner
// to stdout on every start (OBS-001-T03: every line is a JSON record).
require("dotenv").config({ quiet: true });

// This file used to begin with an unconditional
// dns.setServers(["8.8.8.8", "1.1.1.1"]) -- a local-network workaround that
// also took effect in production, where replacing the platform resolver can
// make every lookup fail with `querySrv ENOTFOUND`, indistinguishable from a
// wrong hostname. It is now opt-in via DNS_SERVERS; config/dns.js has the
// full reasoning.
require("./config/dns").applyDnsOverride();

// OBS-001-T04 -- process-level crash reporting. No uncaughtException/
// unhandledRejection handler existed here before; Node's own default for
// both (on this Node version) is already to log and exit -- these handlers
// preserve that same fail-fast outcome, but route the error through the
// error-aggregation reporter first (no-op by default; see
// utils/errorReporter.js) so a crash is reported with an environment tag
// before the process goes down. reportError() itself never throws.
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

// OPS-004-T06 -- validate configuration BEFORE anything connects or any cron
// is scheduled. A misconfigured deployment should fail at boot with a list of
// what is wrong, not at 3am with a failed login. assertValidEnv() throws
// ConfigValidationError naming every problem at once; it never logs a secret
// VALUE, only the variable name.
const { assertValidEnv, runsScheduledJobs, resolveProcessRole } = require("./config/env");
const { logEvent } = require("./utils/logger");

let processRole;
try {
  ({ processRole } = assertValidEnv());
} catch (err) {
  // Deliberately console.error and exit rather than routing through
  // reportError: at this point we do not know that SENTRY_DSN or anything
  // else is valid, and a config error must be readable in plain platform
  // logs by whoever is staring at a failing first deploy.
  console.error(err.message);
  process.exit(1);
}

// OPS-004-T05 -- only the process that OWNS the scheduled jobs loads them.
//
// These three modules call cron.schedule() at require time, so requiring
// them unconditionally meant every web instance scheduled every job. Scaling
// the web tier to three instances therefore scheduled three copies of each
// job. REC-001's Redis leases keep that from double-executing, but a lease
// is a safety net for a race that should not be happening at all -- and
// during a Redis outage the net is exactly what is missing. Ownership is a
// topology decision, so it belongs in the topology, not in a lock.
//
// PROCESS_ROLE defaults to "all" (see config/env.js), so a single-process
// deployment that sets nothing keeps running its jobs exactly as before.
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

    // Required. MongoDB is the authoritative store (ADR-0002); without it
    // the process cannot serve a correct request, so a failure here still
    // exits.
    await connectDB();

    // OPS-004-T04 -- disposable. connectRedis() no longer throws; it reports
    // whether it connected and the process continues either way. See
    // config/redis.js for why an unreachable cache must not be able to take
    // the whole backend down.
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

    // Name only, never the raw error: a startup failure object can carry a
    // connection string (see OBS-001-T01). reportError() below forwards the
    // redaction-safe detail.
    logEvent({ level: "error", scope: "process", event: "startup_failed", errorName: err && err.name });

    reportError(err, { scope: "process", event: "startup_failed" });

    process.exit(1);
  }
};


startServer();
