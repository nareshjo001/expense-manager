"use strict";

// OPS-004-T04 -- Redis is a DISPOSABLE dependency, and startup now says so.
//
// ADR-0002 classifies Redis as a cache and coordination aid whose loss must
// degrade the system, not stop it. Every consumer already agreed:
// utils/expenseCache.js and cache/reportCache.js swallow their errors and
// fall through to Mongo, and utils/jobLease.js has an explicit per-job
// fail-open/fail-closed policy for exactly this outage. Startup was the only
// component treating Redis as load-bearing, and the only one that could not
// degrade at all.
//
// CORRECTION (2026-09-10). The first version of this file described the
// original bug as "connect() rejects and server.js exits", and fixed that.
// The description was wrong, so the fix did not work. What actually happens
// when Redis is absent is that connect() NEVER SETTLES -- see
// CONNECT_TIMEOUT_MS below -- so startup hung forever instead of exiting.
// The real behaviour was found by the OPS-002-T06 drill job, which is the
// first thing that ever booted this backend with no Redis at all; the unit
// test written alongside the first fix had mocked connect() as rejecting,
// which is precisely the failure mode node-redis does not have.
//
// On a managed host the hang is worse than an exit. An exit tells the
// platform to restart and shows up as a failed deploy; a hang gives a
// process that logs "DB Connected", never binds a port, never fails a
// health check it never answers, and looks like a slow start indefinitely.
//
// What this file does now: it waits a bounded time for Redis, then serves
// without it, while node-redis keeps retrying in the background so a late
// Redis is picked up without a redeploy. `isRedisAvailable()` gives
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
  // `err.message` alone is EMPTY for a plain connection refusal, which is how
  // this file previously produced twenty consecutive lines reading
  // "Redis Error:" and nothing else -- twenty lines that named neither the
  // host nor the reason. The code and the aggregated causes are what actually
  // identify it.
  const detail =
    (err && (err.message || err.code)) ||
    (err && Array.isArray(err.errors) && err.errors.map((e) => e.code || e.message).join(",")) ||
    "unknown";
  console.error("Redis Error:", detail);
});

// Truthful, not remembered. node-redis maintains `isReady` itself and flips
// it on disconnect and reconnect, so reading it is always current; a boolean
// we set ourselves at connect time would go stale the moment the connection
// dropped and would make /health/deps confidently wrong.
function isRedisAvailable() {
  return Boolean(redisClient.isReady);
}

// How long startup will WAIT for Redis before serving without it.
//
// This bound is the whole fix for a real startup hang, and the reason it is
// needed is a node-redis behaviour I got wrong the first time:
//
//   redisClient.connect() DOES NOT REJECT when there is no server to connect
//   to. The default reconnect strategy retries indefinitely, so the promise
//   stays PENDING forever.
//
// So `await connectRedis()` never settled and startup never reached
// app.listen(). The observable result was a process that logged "DB
// Connected", then an endless stream of connection errors, and never served a
// request -- with no error, no exit, and a platform health check that could
// never pass. That is worse than exiting: a crash at least tells the platform
// to restart and shows up as a failure.
//
// The earlier version of this file had a try/catch around the await and a
// 30-second retry timer, both of which were answers to the wrong question --
// they handle a REJECTION, and there is never one. Its unit test mocked
// connect() as rejecting immediately, which is exactly the failure mode
// node-redis does not have, so the test passed while the behaviour was
// broken. Removed rather than kept: node-redis's own strategy already retries
// the initial connection, so the timer was redundant even in principle, and
// calling connect() again while an attempt is pending throws.
const CONNECT_TIMEOUT_MS = 5000;

// Connects to Redis, waiting at most CONNECT_TIMEOUT_MS. NEVER throws and
// never hangs -- returns whether the connection was established in time.
//
// A timeout does NOT abandon the attempt: node-redis keeps retrying in the
// background, so a Redis that comes up late (provisioned after the backend,
// an Upstash cold start, rolled credentials) is picked up without a redeploy,
// and isRedisAvailable() starts returning true on its own.
//
// The return value is deliberately not ignored at the call site: startup logs
// which mode it came up in, so "cache is cold and jobs are skipping" is
// visible in the first ten lines of a deploy's log rather than inferred later
// from a latency graph.
async function connectRedis() {
  const attempt = redisClient.connect();

  // The attempt outlives this function. If it ever rejects with nobody
  // awaiting it, that is an unhandled rejection -- and server.js's
  // process-level handler turns those into process.exit(1), which would
  // reintroduce "Redis takes the backend down" by the back door. The `error`
  // event handler above is what actually reports these.
  attempt.catch(() => {});

  let timer;

  // The rejection handler on `attempt` here is not redundant with the
  // `attempt.catch()` above, and leaving it out is a bug I shipped once:
  // without it, a REJECTING connect (a malformed URL, an auth failure -- the
  // paths that do settle) propagates through Promise.race and makes
  // connectRedis() throw, which server.js's startup try/catch turns into
  // process.exit(1). Absorbing it here is what keeps every failure mode --
  // pending, rejected, or resolved-but-not-ready -- on the same degrade path.
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
    console.log("Redis Connected");
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
