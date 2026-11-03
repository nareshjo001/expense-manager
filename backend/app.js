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

// Request ID and metrics run FIRST, before helmet/cors/body parsing.
app.use(requestIdMiddleware);
app.use(requestMetricsMiddleware);


// Apply security headers before cross-origin and request parsing middleware.
app.use(helmet(createHelmetOptions()));
app.use(cors(createCorsOptions()));
app.use(express.json());


// Periodic aggregate metrics snapshot. g.
if (process.env.NODE_ENV !== "test") {
  startMetricsReporting();
}


// Routes
app.get("/", (req, res) => {
  res.send("Welcome! Connected to DB...");
});


// Health probes. Mounted BEFORE apiLimiter and without it: a probe runs every few seconds from the platform's own network, so rate limiting it.
app.use("/health", healthRouter);


// DO NOT point a platform health check at this endpoint.
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
