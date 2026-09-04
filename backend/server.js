// Fix MongoDB Atlas SRV DNS resolution before anything else
const dns = require("dns");

dns.setServers([
  "8.8.8.8",
  "1.1.1.1"
]);

require("dotenv").config();

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

// Cron jobs
require("./cron/recurringJob");
require("./cron/retryPush");
require("./cron/feedbackCollector");

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

    await connectDB();

    await connectRedis();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });


  } catch (err) {

    console.error("Failed to start server:", err);

    reportError(err, { scope: "process", event: "startup_failed" });

    process.exit(1);
  }
};


startServer();
