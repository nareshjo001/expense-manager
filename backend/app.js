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
// OPS-004-T03 -- liveness/readiness/dependency probes, kept separate from
// /ping. See Routes/health.routes.js for why they are three endpoints.
const healthRouter = require("./Routes/health.routes");

// Middleware
const errorHandler = require("./Middlewares/error.middleware");

// Rate limiting for authenticated API surfaces
const { apiLimiter } = require("./utils/rateLimiter");

// Create app
const app = express();

// OBS-001-T07 -- request ID and metrics run FIRST, before helmet/cors/body
// parsing. They used to be registered after express.json(), so a request
// rejected by the JSON parser (malformed body) never got an ID: its error
// log line carried requestId null, its response had no X-Request-ID, and it
// was missing from the request/error counts entirely. Found by
// scripts/verifyObservability.js.
app.use(requestIdMiddleware);
app.use(requestMetricsMiddleware);


// Apply security headers before cross-origin and request parsing middleware.
app.use(helmet(createHelmetOptions()));
app.use(cors(createCorsOptions()));
app.use(express.json());


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


// OPS-004-T03 -- health probes. Mounted BEFORE apiLimiter and without it:
// a probe runs every few seconds from the platform's own network, so rate
// limiting it would eventually start returning 429 to the health check and
// take a healthy instance out of rotation. These handlers take no user
// input and expose no user data.
app.use("/health", healthRouter);


// DO NOT point a platform health check at this endpoint. It returns 503 when
// the ML SERVICE is down, which would make the platform restart a backend
// that is working fine -- and restarting the backend cannot bring the ML
// service back. Use /health/live for restart checks and /health/ready for
// traffic routing (OPS-004-T03).
//
// This is kept unchanged, 503 and all, because the frontend and existing
// monitoring already call it and read that status code. Its meaning is
// "backend AND ML are both up", which is a useful thing for a human to ask;
// it is just not a liveness check.
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
