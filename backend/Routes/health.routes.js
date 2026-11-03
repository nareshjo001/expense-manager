"use strict";

// Liveness, readiness and dependency health as three separate questions, because a platform does three different things with the answers.
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");

const { isFirebaseAvailable } = require("../config/firebaseAdmin");
const { isRedisAvailable } = require("../config/redis");
const { resolveProcessRole } = require("../config/env");

const router = express.Router();

// ReadyState === 1 means "connected".
const MONGO_CONNECTED = 1;

function mongoStatus() {
  return mongoose.connection && mongoose.connection.readyState === MONGO_CONNECTED
    ? "up"
    : "down";
}

// A dependency probe must be bounded.
const DEPENDENCY_PROBE_TIMEOUT_MS = 3000;

async function mlStatus() {
  if (!process.env.ML_ROUTE) return "not_configured";
  try {
    await axios.get(`${process.env.ML_ROUTE}/`, { timeout: DEPENDENCY_PROBE_TIMEOUT_MS });
    return "up";
  } catch {
    return "down";
  }
}

// LIVENESS. No I/O, no dependencies, no awaits. If this handler runs at all,
// the answer is yes.
router.get("/live", (req, res) => {
  res.status(200).json({
    success: true,
    status: "live",
    role: resolveProcessRole(),
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

// READINESS. Mongo only -- see the header for why Redis and ML are excluded.
router.get("/ready", (req, res) => {
  const mongo = mongoStatus();
  const ready = mongo === "up";

  res.status(ready ? 200 : 503).json({
    success: ready,
    status: ready ? "ready" : "not_ready",
    mongo,
  });
});

// DEPENDENCIES. Always 200; the body carries the truth.
router.get("/deps", async (req, res) => {
  const [ml] = await Promise.all([mlStatus()]);

  const dependencies = {
    // Required for correctness.
    mongo: mongoStatus(),
    // Disposable: absence degrades, never fails (ADR-0002).
    redis: isRedisAvailable() ? "up" : "down",
    // Optional capabilities.
    ml,
    push: isFirebaseAvailable() ? "up" : "not_configured",
  };

  res.status(200).json({
    success: true,
    role: resolveProcessRole(),
    dependencies,
    // Named so a reader does not have to know which of the above are
    // load-bearing. "degraded" is a normal, servable state.
    status: dependencies.mongo === "up" ? "serving" : "degraded",
  });
});

module.exports = router;
