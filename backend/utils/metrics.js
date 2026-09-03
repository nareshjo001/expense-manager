// OBS-001-T05 -- lightweight in-process request metrics. Deliberately no new
// HTTP endpoint and no external time-series dependency: a periodic
// structured "metrics_snapshot" log line is the integration point for
// whatever log aggregator the eventual hosting platform provides.
"use strict";

const { logEvent } = require("./logger");

const DEFAULT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;

function createInitialState() {
  return {
    requestCount: 0,
    errorCount: 0,
    totalLatencyMs: 0,
    routeCounts: new Map(),
  };
}

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

// Emits one aggregate "metrics_snapshot" event and resets the window --
// avoids high-cardinality per-request logging while still surfacing
// latency/error-rate trends, per the OBS-001 observability requirements.
function snapshotAndReset() {
  const { requestCount, errorCount, totalLatencyMs, routeCounts } = state;
  const avgLatencyMs = requestCount > 0 ? Math.round(totalLatencyMs / requestCount) : 0;

  logEvent({
    level: "info",
    scope: "metrics",
    event: "metrics_snapshot",
    requestCount,
    errorCount,
    avgLatencyMs,
    distinctRoutes: routeCounts.size,
  });

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
  startMetricsReporting,
  stopMetricsReporting,
  snapshotAndReset,
  recordRequest,
  resetMetricsForTests,
};
