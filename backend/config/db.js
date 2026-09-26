const mongoose = require('mongoose');
const { logEvent } = require('../utils/logger');

// Connect to MongoDB, rethrowing so server.js can fail fast on startup.
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_CONN);
    logEvent({ level: 'info', scope: 'mongo', event: 'db_connected' });
  } catch (err) {
    // errorName only: a Mongo connection error message can echo the host
    // and user from MONGO_CONN.
    logEvent({ level: 'error', scope: 'mongo', event: 'db_connection_failed', errorName: err && err.name });
    throw err;
  }
};

module.exports = connectDB;