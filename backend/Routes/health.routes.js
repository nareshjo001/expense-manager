"use strict";

// OPS-004-T03 -- liveness, readiness and dependency health as three separate
// questions, because a platform does three different things with the answers.
//
// The problem this replaces: `/ping` was the only health-ish endpoint, and it
// returns 503 when the ML SERVICE is down. Point a platform health check at
// it and the platform will mark a perfectly healthy backend unhealthy and
// restart it -- because a *different*, optional service is down. Restarting
// the backend cannot fix the ML service, so the outcome is one degraded
// dependency turned into two outages. That is not a hypothetical: a health
// check is the first thing you configure on Render, and `/ping` is the
// obvious thing to point it at.
//
// The three questions, and who asks them:
//
//   /health/live  -- "is this process alive?" Asked by the platform's restart
//                    check. Answers from process state ONLY, never from a
//                    dependency, because the only correct response to a
//                    failed liveness check is "kill and restart this
//                    process", and no dependency outage is fixed by that.
//
//   /health/ready -- "should this instance receive traffic?" Asked by the
//                    load balancer / deploy gate. Depends on MongoDB alone,
//                    because Mongo is the authoritative store (ADR-0002) and
//                    without it essentially every route returns an error --
//                    so an instance that cannot reach Mongo should be taken
//                    out of rotation, but NOT restarted, since restarting
//                    does not bring Mongo back either.
//
//   /health/deps  -- "what is the state of everything we talk to?" Asked by
//                    a human, or a dashboard. ALWAYS returns 200, even when
//                    dependencies are down: the endpoint's job is to report
//                    status accurately, and a non-200 here would tempt
//                    someone to wire it to an automated action again. The
//                    status lives in the body, where it belongs.
//
// `/ping` stays exactly as it was, in app.js, and is deliberately untouched:
// the frontend and existing monitoring call it, and quietly changing what an
// endpoint's status code means is how you break a caller that was relying on
// the old meaning. It is now documented as a human-facing composite rather
// than something to attach automation to.
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");

const { isFirebaseAvailable } = require("../config/firebaseAdmin");
const { isRedisAvailable } = require("../config/redis");
const { resolveProcessRole } = require("../config/env");

const router = express.Router();

// mongoose.connection.readyState === 1 means "connected". This is read from
// the driver's own state rather than by issuing a ping command, because
// readiness is checked frequently (every few seconds, per instance) and a
// probe that itself puts load on the database is a probe that makes an
// overloaded database worse.
const MONGO_CONNECTED = 1;

function mongoStatus() {
  return mongoose.connection && mongoose.connection.readyState === MONGO_CONNECTED
    ? "up"
    : "down";
}

// A dependency probe must be bounded. Without a timeout, a hung ML service
// holds the health request open until the platform's own timeout fires,
// which reads as "the backend is unresponsive" rather than "the ML service
// is slow" -- the same category error /ping made, arrived at differently.
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
// Redis being down degrades caching and job coordination, both of which have
// documented fallbacks (ADR-0002, REC-001-T03); an instance in that state
// still serves correct responses and should keep its traffic.
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
