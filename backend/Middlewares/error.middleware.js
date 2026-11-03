// Global fallback handler for errors passed to next() from any route.
const { logEvent } = require("../utils/logger");
const { reportError } = require("../utils/errorReporter");

// Stack), which could write stack traces/file paths straight to stdout with no allowlisting).
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

  // Js). Never throws. Never throws.
  reportError(err, context);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;
