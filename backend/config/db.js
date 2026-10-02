const mongoose = require('mongoose');
const { logEvent } = require('../utils/logger');

// Connect to MongoDB, rethrowing so server.js can fail fast on startup.
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_CONN);
    logEvent({ level: 'info', scope: 'mongo', event: 'db_connected' });
  } catch (err) {
    // Redaction-safe error metadata: a Mongo connection error message can echo
    // the host and user from MONGO_CONN, so message is excluded. Name, code and
    // syscall are safe error taxonomy that clarify DNS vs network vs auth failure.
    logEvent({
      level: 'error',
      scope: 'mongo',
      event: 'db_connection_failed',
      errorName: err && err.name,
      errorCode: err && err.code,
      errorSyscall: err && err.syscall,
    });
    throw err;
  }
};

module.exports = connectDB;