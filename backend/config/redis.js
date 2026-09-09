"use strict";

// OPS-004-T04 -- Redis is a DISPOSABLE dependency, and startup now says so.
//
// Before this change `connectRedis()` awaited `redisClient.connect()` with
// no catch, and server.js's startup try/catch turned any rejection into
// `process.exit(1)`. So an unreachable Redis took the whole backend down --
// no expenses, no logins, no reports -- even though ADR-0002 classifies
// Redis as a cache and coordination aid whose loss must degrade the system,
// not stop it. Every consumer already agreed with the ADR and not with
// server.js: utils/expenseCache.js and cache/reportCache.js swallow their
// errors and fall through to Mongo, and utils/jobLease.js has an explicit
// per-job fail-open/fail-closed policy for exactly this outage. The only
// component treating Redis as load-bearing was the one that could not
// degrade at all.
//
// On a managed host this mattered more than it looks. Upstash and Redis
// generally are the flakiest link in the deployment, and pairing "Redis
// blipped" with "the process exits" gives a crash-loop: the platform
// restarts, the restart fails on the same unreachable Redis, and the backend
// is down for the length of the Redis incident rather than degraded for it.
//
// What this file does now: it tries to connect, and if it cannot, it logs,
// reports, and returns. The process keeps serving. A background retry keeps
// attempting in case Redis comes back, and `isRedisAvailable()` gives
// /health/deps (OPS-004-T03) something truthful to report in the meantime.
const { createClient } = require("redis");
const { logEvent } = require("../utils/logger");

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

// Log connection errors without crashing -- callers treat Redis as best-effort.
//
// This handler is also load-bearing in a way that is easy to delete by
// accident: node-redis emits "error" on an EventEmitter, and an EventEmitter
// with no "error" listener THROWS the error as an uncaught exception. With
// the process-level uncaughtException handler in server.js, that would exit
// the process -- reintroducing the exact crash this task removes, by a
// different route.
redisClient.on("error", (err) => {
  console.error("Redis Error:", err && err.message);
});

// Truthful, not remembered. node-redis maintains `isReady` itself and flips
// it on disconnect and reconnect, so reading it is always current; a boolean
// we set ourselves at connect time would go stale the moment the connection
// dropped and would make /health/deps confidently wrong.
function isRedisAvailable() {
  return Boolean(redisClient.isReady);
}

// How long to wait before re-attempting a failed initial connection.
// node-redis's own reconnectStrategy covers a connection that dropped AFTER
// connecting; it does not cover a connect() that never succeeded, which is
// precisely the deploy-time case (Redis provisioned late, credentials rolled,
// Upstash cold). Without this, a backend that started before its Redis would
// stay cacheless and leaseless until someone redeployed it.
const RETRY_DELAY_MS = 30_000;

let retryTimer = null;

function scheduleRetry() {
  if (retryTimer) return;

  retryTimer = setInterval(async () => {
    if (redisClient.isReady || redisClient.isOpen) return;
    try {
      await redisClient.connect();
      logEvent({ level: "info", scope: "redis", event: "redis_reconnected" });
      clearInterval(retryTimer);
      retryTimer = null;
    } catch (err) {
      logEvent({ level: "warn", scope: "redis", event: "redis_reconnect_failed", errorMessage: err && err.message });
    }
  }, RETRY_DELAY_MS);

  // A retry loop must never be the reason the process stays alive.
  if (typeof retryTimer.unref === "function") retryTimer.unref();
}

// Connects to Redis. NEVER throws -- returns whether the connection
// succeeded so the caller can log it, and degrades if it did not.
//
// The return value is deliberately not ignored at the call site: startup
// logs which mode it came up in, so "cache is cold and jobs are skipping"
// is visible in the first ten lines of a deploy's logs rather than inferred
// later from a latency graph.
async function connectRedis() {
  try {
    await redisClient.connect();
    console.log("Redis Connected");
    logEvent({ level: "info", scope: "redis", event: "redis_connected" });
    return { connected: true };
  } catch (err) {
    logEvent({
      level: "error",
      scope: "redis",
      event: "redis_unavailable_degraded",
      errorMessage: err && err.message,
      // Spelling out the consequences here means whoever reads this line
      // during an incident does not have to go and derive them.
      impact: "caching disabled (reads fall through to MongoDB); scheduled jobs fail closed per REC-001-T03",
    });

    // Only retry when a URL was actually configured. Retrying against an
    // absent REDIS_URL would log a failure every 30s forever on a local
    // machine that never intended to run Redis.
    if (process.env.REDIS_URL) scheduleRetry();

    return { connected: false, error: err };
  }
}

module.exports = {
  redisClient,
  connectRedis,
  isRedisAvailable,
};
