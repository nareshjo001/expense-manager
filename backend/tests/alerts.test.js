// OBS-001-T06 -- backend/utils/alerts.js
describe("alerts", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OBS_ALERT_OWNER_EMAIL;
    delete process.env.OBS_ALERT_ERROR_RATE_THRESHOLD;
    delete process.env.OBS_ALERT_LATENCY_MS_THRESHOLD;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  describe("detectAlerts", () => {
    test("raises nothing below the minimum sample size, even at 100% error rate", () => {
      const { detectAlerts } = require("../utils/alerts");
      const alerts = detectAlerts({ requestCount: 2, errorCount: 2, avgLatencyMs: 10 });
      expect(alerts).toEqual([]);
    });

    test("raises nothing when error rate and latency are both within threshold", () => {
      const { detectAlerts } = require("../utils/alerts");
      const alerts = detectAlerts({ requestCount: 100, errorCount: 1, avgLatencyMs: 200 });
      expect(alerts).toEqual([]);
    });

    test("raises high_error_rate once the ratio exceeds the threshold with a sufficient sample", () => {
      const { detectAlerts, ERROR_RATE_THRESHOLD, RUNBOOK_URL } = require("../utils/alerts");
      const alerts = detectAlerts({ requestCount: 20, errorCount: 5, avgLatencyMs: 10 });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        alertType: "high_error_rate",
        metricValue: 0.25,
        threshold: ERROR_RATE_THRESHOLD,
        owner: expect.any(String),
        runbookUrl: RUNBOOK_URL,
      });
    });

    test("raises high_latency once average latency exceeds the threshold", () => {
      const { detectAlerts, LATENCY_MS_THRESHOLD } = require("../utils/alerts");
      const alerts = detectAlerts({ requestCount: 10, errorCount: 0, avgLatencyMs: 5000 });

      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        alertType: "high_latency",
        metricValue: 5000,
        threshold: LATENCY_MS_THRESHOLD,
      });
    });

    test("raises both alerts together when both thresholds are breached", () => {
      const { detectAlerts } = require("../utils/alerts");
      const alerts = detectAlerts({ requestCount: 10, errorCount: 9, avgLatencyMs: 9000 });

      expect(alerts.map((a) => a.alertType).sort()).toEqual(["high_error_rate", "high_latency"]);
    });

    test("respects custom thresholds from the environment", () => {
      process.env.OBS_ALERT_ERROR_RATE_THRESHOLD = "0.5";
      const { detectAlerts } = require("../utils/alerts");
      // 25% error rate would normally trip the 5% default, but not a 50% threshold.
      const alerts = detectAlerts({ requestCount: 20, errorCount: 5, avgLatencyMs: 10 });
      expect(alerts).toEqual([]);
    });

    test("ignores a non-numeric or invalid custom threshold and falls back to the default", () => {
      process.env.OBS_ALERT_ERROR_RATE_THRESHOLD = "not-a-number";
      const { detectAlerts, ERROR_RATE_THRESHOLD } = require("../utils/alerts");
      expect(ERROR_RATE_THRESHOLD).toBe(0.05);
      const alerts = detectAlerts({ requestCount: 20, errorCount: 5, avgLatencyMs: 10 });
      expect(alerts.some((a) => a.alertType === "high_error_rate")).toBe(true);
    });

    test("never includes route names, merchant or user fields in an alert", () => {
      const { detectAlerts } = require("../utils/alerts");
      const alerts = detectAlerts({ requestCount: 20, errorCount: 20, avgLatencyMs: 10 });
      const keys = new Set(alerts.flatMap((a) => Object.keys(a)));
      expect(keys).toEqual(new Set(["alertType", "metricValue", "threshold", "owner", "runbookUrl"]));
    });
  });

  describe("dispatchAlerts", () => {
    test("logs a structured alert event for each alert and does not attempt email when no owner is configured", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const { dispatchAlerts } = require("../utils/alerts");

      await dispatchAlerts([
        { alertType: "high_error_rate", metricValue: 0.25, threshold: 0.05, owner: "on-call maintainer", runbookUrl: "docs/runbooks/OBS-001-alerts.md" },
      ]);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const record = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
      expect(record.scope).toBe("alert");
      expect(record.event).toBe("high_error_rate");
      expect(record.metricValue).toBe(0.25);

      consoleErrorSpy.mockRestore();
    });

    test("emails the configured owner when OBS_ALERT_OWNER_EMAIL is set", async () => {
      process.env.OBS_ALERT_OWNER_EMAIL = "owner@example.com";
      jest.spyOn(console, "error").mockImplementation(() => {});

      const sendOperationalAlertEmail = jest.fn().mockResolvedValue(undefined);
      jest.doMock("../Services/AuthServices/email.service", () => ({ sendOperationalAlertEmail }));

      const { dispatchAlerts } = require("../utils/alerts");
      const alert = { alertType: "high_latency", metricValue: 5000, threshold: 2000, owner: "on-call maintainer", runbookUrl: "docs/runbooks/OBS-001-alerts.md" };

      await dispatchAlerts([alert]);

      expect(sendOperationalAlertEmail).toHaveBeenCalledWith("owner@example.com", alert);
    });

    test("logs a warning but does not throw when the alert email fails to send", async () => {
      process.env.OBS_ALERT_OWNER_EMAIL = "owner@example.com";
      // logger.js only special-cases level:"error" to console.error; every
      // other level (including "warn") goes through console.log -- so the
      // alert itself (level:error) lands on the error spy, and the
      // dispatch-failure warning (level:warn) lands on the log spy.
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      const sendOperationalAlertEmail = jest.fn().mockRejectedValue(new Error("Brevo down"));
      jest.doMock("../Services/AuthServices/email.service", () => ({ sendOperationalAlertEmail }));

      const { dispatchAlerts } = require("../utils/alerts");
      const alert = { alertType: "high_latency", metricValue: 5000, threshold: 2000, owner: "on-call maintainer", runbookUrl: "docs/runbooks/OBS-001-alerts.md" };

      await expect(dispatchAlerts([alert])).resolves.toBeUndefined();

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const warnRecord = JSON.parse(consoleLogSpy.mock.calls[0][0]);
      expect(warnRecord.event).toBe("alert_email_dispatch_failed");
      expect(warnRecord.level).toBe("warn");

      consoleErrorSpy.mockRestore();
      consoleLogSpy.mockRestore();
    });
  });

  describe("evaluateAndDispatchAlerts", () => {
    test("returns an empty array and dispatches nothing when no alert is raised", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const { evaluateAndDispatchAlerts } = require("../utils/alerts");

      const alerts = await evaluateAndDispatchAlerts({ requestCount: 100, errorCount: 0, avgLatencyMs: 10 });

      expect(alerts).toEqual([]);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    test("detects and dispatches in one call for a breaching snapshot", async () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const { evaluateAndDispatchAlerts } = require("../utils/alerts");

      const alerts = await evaluateAndDispatchAlerts({ requestCount: 20, errorCount: 20, avgLatencyMs: 10 });

      expect(alerts).toHaveLength(1);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      consoleErrorSpy.mockRestore();
    });
  });
});
