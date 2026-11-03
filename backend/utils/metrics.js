// Lightweight in-process metrics.
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
    // SIA-001-T03 -- provider -> { calls, promptTokens, completionTokens,
    // estimatedCostUsd, costKnown }.
    usage: new Map(),
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

// Records one scheduled-job run. `outcome` is one of "success" | "failure" | "skipped".
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

// Records one unit of non-HTTP work: an OCR pass, an LLM provider call, an ML service call.
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

// Js inputPricePerMillionUsd/outputPricePerMillionUsd), its estimated cost.
function recordSiaUsage({ provider, promptTokens, completionTokens, estimatedCostUsd } = {}) {
  try {
    const safeProvider = typeof provider === "string" && provider.trim() ? provider.trim() : "unknown";
    const entry = state.usage.get(safeProvider) || {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      estimatedCostUsd: 0,
      // Tracks whether ANY call this window had a known cost -- an aggregate of $0 across calls with no pricing configured would read as a real, verified zero rather than "unknown".
      costKnown: false,
    };

    entry.calls += 1;
    if (typeof promptTokens === "number" && Number.isFinite(promptTokens) && promptTokens >= 0) {
      entry.promptTokens += promptTokens;
    }
    if (typeof completionTokens === "number" && Number.isFinite(completionTokens) && completionTokens >= 0) {
      entry.completionTokens += completionTokens;
    }
    if (typeof estimatedCostUsd === "number" && Number.isFinite(estimatedCostUsd) && estimatedCostUsd >= 0) {
      entry.estimatedCostUsd += estimatedCostUsd;
      entry.costKnown = true;
    }

    state.usage.set(safeProvider, entry);
  } catch {
    // Deliberately swallowed -- see recordOperation above.
  }
}

// Emits one aggregate "metrics_snapshot" event and resets the window -- avoids high-cardinality per-request logging while still surfacing latency/error-rate trends, per the OBS-001 observability requirements.
function snapshotAndReset() {
  const { requestCount, errorCount, totalLatencyMs, routeCounts } = state;
  const avgLatencyMs = requestCount > 0 ? Math.round(totalLatencyMs / requestCount) : 0;

  // Job and operation detail is emitted as compact per-name summaries rather than as one line per run: per-run logging is what makes observability expensive enough that someone eventually turns it off.
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

  // SIA-001-T03 -- usage/cost, one summary object per provider.
  const siaUsage = {};
  for (const [provider, e] of state.usage.entries()) {
    siaUsage[provider] = {
      calls: e.calls,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      // null (not 0) when no call this window had pricing configured.
      estimatedCostUsd: e.costKnown ? Math.round(e.estimatedCostUsd * 1e6) / 1e6 : null,
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
    siaUsage,
  });

  // Js), so an alert's own log line is already emitted by the time this call returns.
  evaluateAndDispatchAlerts({ requestCount, errorCount, avgLatencyMs }).catch(() => {});

  state = createInitialState();
}

// Starts the periodic snapshot timer.
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
  recordSiaUsage,
  startMetricsReporting,
  stopMetricsReporting,
  snapshotAndReset,
  recordRequest,
  resetMetricsForTests,
};
