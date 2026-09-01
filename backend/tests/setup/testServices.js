// Real MongoDB + Redis connect/disconnect helpers for the M0-2 integration
"use strict";

const mongoose = require("mongoose");
const connectDB = require("../../config/db");
const { redisClient, connectRedis } = require("../../config/redis");

// Connects MongoDB first, then Redis. If Redis fails to connect AFTER
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
