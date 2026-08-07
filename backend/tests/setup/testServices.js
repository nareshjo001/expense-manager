// Real MongoDB + Redis connect/disconnect helpers for the M0-2 integration
// suite. Deliberately reuses the application's own config/db.js and
// config/redis.js verbatim -- no separate connection object is created, so
// the same Mongoose models and the same Redis singleton `app.js` uses are
// the ones these tests observe (see the M0-T investigation for why a
// second, parallel connection would silently not be shared with the
// application's models/cache layer).
//
// Only ever called from the one consolidated integration test file's own
// beforeAll/afterAll -- no connection or module state is shared across
// separate Jest test files.
"use strict";

const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const { redisClient, connectRedis } = require("../../config/redis");

// Connects MongoDB first, then Redis. If Redis fails to connect AFTER
// MongoDB already succeeded, MongoDB is closed again before the error is
// rethrown -- never leaves a half-connected state sitting open.
async function connect() {
  await connectDB();

  try {
    await connectRedis();
  } catch (err) {
    await mongoose.connection.close().catch(() => {});
    throw err;
  }
}

// Safe to call even if connect() never ran, or partially ran -- checks each
// client's own state before attempting to close it.
async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close().catch(() => {});
  }
  if (redisClient.isOpen) {
    await redisClient.quit().catch(() => {});
  }
}

module.exports = { connect, disconnect, redisClient };
