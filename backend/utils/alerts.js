// OBS-001-T06 -- alert thresholds and owner/runbook links, layered on top
// of the OBS-001-T05 in-process metrics snapshot. Deliberately no new
// third-party alerting vendor: OBS-001-T04 flagged that decision as
// pending architecture/privacy approval, so alerts here stay on already-
// approved infrastructure -- a distinct structured log event, plus a
// best-effort email through the existing Brevo integration when an owner
// address is configured. See docs/runbooks/OBS-001-alerts.md.
"use strict";

const { logEvent } = require("./logger");

const RUNBOOK_URL = "docs/runbooks/OBS-001-alerts.md";
const DEFAULT_OWNER = "on-call maintainer";

// Below this many requests in a window, ratios like error rate are too
// noisy to alert on -- one failed request out of two would otherwise read
// as a 50% error rate.
const MIN_SAMPLE_SIZE = 5;

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ERROR_RATE_THRESHOLD = numberFromEnv("OBS_ALERT_ERROR_RATE_THRESHOLD", 0.05);
const LATENCY_MS_THRESHOLD = numberFromEnv("OBS_ALERT_LATENCY_MS_THRESHOLD", 2000);

// Pure function: given one metrics snapshot ({ requestCount, errorCount,
// avgLatencyMs }), returns the alerts it should raise. No I/O, so this is
// unit-testable without touching logging or email at all. Deliberately
// only reads aggregate counters -- never route names, merchant or user
// fields -- per the feature spec's "avoid high-cardinality merchant/user
// fields" requirement.
function detectAlerts(snapshot) {
  const { requestCount, errorCount, avgLatencyMs } = snapshot || {};
  const alerts = [];

  if (typeof requestCount !== "number" || requestCount < MIN_SAMPLE_SIZE) {
    return alerts;
  }

  const errorRate = typeof errorCount === "number" && requestCount > 0
    ? errorCount / requestCount
    : 0;
  if (errorRate > ERROR_RATE_THRESHOLD) {
    alerts.push({
      alertType: "high_error_rate",
      metricValue: Math.round(errorRate * 1000) / 1000,
      threshold: ERROR_RATE_THRESHOLD,
      owner: DEFAULT_OWNER,
      runbookUrl: RUNBOOK_URL,
    });
  }

  if (typeof avgLatencyMs === "number" && avgLatencyMs > LATENCY_MS_THRESHOLD) {
    alerts.push({
      alertType: "high_latency",
      metricValue: avgLatencyMs,
      threshold: LATENCY_MS_THRESHOLD,
      owner: DEFAULT_OWNER,
      runbookUrl: RUNBOOK_URL,
    });
  }

  return alerts;
}

// Logs each alert as a distinct structured event and, when an owner email
// is configured, best-effort emails it too. Never throws -- a failed
// alert dispatch must not take down the metrics timer or the request that
// triggered a snapshot.
async function dispatchAlerts(alerts) {
  for (const alert of alerts) {
    logEvent({
      level: "error",
      scope: "alert",
      event: alert.alertType,
      metricValue: alert.metricValue,
      threshold: alert.threshold,
      owner: alert.owner,
      runbookUrl: alert.runbookUrl,
    });

    const ownerEmail = process.env.OBS_ALERT_OWNER_EMAIL;
    if (!ownerEmail) continue;

    try {
      const { sendOperationalAlertEmail } = require("../Services/AuthServices/email.service");
      await sendOperationalAlertEmail(ownerEmail, alert);
    } catch {
      logEvent({
        level: "warn",
        scope: "alert",
        event: "alert_email_dispatch_failed",
        alertType: alert.alertType,
      });
    }
  }
}

// Single entry point metrics.js calls after building a snapshot: detect,
// then dispatch whatever was found. Returns the alerts raised (mainly for
// tests -- production callers can ignore the return value).
async function evaluateAndDispatchAlerts(snapshot) {
  const alerts = detectAlerts(snapshot);
  if (alerts.length > 0) {
    await dispatchAlerts(alerts);
  }
  return alerts;
}

module.exports = {
  detectAlerts,
  dispatchAlerts,
  evaluateAndDispatchAlerts,
  MIN_SAMPLE_SIZE,
  ERROR_RATE_THRESHOLD,
  LATENCY_MS_THRESHOLD,
  RUNBOOK_URL,
};
