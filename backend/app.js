const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const axios = require("axios");
const { isFirebaseAvailable } = require("./config/firebaseAdmin");
const { createCorsOptions, createHelmetOptions } = require("./config/httpSecurity");
const { requestIdMiddleware } = require("./Middlewares/requestId");
const { requestMetricsMiddleware, startMetricsReporting } = require("./utils/metrics");

// Routes
const authRouter = require("./Routes/auth.routes");
const apiRouter = require("./Routes/api.routes");
const expenseRouter = require("./Routes/expense.routes");
const incomeRouter = require("./Routes/income.routes");
const billRoutes = require("./Routes/bill.routes");
const mlRouter = require("./Routes/ml.router");
const reportRouter = require("./Routes/report.routes");
const chartRouter = require("./Routes/chart.routes");
const siaRouter = require("./Routes/sia.routes");

// Middleware
const errorHandler = require("./Middlewares/error.middleware");

// Rate limiting for authenticated API surfaces
const { apiLimiter } = require("./utils/rateLimiter");

// Create app
const app = express();


// Apply security headers before cross-origin and request parsing middleware.
app.use(helmet(createHelmetOptions()));
app.use(cors(createCorsOptions()));
app.use(express.json());

// OBS-001 -- correlation ID first (so every later log line can carry it),
// then request-latency/error metrics collection.
app.use(requestIdMiddleware);
app.use(requestMetricsMiddleware);

// Periodic aggregate metrics snapshot. Guarded against NODE_ENV === "test":
// startMetricsReporting()'s own internal guard only no-ops a *second* call
// within the SAME module instance (e.g. app.js required twice in one
// process) -- it does NOT help here, because Jest gives every test FILE a
// fresh module registry by default, so each of this suite's 100+ files that
// require app.js for supertest was spawning its OWN independent, uncleared
// setInterval (default 5 minutes, unref'd so it never blocks process exit,
// but still very much still firing). Under `--runInBand`, all those test
// files share one real process/event loop, so leaked timers from files that
// ran early in the suite start coming due partway through a long run and
// pile up for its remainder -- this is what the "Cannot log after tests are
// done" / metrics_snapshot console spam in a full `npm test` run was: dozens
// of these firing concurrently, not test flakiness. It also cost real
// event-loop time (each firing calls logEvent + evaluateAndDispatchAlerts),
// which is the most likely explanation for report.contract.test.js's one
// 401-response test occasionally exceeding its 5000ms Jest timeout during a
// full run despite finishing in under 2s every time it was run in isolation.
// Both tests/setup/testEnv.js and tests/setup/integrationEnv.js set
// NODE_ENV=test before any test file's own modules load, so this check is
// reliable for both `npm test` and `npm run test:integration`.
if (process.env.NODE_ENV !== "test") {
  startMetricsReporting();
}


// Routes
app.get("/", (req, res) => {
  res.send("Welcome! Connected to DB...");
});


app.get("/ping", async (req, res) => {
  // Firebase/push is an optional capability -- its status is reported
  const push = isFirebaseAvailable() ? "up" : "down";

  try {
    await axios.get(`${process.env.ML_ROUTE}/`);

    res.status(200).json({
      success: true,
      backend: "up",
      ml: "up",
      push
    });

  } catch (err) {
    res.status(503).json({
      success: false,
      backend: "up",
      ml: "down",
      push,
      message: "Server Unavailable."
    });
  }
});


// Authentication endpoints apply both IP and normalized-identity attempt limits.
// internally, so apiLimiter (which keys on req.userId) is not applied here.
app.use("/auth", authRouter);

// apiLimiter is keyed on req.userId (falling back to req.ip), so it is
// applied to the authenticated route groups only.
app.use("/api", apiLimiter, apiRouter);
app.use("/expense", apiLimiter, expenseRouter);
app.use("/bills", apiLimiter, billRoutes);
app.use("/ml", apiLimiter, mlRouter);
app.use("/report", apiLimiter, reportRouter);
app.use("/chart", apiLimiter, chartRouter);
app.use("/income", apiLimiter, incomeRouter);
app.use("/sia", apiLimiter, siaRouter);

// Error handler (must be last)
app.use(errorHandler);


module.exports = app;
