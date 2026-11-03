"use strict";

// Redis is a DISPOSABLE dependency, and startup now says so.
const { createClient } = require("redis");
const { logEvent } = require("../utils/logger");

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

// Log connection errors without crashing -- callers treat Redis as best-effort.
redisClient.on("error", (err) => {
  // Message` alone is EMPTY for a plain connection refusal, which is how this file previously produced twenty consecutive lines reading "Redis Error:" and nothing else -- twenty lines that named neither the host nor the reason.
  const detail =
    (err && (err.message || err.code)) ||
    (err && Array.isArray(err.errors) && err.errors.map((e) => e.code || e.message).join(",")) ||
    "unknown";
  logEvent({ level: "error", scope: "redis", event: "redis_client_error", detail });
});

// Truthful, not remembered.
function isRedisAvailable() {
  return Boolean(redisClient.isReady);
}

// How long startup will WAIT for Redis before serving without it.
const CONNECT_TIMEOUT_MS = 5000;

// Connects to Redis, waiting at most CONNECT_TIMEOUT_MS.
async function connectRedis() {
  const attempt = redisClient.connect();

  // The attempt outlives this function. exit(1), which would reintroduce "Redis takes the backend down" by the back door.
  attempt.catch(() => {});

  let timer;

  // Exit(1). Absorbing it here is what keeps every failure mode -- pending, rejected, or resolved-but-not-ready -- on the same degrade path.
  const outcome = await Promise.race([
    attempt.then(
      () => ({ settled: true }),
      (err) => ({ settled: true, error: err })
    ),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ settled: false }), CONNECT_TIMEOUT_MS);
      // Never let this timer be the reason the process stays alive.
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
  clearTimeout(timer);

  if (outcome.settled && !outcome.error && redisClient.isReady) {
    logEvent({ level: "info", scope: "redis", event: "redis_connected" });
    return { connected: true };
  }

  logEvent({
    level: "error",
    scope: "redis",
    event: "redis_unavailable_degraded",
    waitedMs: CONNECT_TIMEOUT_MS,
    reason: outcome.settled ? "connect_failed" : "connect_timed_out",
    errorMessage: outcome.error ? outcome.error.message || outcome.error.code : undefined,
    // Spelling out the consequences means whoever reads this line during an
    // incident does not have to go and derive them.
    impact: "caching disabled (reads fall through to MongoDB); scheduled jobs fail closed per REC-001-T03",
    recovery: "node-redis keeps retrying; /health/deps reports the live state",
  });

  return { connected: false, timedOut: !outcome.settled, error: outcome.error };
}

module.exports = {
  redisClient,
  connectRedis,
  isRedisAvailable,
};
