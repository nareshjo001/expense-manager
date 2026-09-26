// OBS-001-T07 -- unit tests for scripts/verifyObservability.js's analysis.
//
// The script's orchestration (child server, fake ML service, real traffic)
// needs a database and runs for five minutes; it is exercised by running it.
// Its verdicts, though, come entirely from analyzeRun(), a pure function over
// captured log lines and responses -- so each check's pass AND fail paths are
// pinned here, including the specific regressions it exists to catch.
"use strict";

const {
  extractDbName,
  isDisposableDbName,
  parseLine,
  structuralProblems,
  groupUnstructured,
  analyzeRun,
  formatReport,
} = require("../scripts/verifyObservability");

const TS = "2026-09-26T15:00:00.000Z";
const json = (obj) => parseLine(JSON.stringify({ timestamp: TS, level: "info", requestId: null, ...obj }), "stdout");
const RUNBOOK = "# OBS-001 alert runbook\n\n## high_error_rate\n\nsteps\n\n## high_latency\n";

function goodEvidence(overrides = {}) {
  return {
    lines: [
      json({ scope: "mongo", event: "db_connected" }),
      json({ scope: "process", event: "server_started" }),
      json({ scope: "auth_audit", event: "login", requestId: "obsv-x-login" }),
      json({ level: "error", scope: "http", event: "unhandled_request_error", statusCode: 400, requestId: "obsv-x-bad-json" }),
      json({ scope: "errorReporter", event: "noop_report", environment: "staging", requestId: "obsv-x-bad-json" }),
      json({ scope: "metrics", event: "metrics_snapshot", requestCount: 30, errorCount: 7, distinctRoutes: 6, avgLatencyMs: 12 }),
      json({ level: "error", scope: "alert", event: "high_error_rate", metricValue: 0.233, threshold: 0.01, runbookUrl: "docs/runbooks/OBS-001-alerts.md" }),
    ],
    secrets: { email: "obs-verify-x@expense-manager.test", password: "ObsVerify-x-Pw!9", amount: "98765.43" },
    requests: {
      login: { sentRequestId: "obsv-x-login", echoedRequestId: "obsv-x-login", status: 200 },
      malformedJson: { sentRequestId: "obsv-x-bad-json", echoedRequestId: "obsv-x-bad-json", status: 400 },
      expenseWithMl: { sentRequestId: "obsv-x-expense-ml", echoedRequestId: "obsv-x-expense-ml", status: 201 },
      noIdSent: { sentRequestId: null, echoedRequestId: "0b6c1b3e-4f1d-4a55-9d3e-1f2a3b4c5d6e", status: 200 },
      malformedId: { sentRequestId: "not a valid id", echoedRequestId: "9f1c2b3e-4f1d-4a55-9d3e-1f2a3b4c5d6e", status: 200 },
    },
    mlCalls: [
      { method: "GET", path: "/", requestId: null },
      { method: "POST", path: "/generate-description", requestId: "obsv-x-expense-ml" },
    ],
    smoke: { exitCode: 0, output: "" },
    env: { errorProvider: "", ownerEmail: "", nodeEnv: "staging" },
    runbookText: RUNBOOK,
    minRequestCount: 20,
    pingCount: 6,
    ...overrides,
  };
}

const byId = (results) => Object.fromEntries(results.map((r) => [r.id, r]));

describe("database guard", () => {
  test("extracts the database name from standard and SRV strings", () => {
    expect(extractDbName("mongodb+srv://u:p@c0.x.mongodb.net/expense_manager_staging?retryWrites=true")).toBe("expense_manager_staging");
    expect(extractDbName("mongodb://127.0.0.1:27017/auth-db")).toBe("auth-db");
    expect(extractDbName("mongodb+srv://u:p@c0.x.mongodb.net/?retryWrites=true")).toBeNull();
    expect(extractDbName(undefined)).toBeNull();
  });

  test("accepts disposable-looking names and refuses the production one", () => {
    expect(isDisposableDbName("expense_manager_staging")).toBe(true);
    expect(isDisposableDbName("expense_manager_e2e")).toBe(true);
    expect(isDisposableDbName("auth-db")).toBe(false);
  });
});

