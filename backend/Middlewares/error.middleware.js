// Global fallback handler for errors passed to next() from any route.
const { logEvent } = require("../utils/logger");

// OBS-001-T03 -- structured, redacted error logging (replaces the previous
// raw console.error(err.stack), which could write stack traces/file paths
// straight to stdout with no allowlisting). The client-facing response
// contract is unchanged.
const errorHandler = (err, req, res, next) => {
  logEvent({
    level: "error",
    scope: "http",
    event: "unhandled_request_error",
    requestId: req?.requestId,
    route: req?.baseUrl || req?.path,
    method: req?.method,
    statusCode: err.statusCode || 500,
    errorCode: err.code,
  });

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;
