// OBS-001-T05 -- job, OCR, SIA-provider and ML metrics.
//
// The 2026-09-08 audit recorded that utils/metrics.js tracked HTTP request
// latency and status only, while OBS-001's own outcome names all four of
// these. That gap mattered because those four are precisely where this
// system fails QUIETLY: a cron that stops running, OCR that starts timing
// out, a degrading LLM provider, a slowing ML endpoint. None of them changes
// an HTTP status a user sees, so request metrics could not detect any of
// them and T06's alerting had nothing to fire on.
"use strict";

const METRICS_PATH = "../utils/metrics";
const LOGGER_PATH = "../utils/logger";
const ALERTS_PATH = "../utils/alerts";

function loadMetrics() {
  jest.resetModules();
  const logged = [];
  jest.doMock(LOGGER_PATH, () => ({ logEvent: (e) => logged.push(e) }));
  jest.doMock(ALERTS_PATH, () => ({ evaluateAndDispatchAlerts: async () => {} }));
  const metrics = require(METRICS_PATH);
  return { metrics, logged };
}

const snapshotOf = (logged) => logged.find((e) => e.event === "metrics_snapshot");

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("job metrics", () => {
  test("counts runs, failures and average duration per job name", () => {
    const { metrics, logged } = loadMetrics();

    metrics.recordJob({ jobName: "recurringJob", outcome: "success", durationMs: 100 });
    metrics.recordJob({ jobName: "recurringJob", outcome: "failure", durationMs: 300 });
    metrics.snapshotAndReset();

    expect(snapshotOf(logged).jobs.recurringJob).toEqual({
      runs: 2,
      failures: 1,
      skipped: 0,
      avgMs: 200,
    });
  });

  test("a skipped run is NOT counted as a failure", () => {
    // Losing the lease to another instance is the system working correctly.
    // Counting it as a failure would make a healthy multi-instance
    // deployment look permanently broken.
    const { metrics, logged } = loadMetrics();

    metrics.recordJob({ jobName: "retryPush", outcome: "skipped" });
    metrics.snapshotAndReset();

    const entry = snapshotOf(logged).jobs.retryPush;
    expect(entry.skipped).toBe(1);
    expect(entry.failures).toBe(0);
    expect(entry.runs).toBe(0);
  });

  test("skips are still counted, so a job that never wins the lease is visible", () => {
    // The opposite failure: if EVERY run skips, no instance is doing the
    // work. That is invisible unless skips are recorded somewhere.
    const { metrics, logged } = loadMetrics();

    for (let i = 0; i < 5; i += 1) metrics.recordJob({ jobName: "feedbackCollector", outcome: "skipped" });
    metrics.snapshotAndReset();

    expect(snapshotOf(logged).jobs.feedbackCollector.skipped).toBe(5);
    expect(snapshotOf(logged).jobs.feedbackCollector.runs).toBe(0);
  });

  test("an unnamed job is bucketed rather than dropped", () => {
    const { metrics, logged } = loadMetrics();
    metrics.recordJob({ outcome: "success", durationMs: 10 });
    metrics.snapshotAndReset();
    expect(snapshotOf(logged).jobs.unknown.runs).toBe(1);
  });
});

describe("operation metrics (OCR, SIA provider, ML)", () => {
  test("aggregates by scope and operation", () => {
    const { metrics, logged } = loadMetrics();

    metrics.recordOperation({ scope: "ocr", operation: "recognize", outcome: "success", durationMs: 1000 });
    metrics.recordOperation({ scope: "ocr", operation: "recognize", outcome: "failure", durationMs: 2000 });
    metrics.recordOperation({ scope: "sia_provider", operation: "groq", outcome: "success", durationMs: 400 });
    metrics.recordOperation({ scope: "ml", operation: "predict-category", outcome: "success", durationMs: 50 });
    metrics.snapshotAndReset();

    const ops = snapshotOf(logged).operations;
    expect(ops["ocr:recognize"]).toEqual({ count: 2, failures: 1, avgMs: 1500 });
    expect(ops["sia_provider:groq"]).toEqual({ count: 1, failures: 0, avgMs: 400 });
    expect(ops["ml:predict-category"]).toEqual({ count: 1, failures: 0, avgMs: 50 });
  });

  test("keeps OCR timeouts separate from other OCR failures", () => {
    // "Too slow" is a capacity signal; a generic failure is usually a decode
    // or worker problem. Merging them hides whichever is rarer.
    const { metrics, logged } = loadMetrics();

    metrics.recordOperation({ scope: "ocr", operation: "timeout", outcome: "failure", durationMs: 30000 });
    metrics.recordOperation({ scope: "ocr", operation: "recognize", outcome: "failure", durationMs: 900 });
    metrics.snapshotAndReset();

    const ops = snapshotOf(logged).operations;
    expect(ops["ocr:timeout"].failures).toBe(1);
    expect(ops["ocr:recognize"].failures).toBe(1);
  });

  test("recording never throws, whatever it is handed", () => {
    // Metrics observe the work; a counting bug must never be able to fail
    // the work itself.
    const { metrics } = loadMetrics();
    expect(() => metrics.recordOperation(undefined)).not.toThrow();
    expect(() => metrics.recordOperation({ scope: null, operation: 42, durationMs: "nope" })).not.toThrow();
  });

  test("the window resets after a snapshot", () => {
    const { metrics, logged } = loadMetrics();

    metrics.recordOperation({ scope: "ml", operation: "predict-category", outcome: "success", durationMs: 10 });
    metrics.snapshotAndReset();
    metrics.snapshotAndReset();

    const snapshots = logged.filter((e) => e.event === "metrics_snapshot");
    expect(snapshots[0].operations["ml:predict-category"].count).toBe(1);
    expect(snapshots[1].operations).toEqual({});
  });

  test("HTTP request metrics still work alongside the new dimensions", () => {
    const { metrics, logged } = loadMetrics();

    metrics.recordRequest({ route: "/report", statusCode: 200, latencyMs: 30 });
    metrics.recordRequest({ route: "/report", statusCode: 500, latencyMs: 70 });
    metrics.recordJob({ jobName: "recurringJob", outcome: "success", durationMs: 5 });
    metrics.snapshotAndReset();

    const snap = snapshotOf(logged);
    expect(snap.requestCount).toBe(2);
    expect(snap.errorCount).toBe(1);
    expect(snap.avgLatencyMs).toBe(50);
    expect(snap.jobs.recurringJob.runs).toBe(1);
  });
});
