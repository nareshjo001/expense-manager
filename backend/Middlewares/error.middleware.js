// Global fallback handler for errors passed to next() from any route.
const errorHandler = (err, req, res, next) => {
  console.error(err.stack || err);

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};

module.exports = errorHandler;