describe("line parsing and structure", () => {
  test("parses JSON object lines and leaves anything else unstructured", () => {
    expect(parseLine('{"a":1}\r', "stdout").json).toEqual({ a: 1 });
    expect(parseLine("DB Connected", "stdout").json).toBeNull();
    expect(parseLine("[1,2]", "stdout").json).toBeNull();
    expect(parseLine("{broken", "stderr").json).toBeNull();
  });

  test("structuralProblems enforces the logger.js envelope", () => {
    expect(structuralProblems({ timestamp: TS, level: "info", scope: "a", event: "b", requestId: null })).toEqual([]);
    expect(structuralProblems({ type: "auth_security_event", occurredAt: TS })).toEqual(
      expect.arrayContaining(["timestamp is not ISO-8601 UTC", "scope missing", "event missing", "requestId key missing"])
    );
    expect(structuralProblems({ timestamp: TS, level: "debug", scope: "a", event: "b", requestId: null })[0]).toMatch(/level/);
  });

  test("groupUnstructured collapses repeats and keeps one example", () => {
    const lines = ["Redis Error: ECONNREFUSED", "Redis Error: ECONNREFUSED", "DB Connected"].map((l) => parseLine(l, "stderr"));
    const groups = groupUnstructured(lines);
    expect(groups[0]).toEqual(expect.objectContaining({ key: "Redis Error", count: 2 }));
    expect(groups[1]).toEqual(expect.objectContaining({ key: "DB Connected", count: 1 }));
  });
});

