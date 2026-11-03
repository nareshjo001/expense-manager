// Alert thresholds and owner/runbook links, layered on top of the OBS-001-T05 in-process metrics snapshot.
"use strict";

const { logEvent } = require("./logger");

const RUNBOOK_URL = "docs/runbooks/OBS-001-alerts.md";
const DEFAULT_OWNER = "on-call maintainer";

// Below this many requests in a window, ratios like error rate are too noisy to alert on -- one failed request out of two would otherwise read as a 50% error rate.
const MIN_SAMPLE_SIZE = 5;

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const ERROR_RATE_THRESHOLD = numberFromEnv("OBS_ALERT_ERROR_RATE_THRESHOLD", 0.05);
const LATENCY_MS_THRESHOLD = numberFromEnv("OBS_ALERT_LATENCY_MS_THRESHOLD", 2000);

// Pure function: given one metrics snapshot ({ requestCount, errorCount, avgLatencyMs }), returns the alerts it should raise.
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

// Logs each alert as a distinct structured event and, when an owner email is configured, best-effort emails it too.
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

// Js calls after building a snapshot: detect, then dispatch whatever was found.
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
