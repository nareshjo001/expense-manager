// OBS-001-T05 -- lightweight in-process metrics. Deliberately no new HTTP
// endpoint and no external time-series dependency: a periodic structured
// "metrics_snapshot" log line is the integration point for whatever log
// aggregator the eventual hosting platform provides.
//
// 2026-09-09: this recorded HTTP requests only, while OBS-001's own outcome
// names job, OCR, SIA-provider and ML metrics too. Those are the four places
// where this system fails QUIETLY -- a cron that stops running, OCR that
// starts timing out, an LLM provider degrading, an ML endpoint slowing down.
// None of them touch an HTTP status code a user sees, so request metrics
// alone cannot detect any of them, and the alerting built in T06 had nothing
// to fire on.
//
// Everything is aggregated in-process and flushed on the same snapshot, so
// adding a dimension costs one map and no new transport. Durations are
// summed rather than histogrammed: the goal here is trend detection cheap
// enough to leave on, not percentile accuracy.
"use strict";

const { logEvent } = require("./logger");
const { evaluateAndDispatchAlerts } = require("./alerts");

const DEFAULT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

function createInitialState() {
  return {
    requestCount: 0,
    errorCount: 0,
    totalLatencyMs: 0,
    routeCounts: new Map(),
    // name -> { runs, failures, skipped, totalMs }
    jobs: new Map(),
    // "scope:operation" -> { count, failures, totalMs }
    operations: new Map(),
  };
}

// Buckets a duration sum + count into an average without pretending to more
// precision than a summed total supports.
const average = (totalMs, count) => (count > 0 ? Math.round(totalMs / count) : 0);

let state = createInitialState();
let snapshotTimer = null;

// Records one completed request's outcome into the in-memory window.
function recordRequest({ route, statusCode, latencyMs }) {
  state.requestCount += 1;
  if (typeof statusCode === "number" && statusCode >= 500) {
    state.errorCount += 1;
  }
  if (typeof latencyMs === "number" && Number.isFinite(latencyMs) && latencyMs >= 0) {
    state.totalLatencyMs += latencyMs;
  }
  const safeRoute = typeof route === "string" && route.trim() !== "" ? route.trim() : "unknown";
  state.routeCounts.set(safeRoute, (state.routeCounts.get(safeRoute) || 0) + 1);
}

// OBS-001-T05 -- records one scheduled-job run.
//
// `outcome` is one of "success" | "failure" | "skipped". Skipped is tracked
// SEPARATELY rather than folded into either bucket: a job that skips because
// another instance holds the lease is healthy, and counting that as a
// failure would make a correctly-behaving multi-instance deployment look
// broken. But a job that skips EVERY run is not healthy either -- it means
// no instance is winning the lease, or the lease is never released -- and
// that is invisible unless skips are counted.
function recordJob({ jobName, outcome, durationMs } = {}) {
  const name = typeof jobName === "string" && jobName.trim() !== "" ? jobName.trim() : "unknown";
  const entry = state.jobs.get(name) || { runs: 0, failures: 0, skipped: 0, totalMs: 0 };

  if (outcome === "skipped") {
    entry.skipped += 1;
  } else {
    entry.runs += 1;
    if (outcome === "failure") entry.failures += 1;
    if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
      entry.totalMs += durationMs;
    }
  }

  state.jobs.set(name, entry);
}

// OBS-001-T05 -- records one unit of non-HTTP work: an OCR pass, an LLM
// provider call, an ML service call. One generic recorder rather than three
// bespoke ones, because these dimensions differ only in their label and
// adding a fourth should not require touching this file.
//
// Never throws: metrics are an observation of the work, and a bug in
// counting must not be able to fail the work itself.
function recordOperation({ scope, operation, outcome, durationMs } = {}) {
  try {
    const safeScope = typeof scope === "string" && scope.trim() !== "" ? scope.trim() : "unknown";
    const safeOp = typeof operation === "string" && operation.trim() !== "" ? operation.trim() : "unknown";
    const key = `${safeScope}:${safeOp}`;
    const entry = state.operations.get(key) || { count: 0, failures: 0, totalMs: 0 };

    entry.count += 1;
    if (outcome === "failure") entry.failures += 1;
    if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
      entry.totalMs += durationMs;
    }

    state.operations.set(key, entry);
  } catch {
    // Deliberately swallowed -- see above.
  }
}

// Emits one aggregate "metrics_snapshot" event and resets the window --
// avoids high-cardinality per-request logging while still surfacing
// latency/error-rate trends, per the OBS-001 observability requirements.
function snapshotAndReset() {
  const { requestCount, errorCount, totalLatencyMs, routeCounts } = state;
  const avgLatencyMs = requestCount > 0 ? Math.round(totalLatencyMs / requestCount) : 0;

  // Job and operation detail is emitted as compact per-name summaries rather
  // than as one line per run: per-run logging is what makes observability
  // expensive enough that someone eventually turns it off.
  const jobs = {};
  for (const [name, e] of state.jobs.entries()) {
    jobs[name] = {
      runs: e.runs,
      failures: e.failures,
      skipped: e.skipped,
      avgMs: average(e.totalMs, e.runs),
    };
  }

  const operations = {};
  for (const [key, e] of state.operations.entries()) {
    operations[key] = {
      count: e.count,
      failures: e.failures,
      avgMs: average(e.totalMs, e.count),
    };
  }

  logEvent({
    level: "info",
    scope: "metrics",
    event: "metrics_snapshot",
    requestCount,
    errorCount,
    avgLatencyMs,
    distinctRoutes: routeCounts.size,
    jobs,
    operations,
  });

  // OBS-001-T06 -- fire-and-forget: detectAlerts + the log half of
  // dispatchAlerts run synchronously (see alerts.js), so an alert's own
  // log line is already emitted by the time this call returns. Only the
  // best-effort owner email, when configured, continues past this point;
  // its own failures are caught and logged inside alerts.js, so this
  // .catch is just a backstop against an unhandled rejection.
  evaluateAndDispatchAlerts({ requestCount, errorCount, avgLatencyMs }).catch(() => {});

  state = createInitialState();
}

// Starts the periodic snapshot timer. Guarded against double-start so
// repeated `require`s (tests, or an app restart within the same process)
// never accumulate multiple timers.
function startMetricsReporting(intervalMs = DEFAULT_SNAPSHOT_INTERVAL_MS) {
  if (snapshotTimer) return snapshotTimer;
  snapshotTimer = setInterval(snapshotAndReset, intervalMs);
  snapshotTimer.unref?.();
  return snapshotTimer;
}

function stopMetricsReporting() {
  if (snapshotTimer) {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
}

// Express middleware -- records latency/status for every request without
// altering the request/response contract.
function requestMetricsMiddleware(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordRequest({ route: req.baseUrl || req.path, statusCode: res.statusCode, latencyMs });
  });
  next();
}

function resetMetricsForTests() {
  state = createInitialState();
}

module.exports = {
  requestMetricsMiddleware,
  recordJob,
  recordOperation,
  startMetricsReporting,
  stopMetricsReporting,
  snapshotAndReset,
  recordRequest,
  resetMetricsForTests,
};