describe("analyzeRun", () => {
  test("a clean run passes every required check", () => {
    const results = analyzeRun(goodEvidence());
    const failed = results.filter((r) => r.required && r.status !== "PASS");
    expect(failed).toEqual([]);
    expect(byId(results)["6b-alert-email"].status).toBe("SKIP");
  });

  test("step 1 fails when a test value appears in any line, and does not echo the value", () => {
    const ev = goodEvidence();
    ev.lines.push(parseLine("Login failed for obs-verify-x@expense-manager.test", "stderr"));
    const r = byId(analyzeRun(ev))["1-redaction"];
    expect(r.status).toBe("FAIL");
    expect(r.details[0]).toEqual(expect.objectContaining({ label: "email", count: 1 }));
    expect(r.details[0].example).toContain("<<email>>");
    expect(r.details[0].example).not.toContain("obs-verify-x@");
  });

  test("step 2 fails when a malformed-JSON request's error line has no request ID (middleware-order regression)", () => {
    const ev = goodEvidence();
    ev.lines = ev.lines.map((l) =>
      l.json && l.json.event === "unhandled_request_error" ? json({ ...l.json, requestId: null }) : l
    );
    const r = byId(analyzeRun(ev))["2-correlation-ids"];
    expect(r.status).toBe("FAIL");
    expect(r.details.join("\n")).toMatch(/before the request-ID middleware ran/);
  });

  test("step 2 fails when the ML service did not receive the request's ID", () => {
    const ev = goodEvidence({ mlCalls: [{ method: "POST", path: "/generate-description", requestId: null }] });
    expect(byId(analyzeRun(ev))["2-correlation-ids"].status).toBe("FAIL");
  });

  test("step 2 fails when a malformed client ID is echoed back", () => {
    const ev = goodEvidence();
    ev.requests.malformedId.echoedRequestId = "not a valid id";
    expect(byId(analyzeRun(ev))["2-correlation-ids"].status).toBe("FAIL");
  });

  test("step 3 fails on any non-JSON line and on JSON lines missing the envelope", () => {
    const ev = goodEvidence();
    ev.lines.push(parseLine("DB Connected", "stdout"));
    let r = byId(analyzeRun(ev))["3-structured-format"];
    expect(r.status).toBe("FAIL");
    expect(r.details.join("\n")).toContain("DB Connected");

    const ev2 = goodEvidence();
    ev2.lines.push(parseLine(JSON.stringify({ type: "auth_security_event", occurredAt: TS }), "stdout"));
    r = byId(analyzeRun(ev2))["3-structured-format"];
    expect(r.status).toBe("FAIL");
    expect(r.details.join("\n")).toMatch(/malformed JSON log line/);
  });

  test("step 4 requires a noop_report tagged with this environment when no vendor is set", () => {
    const ev = goodEvidence();
    ev.lines = ev.lines.filter((l) => !(l.json && l.json.event === "noop_report"));
    expect(byId(analyzeRun(ev))["4-error-aggregation"].status).toBe("FAIL");

    const ev2 = goodEvidence({ env: { errorProvider: "", ownerEmail: "", nodeEnv: "production" } });
    expect(byId(analyzeRun(ev2))["4-error-aggregation"].status).toBe("FAIL");
  });

  test("step 4 becomes a manual, informational check when a vendor is configured", () => {
    const r = byId(analyzeRun(goodEvidence({ env: { errorProvider: "sentry", ownerEmail: "", nodeEnv: "staging" } })))["4-error-aggregation"];
    expect(r.required).toBe(false);
    expect(r.status).toBe("SKIP");
    expect(r.details.join("\n")).toMatch(/MANUAL/);
  });

  test("step 5 fails with no snapshot, or one that does not reflect the run's traffic", () => {
    const noSnap = goodEvidence();
    noSnap.lines = noSnap.lines.filter((l) => !(l.json && l.json.event === "metrics_snapshot"));
    expect(byId(analyzeRun(noSnap))["5-metrics"].status).toBe("FAIL");

    const stale = goodEvidence();
    stale.lines = stale.lines.map((l) =>
      l.json && l.json.event === "metrics_snapshot" ? json({ ...l.json, requestCount: 3, errorCount: 0 }) : l
    );
    const r = byId(analyzeRun(stale))["5-metrics"];
    expect(r.status).toBe("FAIL");
    expect(r.details.join("\n")).toMatch(/requestCount 3/);
  });

  test("step 6 fails when no alert fires or its runbook section is missing", () => {
    const noAlert = goodEvidence();
    noAlert.lines = noAlert.lines.filter((l) => !(l.json && l.json.scope === "alert"));
    expect(byId(analyzeRun(noAlert))["6a-alert-fires"].status).toBe("FAIL");

    const noSection = goodEvidence({ runbookText: "# OBS-001 alert runbook\n\n## high_latency\n" });
    expect(byId(analyzeRun(noSection))["6a-alert-fires"].status).toBe("FAIL");
  });

  test("6b fails when an owner email is configured and dispatch failed", () => {
    const ev = goodEvidence({ env: { errorProvider: "", ownerEmail: "owner@example.test", nodeEnv: "staging" } });
    ev.lines.push(json({ level: "warn", scope: "alert", event: "alert_email_dispatch_failed" }));
    expect(byId(analyzeRun(ev))["6b-alert-email"].status).toBe("FAIL");
  });

  test("a failing smoke test fails the run", () => {
    expect(byId(analyzeRun(goodEvidence({ smoke: { exitCode: 1, output: "" } })))["smoke"].status).toBe("FAIL");
  });

  test("formatReport states the overall result", () => {
    const text = formatReport(analyzeRun(goodEvidence()), { runId: "x", dbName: "expense_manager_staging", nodeEnv: "staging", lineCount: 7 });
    expect(text).toContain("RESULT: all required checks passed");
    const failing = formatReport(analyzeRun(goodEvidence({ smoke: { exitCode: 1, output: "" } })), { runId: "x", dbName: "d", nodeEnv: "staging", lineCount: 7 });
    expect(failing).toContain("RESULT: 1 required check(s) FAILED");
  });
});
