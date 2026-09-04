// Global fallback handler for errors passed to next() from any route.
const { logEvent } = require("../utils/logger");
const { reportError } = require("../utils/errorReporter");

// OBS-001-T03 -- structured, redacted error logging (replaces the previous
// raw console.error(err.stack), which could write stack traces/file paths
// straight to stdout with no allowlisting). The client-facing response
// contract is unchanged.
const errorHandler = (err, req, res, next) => {
  const context = {
    requestId: req?.requestId,
    route: req?.baseUrl || req?.path,
    method: req?.method,
    statusCode: err.statusCode || 500,
    errorCode: err.code,
    scope: "http",
    event: "unhandled_request_error",
  };

  logEvent({ level: "error", ...context });

  // OBS-001-T04 -- alongside (not instead of) the structured log above,
  // forward the same redaction-safe context to the error-aggregation
  // transport (no-op by default; see utils/errorReporter.js). Never throws.
  reportError(err, context);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;
