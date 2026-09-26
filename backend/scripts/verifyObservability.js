#!/usr/bin/env node
"use strict";

// OBS-001-T07 -- observability verification, executable.
//
// docs/runbooks/OBS-001-T07-staging-verification.md lists six checks that
// "need a human with log access": redaction (T01), correlation IDs (T02),
// structured log format (T03), error aggregation (T04), metrics (T05) and
// alerts (T06). The reason they needed a human is that they are about what
// the server WRITES TO ITS LOGS, which no amount of HTTP probing from outside
// can see. This script removes that reason by owning the process: it starts
// the real backend (server.js, unmodified) as a child process, captures
// every line it writes to stdout/stderr, drives real traffic at it, and then
// checks those captured lines against the runbook's six expectations.
//
// What it runs against. MONGO_CONN must name a disposable database -- a
// staging copy restored from a backup (OPS-002-T05), a CI database, or a
// local one. The run CREATES a throwaway user and two expenses there and
// deletes everything tied to that user afterwards. It refuses a database
// whose name does not look disposable (see DISPOSABLE_DB_PATTERN) unless
// --allow-any-db is passed, because pointing it at production would write a
// user into production.
//
// What it deliberately does to the child process's environment:
//   - PROCESS_ROLE=web: no scheduled jobs, so nothing but this script's own
//     traffic touches the database or shows up in the metrics.
//   - ML_ROUTE -> a fake ML service this script runs on localhost. It answers
//     GET / with 500 (so /ping returns 503, a real 5xx for the error-rate
//     alert) and records the X-Request-ID of every call it receives, which is
//     the only way to prove the ID is FORWARDED downstream (runbook step 2).
//   - OBS_ALERT_ERROR_RATE_THRESHOLD=0.01: the runbook's "temporarily lower
//     the threshold, in staging only" step. It only ever applies to this
//     child process.
//   - NODE_ENV defaults to "staging", so the error-reporter's environment tag
//     is checked against a non-production value.
//   - JWT_SECRET / REFRESH_TOKEN_SECRET are generated per run when unset:
//     this instance only has to accept the tokens it issued itself.
//
// Metrics are snapshotted on a fixed 5-minute timer (utils/metrics.js), and
// alerts are evaluated on that snapshot. This script waits for the real
// timer rather than calling snapshotAndReset() itself, so a pass means the
// timer, the snapshot and the alert path all work in a running server -- at
// the cost of the run taking a little over five minutes.
//
// Usage (from backend/):
//   node scripts/verifyObservability.js
//   node scripts/verifyObservability.js --port=8099 --wait-ms=360000 --out-dir=./obs-run
//
// Exit code: 0 if every REQUIRED check passed, 1 otherwise.

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const BACKEND_DIR = path.resolve(__dirname, "..");
const ALERT_RUNBOOK_PATH = path.resolve(BACKEND_DIR, "..", "docs", "runbooks", "OBS-001-alerts.md");

const DISPOSABLE_DB_PATTERN = /(staging|stage|test|e2e|ci|verify|scratch|local|dev)/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const LOG_LEVELS = new Set(["info", "warn", "error"]);
const PING_COUNT = 6;
const DEFAULT_WAIT_MS = 6 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure analysis. Everything below this line up to the orchestration section
// takes plain data and returns plain data, so it is unit-tested directly
// (tests/verifyObservability.test.js) without a server or a database.
// ---------------------------------------------------------------------------

// Mongo connection strings: the database name is the path segment after the
// host list, before "?". Same parsing rule as scripts/backup/mongoUri.js.
function extractDbName(connectionString) {
  if (typeof connectionString !== "string") return null;
  const withoutScheme = connectionString.replace(/^mongodb(\+srv)?:\/\//, "");
  const slash = withoutScheme.indexOf("/");
  if (slash === -1) return null;
  const name = withoutScheme.slice(slash + 1).split("?")[0];
  return name === "" ? null : name;
}

function isDisposableDbName(name) {
  return typeof name === "string" && DISPOSABLE_DB_PATTERN.test(name);
}

// One captured output line -> { raw, stream, json } where json is the parsed
// object when the line is a JSON object, else null.
function parseLine(raw, stream) {
  const text = raw.replace(/\r$/, "");
  let json = null;
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed;
    } catch {
      json = null;
    }
  }
  return { raw: text, stream, json };
}

// T03's contract (utils/logger.js): every line is one JSON object with an
// ISO-8601 UTC timestamp, a level from the fixed set, and string scope/event.
function structuralProblems(record) {
  const problems = [];
  if (typeof record.timestamp !== "string" || !ISO_TIMESTAMP_PATTERN.test(record.timestamp)) {
    problems.push("timestamp is not ISO-8601 UTC");
  }
  if (!LOG_LEVELS.has(record.level)) problems.push(`level "${record.level}" is not info/warn/error`);
  if (typeof record.scope !== "string" || record.scope === "") problems.push("scope missing");
  if (typeof record.event !== "string" || record.event === "") problems.push("event missing");
  if (!("requestId" in record)) problems.push("requestId key missing");
  return problems;
}

// Unstructured lines are grouped by their first few words so one noisy
// console.log does not bury the others; each group keeps a count and one
// example, truncated. Values are NOT echoed beyond that example.
function groupUnstructured(lines) {
  const groups = new Map();
  for (const line of lines) {
    const key = line.raw.split(/[:{(]/)[0].trim().slice(0, 60) || "(blank)";
    const entry = groups.get(key) || { key, count: 0, example: line.raw.slice(0, 160), stream: line.stream };
    entry.count += 1;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function check(id, title, required, ok, details) {
  return { id, title, required, status: ok === null ? "SKIP" : ok ? "PASS" : "FAIL", details };
}

// The six runbook steps, evaluated over one run's evidence.
//
// evidence = {
//   lines: parseLine() results for everything the server printed,
//   secrets: { label: string } -- values that must never appear verbatim,
//   requests: { name: { requestId, sentRequestId, status, echoedRequestId } },
//   mlCalls: [{ method, path, requestId }],
//   smoke: { exitCode, output },
//   env: { errorProvider, ownerEmail, nodeEnv },
//   runbookText: contents of docs/runbooks/OBS-001-alerts.md (or null),
//   minRequestCount, pingCount,
// }
function analyzeRun(evidence) {
  const { lines, secrets, requests, mlCalls, smoke, env, runbookText } = evidence;
  const results = [];
  const jsonLines = lines.filter((l) => l.json);

  // --- Step 1: redaction (T01) ---------------------------------------------
  const leaks = [];
  for (const [label, value] of Object.entries(secrets)) {
    if (!value) continue;
    const hits = lines.filter((l) => l.raw.includes(value));
    if (hits.length) leaks.push({ label, count: hits.length, example: hits[0].raw.split(value).join("<<" + label + ">>").slice(0, 200) });
  }
  results.push(check(
    "1-redaction",
    "No email, password, amount, name or description from the test requests appears in any log line",
    true,
    leaks.length === 0,
    leaks.length ? leaks : [`searched ${lines.length} lines for ${Object.keys(secrets).length} values; none found`]
  ));

  // --- Step 2: correlation IDs (T02) ---------------------------------------
  const idProblems = [];
  const idNotes = [];
  for (const [name, r] of Object.entries(requests)) {
    if (r.sentRequestId && REQUEST_ID_PATTERN.test(r.sentRequestId) && r.echoedRequestId !== r.sentRequestId) {
      idProblems.push(`${name}: sent "${r.sentRequestId}", response header was "${r.echoedRequestId || "(missing)"}"`);
    }
    if (r.sentRequestId && !REQUEST_ID_PATTERN.test(r.sentRequestId) && r.echoedRequestId === r.sentRequestId) {
      idProblems.push(`${name}: malformed ID was echoed back instead of replaced`);
    }
    if (!r.sentRequestId && !(r.echoedRequestId && REQUEST_ID_PATTERN.test(r.echoedRequestId))) {
      idProblems.push(`${name}: no ID sent and none generated (header "${r.echoedRequestId || "(missing)"}")`);
    }
    // Every log line carrying this request's ID must carry exactly it; and a
    // line whose requestId is set must belong to a request we actually made
    // (checked below across all lines).
    const tagged = jsonLines.filter((l) => l.json.requestId === r.echoedRequestId && r.echoedRequestId);
    idNotes.push(`${name}: ${tagged.length} log line(s) tagged with its ID`);
  }
  // A request that fails inside body parsing (malformed JSON) must still be
  // traceable: its error line should carry the ID the client sent.
  const badJson = requests.malformedJson;
  if (badJson) {
    const errorLines = jsonLines.filter((l) => l.json.event === "unhandled_request_error" && l.json.statusCode === 400);
    const traced = errorLines.some((l) => l.json.requestId === badJson.sentRequestId);
    if (!traced) {
      idProblems.push(
        `malformedJson: its error log line has requestId ${errorLines.length ? JSON.stringify(errorLines[0].json.requestId) : "(no error line found)"}` +
        ` instead of "${badJson.sentRequestId}" -- the request failed before the request-ID middleware ran`
      );
    }
  }
  const mlTarget = requests.expenseWithMl;
  const mlDescriptionCalls = mlCalls.filter((c) => c.path === "/generate-description");
  let mlForwarded = null;
  if (mlTarget) {
    mlForwarded = mlDescriptionCalls.some((c) => c.requestId === mlTarget.sentRequestId);
    if (!mlForwarded) {
      idProblems.push(
        `expenseWithMl: fake ML service received ${mlDescriptionCalls.length} /generate-description call(s) with X-Request-ID ` +
        `${JSON.stringify(mlDescriptionCalls.map((c) => c.requestId))}, expected "${mlTarget.sentRequestId}"`
      );
    }
  }
  results.push(check(
    "2-correlation-ids",
    "IDs are echoed, generated when absent, replaced when malformed, logged, and forwarded to the ML service",
    true,
    idProblems.length === 0,
    idProblems.length ? [...idProblems, ...idNotes] : [...idNotes, `ML service received the expected ID: ${mlForwarded}`]
  ));

  // --- Step 3: structured format (T03) -------------------------------------
  const unstructured = lines.filter((l) => !l.json && l.raw.trim() !== "");
  const malformed = jsonLines
    .map((l) => ({ l, problems: structuralProblems(l.json) }))
    .filter((x) => x.problems.length);
  const formatDetails = [];
  if (unstructured.length) {
    formatDetails.push(`${unstructured.length} of ${lines.length} lines are not JSON:`);
    for (const g of groupUnstructured(unstructured)) formatDetails.push(`  ${g.count}x [${g.stream}] ${g.example}`);
  }
  for (const m of malformed.slice(0, 10)) formatDetails.push(`malformed JSON log line (${m.problems.join(", ")}): ${m.l.raw.slice(0, 160)}`);
  if (!formatDetails.length) formatDetails.push(`all ${lines.length} lines are structured JSON with timestamp/level/scope/event/requestId`);
  results.push(check(
    "3-structured-format",
    "Every line the server writes is a structured JSON log record",
    true,
    unstructured.length === 0 && malformed.length === 0,
    formatDetails
  ));

  // --- Step 4: error aggregation (T04) -------------------------------------
  const provider = (env.errorProvider || "").trim().toLowerCase();
  const reporterLines = jsonLines.filter((l) => l.json.scope === "errorReporter");
  const noop = reporterLines.filter((l) => l.json.event === "noop_report");
  const initFailed = reporterLines.filter((l) => l.json.event === "transport_init_failed");
  const sendFailed = reporterLines.filter((l) => l.json.event === "transport_send_failed");
  if (provider === "" || provider === "none") {
    const wrongEnv = noop.filter((l) => l.json.environment !== env.nodeEnv);
    const ok = noop.length > 0 && initFailed.length === 0 && sendFailed.length === 0 && wrongEnv.length === 0;
    results.push(check(
      "4-error-aggregation",
      "No vendor configured: errors go to the structured no-op transport, tagged with this environment, nothing sent externally",
      true,
      ok,
      [
        `ERROR_AGGREGATION_PROVIDER unset -> expected no-op transport`,
        `noop_report lines: ${noop.length}` + (noop[0] ? ` (environment "${noop[0].json.environment}", requestId ${JSON.stringify(noop[0].json.requestId)})` : ""),
        `transport_init_failed: ${initFailed.length}, transport_send_failed: ${sendFailed.length}`,
        ...(wrongEnv.length ? [`${wrongEnv.length} noop_report line(s) tagged with the wrong environment (expected "${env.nodeEnv}")`] : []),
      ]
    ));
  } else {
    results.push(check(
      "4-error-aggregation",
      `Vendor "${provider}" configured: the error must appear in its dashboard (manual)`,
      false,
      initFailed.length === 0 && sendFailed.length === 0 ? null : false,
      [
        `transport_init_failed: ${initFailed.length}, transport_send_failed: ${sendFailed.length}`,
        `MANUAL: find the error for requestId "${badJson ? badJson.sentRequestId : "?"}" in the ${provider} dashboard, environment "${env.nodeEnv}", with no email/amount/description in it`,
      ]
    ));
  }

  // --- Step 5: metrics (T05) -----------------------------------------------
  const snapshots = jsonLines.filter((l) => l.json.scope === "metrics" && l.json.event === "metrics_snapshot");
  const snap = snapshots.find((l) => (l.json.requestCount || 0) > 0) || snapshots[0];
  const metricProblems = [];
  if (!snap) {
    metricProblems.push("no metrics_snapshot line was written within the wait window");
  } else {
    const s = snap.json;
    if (!(s.requestCount >= evidence.minRequestCount)) metricProblems.push(`requestCount ${s.requestCount} < ${evidence.minRequestCount} requests this run made`);
    if (!(s.errorCount >= evidence.pingCount)) metricProblems.push(`errorCount ${s.errorCount} < ${evidence.pingCount} forced 503s`);
    if (!(s.distinctRoutes >= 3)) metricProblems.push(`distinctRoutes ${s.distinctRoutes} < 3`);
    if (!(s.avgLatencyMs >= 0)) metricProblems.push(`avgLatencyMs ${s.avgLatencyMs} is not a number`);
  }
  results.push(check(
    "5-metrics",
    "The periodic metrics snapshot reflects this run's real traffic",
    true,
    metricProblems.length === 0,
    metricProblems.length
      ? metricProblems
      : [`snapshot: requestCount=${snap.json.requestCount}, errorCount=${snap.json.errorCount}, distinctRoutes=${snap.json.distinctRoutes}, avgLatencyMs=${snap.json.avgLatencyMs}`]
  ));

  // --- Step 6: alerts and runbook links (T06) ------------------------------
  const alertLines = jsonLines.filter((l) => l.json.scope === "alert" && l.json.event === "high_error_rate");
  const alertProblems = [];
  if (!alertLines.length) {
    alertProblems.push("no high_error_rate alert line was written");
  } else {
    const a = alertLines[0].json;
    if (a.level !== "error") alertProblems.push(`alert level is "${a.level}", expected "error"`);
    if (a.runbookUrl !== "docs/runbooks/OBS-001-alerts.md") alertProblems.push(`runbookUrl is "${a.runbookUrl}"`);
    if (!runbookText) alertProblems.push("docs/runbooks/OBS-001-alerts.md could not be read");
    else if (!/^##\s+high_error_rate\s*$/m.test(runbookText)) alertProblems.push("runbook has no '## high_error_rate' section");
  }
  results.push(check(
    "6a-alert-fires",
    "Forced error-rate breach raises a structured high_error_rate alert whose runbook link resolves to its section",
    true,
    alertProblems.length === 0,
    alertProblems.length
      ? alertProblems
      : [`alert: metricValue=${alertLines[0].json.metricValue}, threshold=${alertLines[0].json.threshold}, runbookUrl=${alertLines[0].json.runbookUrl} (section '## high_error_rate' present)`]
  ));

  const emailFailed = jsonLines.some((l) => l.json.scope === "alert" && l.json.event === "alert_email_dispatch_failed");
  results.push(check(
    "6b-alert-email",
    "Alert email via Brevo (only when OBS_ALERT_OWNER_EMAIL is set)",
    false,
    env.ownerEmail ? (emailFailed ? false : null) : null,
    env.ownerEmail
      ? emailFailed
        ? ["alert_email_dispatch_failed was logged -- check BREVO_API_KEY"]
        : [`dispatch did not log a failure; MANUAL: confirm the email reached ${env.ownerEmail} and its link points at docs/runbooks/OBS-001-alerts.md#high_error_rate`]
      : ["OBS_ALERT_OWNER_EMAIL not set -- email path not exercised"]
  ));

  // --- Smoke test (TST-001-T07), which covers step 2's HTTP half -----------
  results.push(check(
    "smoke",
    "Deployment smoke test against this instance",
    true,
    smoke.exitCode === 0,
    [`exit code ${smoke.exitCode}`]
  ));

  return results;
}

function formatReport(results, meta) {
  const out = [];
  out.push("");
  out.push(`OBS-001-T07 observability verification -- run ${meta.runId}`);
  out.push(`database: ${meta.dbName}   NODE_ENV: ${meta.nodeEnv}   lines captured: ${meta.lineCount}`);
  out.push("");
  // An aborted run never produced the traffic the checks judge, so its
  // "results" would be verdicts about nothing -- a structured-format PASS
  // over five startup lines, say. Report the abort, not those.
  if (meta.abortReason) {
    out.push(`RUN ABORTED: ${meta.abortReason}`);
    out.push("");
    out.push("RESULT: run aborted -- no check was evaluated against real traffic");
    return out.join("\n");
  }
  for (const r of results) {
    out.push(`[${r.status}] ${r.id}${r.required ? "" : " (informational)"} -- ${r.title}`);
    for (const d of r.details || []) {
      out.push(`       ${typeof d === "string" ? d : JSON.stringify(d)}`);
    }
  }
  const failed = results.filter((r) => r.required && r.status === "FAIL");
  out.push("");
  out.push(failed.length ? `RESULT: ${failed.length} required check(s) FAILED` : "RESULT: all required checks passed");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Orchestration: fake ML service, child server, traffic, cleanup.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const get = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  return {
    port: Number(get("port", "8099")),
    waitMs: Number(get("wait-ms", String(DEFAULT_WAIT_MS))),
    outDir: path.resolve(get("out-dir", os.tmpdir())),
    allowAnyDb: argv.includes("--allow-any-db"),
  };
}

function startFakeMl() {
  const calls = [];
  const server = http.createServer((req, res) => {
    const requestId = req.headers["x-request-id"] || null;
    // Drain the body (unused) so "end" fires.
    req.resume();
    req.on("end", () => {
      calls.push({ method: req.method, path: req.url, requestId });
      if (req.method === "POST" && req.url === "/generate-description") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ description: "generated by the verification fake ML service" }));
        return;
      }
      // GET / (and anything else): fail, so /ping answers 503 -- a real 5xx.
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fake ML service: deliberately down" }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, calls, port: server.address().port }));
  });
}

function captureLines(stream, name, sink, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    for (let idx = buffer.indexOf("\n"); idx !== -1; idx = buffer.indexOf("\n")) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const line = parseLine(raw, name);
      sink.push(line);
      if (onLine) onLine(line);
    }
  });
  stream.on("end", () => {
    if (buffer !== "") sink.push(parseLine(buffer, name));
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function waitFor(predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function request(baseUrl, method, urlPath, { requestId, body, rawBody, token } = {}) {
  const headers = {};
  if (requestId) headers["X-Request-ID"] = requestId;
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (rawBody !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = rawBody;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return {
    status: res.status,
    json,
    sentRequestId: requestId || null,
    echoedRequestId: res.headers.get("x-request-id"),
  };
}

function runSmokeTest(baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, "smokeTest.js"), "--expect-role=web", baseUrl], {
      cwd: BACKEND_DIR,
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (c) => { output += c; });
    child.stderr.on("data", (c) => { output += c; });
    child.on("close", (exitCode) => resolve({ exitCode, output }));
  });
}

async function cleanupTestData(mongoConn, email) {
  const { MongoClient } = require("mongodb");
  const client = new MongoClient(mongoConn);
  const removed = {};
  try {
    await client.connect();
    const db = client.db();
    const user = await db.collection("users").findOne({ email });
    if (!user) return { removed, note: "test user not found (nothing to clean)" };
    // Everything this run created is keyed by the test user's _id. The
    // filter is that one ObjectId, so this cannot touch anyone else's data.
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    for (const { name } of collections) {
      if (name.startsWith("system.")) continue;
      const r = await db.collection(name).deleteMany({ userId: user._id });
      if (r.deletedCount) removed[name] = r.deletedCount;
    }
    const u = await db.collection("users").deleteOne({ _id: user._id });
    removed.users = u.deletedCount;
    return { removed };
  } finally {
    await client.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mongoConn = process.env.MONGO_CONN;
  const dbName = extractDbName(mongoConn);
  if (!dbName) {
    console.error("MONGO_CONN must be set and must name a database (…mongodb.net/<dbname>?…).");
    process.exit(1);
  }
  if (!isDisposableDbName(dbName) && !args.allowAnyDb) {
    console.error(
      `Refusing to run: database "${dbName}" does not look disposable. This run creates and deletes a test user.\n` +
      `Point MONGO_CONN at a staging/test copy, or pass --allow-any-db if you are certain.`
    );
    process.exit(1);
  }

  if (/<[^>]*>/.test(mongoConn)) {
    console.error("MONGO_CONN still contains a <placeholder> (e.g. <user>:<pass>) -- put the real credentials in.");
    process.exit(1);
  }
  // Fail fast on credentials/network before starting a server whose own
  // failure would only show up as an opaque startup_failed line.
  {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(mongoConn, { serverSelectionTimeoutMS: 15000 });
    try {
      await client.connect();
      await client.db().command({ ping: 1 });
    } catch (err) {
      console.error(`Cannot connect to "${dbName}": ${err && err.message}`);
      process.exit(1);
    } finally {
      await client.close().catch(() => {});
    }
  }

  const runId = crypto.randomBytes(4).toString("hex");
  const nodeEnv = process.env.NODE_ENV && process.env.NODE_ENV !== "production" ? process.env.NODE_ENV : "staging";
  const baseUrl = `http://127.0.0.1:${args.port}`;
  const secrets = {
    email: `obs-verify-${runId}@expense-manager.test`,
    password: `ObsVerify-${runId}-Pw!9`,
    amount: "98765.43",
    amountMinor: "9876543",
    amountMl: "87654.32",
    expenseName: `obsv-name-${runId}`,
    description: `obsv-desc-${runId}`,
  };
  const rid = (step) => `obsv-${runId}-${step}`;

  fs.mkdirSync(args.outDir, { recursive: true });
  const logPath = path.join(args.outDir, `obs-verify-${runId}.log`);
  const reportPath = path.join(args.outDir, `obs-verify-${runId}.json`);

  const ml = await startFakeMl();
  const childEnv = {
    ...process.env,
    PORT: String(args.port),
    NODE_ENV: nodeEnv,
    PROCESS_ROLE: "web",
    ML_ROUTE: `http://127.0.0.1:${ml.port}`,
    OBS_ALERT_ERROR_RATE_THRESHOLD: "0.01",
    JWT_SECRET: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
    REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(32).toString("hex"),
  };

  console.log(`[obs-verify ${runId}] starting server.js against database "${dbName}" on ${baseUrl}`);
  const lines = [];
  const server = spawn(process.execPath, ["server.js"], { cwd: BACKEND_DIR, env: childEnv });
  let serverExited = null;
  server.on("exit", (code) => { serverExited = code; });
  captureLines(server.stdout, "stdout", lines);
  captureLines(server.stderr, "stderr", lines);

  const requests = {};
  let smoke = { exitCode: null, output: "" };
  let cleanup = null;
  let abortReason = null;
  const startedAt = Date.now();

  try {
    const up = await waitFor(async () => {
      if (serverExited !== null) return true;
      try { return (await fetch(`${baseUrl}/health/live`)).status === 200; } catch { return false; }
    }, 90_000);
    if (!up || serverExited !== null) {
      throw new Error(`server did not become live (exit code ${serverExited}); last lines:\n${lines.slice(-15).map((l) => l.raw).join("\n")}`);
    }
    console.log(`[obs-verify ${runId}] server is live; running smoke test`);
    smoke = await runSmokeTest(baseUrl);

    console.log(`[obs-verify ${runId}] driving traffic`);
    requests.signup = await request(baseUrl, "POST", "/auth/signup", {
      requestId: rid("signup"),
      body: { fullName: "Obs Verify", email: secrets.email, password: secrets.password },
    });
    if (![201, 503].includes(requests.signup.status)) {
      throw new Error(`signup returned ${requests.signup.status}: ${JSON.stringify(requests.signup.json)}`);
    }
    // Same approach as e2e/global-setup.js: skip the emailed OTP by marking
    // the account verified directly.
    {
      const { MongoClient } = require("mongodb");
      const client = new MongoClient(mongoConn);
      try {
        await client.connect();
        await client.db().collection("users").updateOne(
          { email: secrets.email },
          {
            $set: { isVerified: true, isPasswordReset: false },
            $unset: { otp: "", otpExpiry: "", lastOtpSent: "", verificationExpiresAt: "", passwordResetExpiry: "" },
          }
        );
      } finally {
        await client.close();
      }
    }
    requests.loginWrongPassword = await request(baseUrl, "POST", "/auth/login", {
      requestId: rid("login-bad"),
      body: { email: secrets.email, password: `${secrets.password}-wrong` },
    });
    requests.login = await request(baseUrl, "POST", "/auth/login", {
      requestId: rid("login"),
      body: { email: secrets.email, password: secrets.password },
    });
    const token = requests.login.json && requests.login.json.token;
    if (!token) throw new Error(`login returned ${requests.login.status}; cannot continue without a token`);

    const today = new Date().toISOString().slice(0, 10);
    requests.expense = await request(baseUrl, "POST", "/expense/add-expense", {
      requestId: rid("expense"),
      token,
      body: {
        id: crypto.randomUUID(),
        expenseName: secrets.expenseName,
        expenseCategory: "Food",
        expenseAmount: Number(secrets.amount),
        expenseDate: today,
        expenseDescription: secrets.description,
      },
    });
    // No description -> the backend asks the (fake) ML service to generate
    // one, which is the downstream call whose X-Request-ID we check.
    requests.expenseWithMl = await request(baseUrl, "POST", "/expense/add-expense", {
      requestId: rid("expense-ml"),
      token,
      body: {
        id: crypto.randomUUID(),
        expenseName: `${secrets.expenseName}-ml`,
        expenseCategory: "Food",
        expenseAmount: Number(secrets.amountMl),
        expenseDate: today,
      },
    });
    requests.authedRead = await request(baseUrl, "GET", "/expense/last-week", { requestId: rid("read"), token });
    requests.malformedJson = await request(baseUrl, "POST", "/auth/login", {
      requestId: rid("bad-json"),
      rawBody: `{"email":"${secrets.email}","password":`,
    });
    for (let i = 0; i < PING_COUNT; i += 1) {
      requests[`ping${i}`] = await request(baseUrl, "GET", "/ping", { requestId: rid(`ping-${i}`) });
    }
    requests.noIdSent = await request(baseUrl, "GET", "/health/live");
    requests.malformedId = await request(baseUrl, "GET", "/health/live", { requestId: "not a valid id" });

    const statuses = Object.fromEntries(Object.entries(requests).map(([k, v]) => [k, v.status]));
    console.log(`[obs-verify ${runId}] responses: ${JSON.stringify(statuses)}`);

    const deadline = startedAt + args.waitMs;
    console.log(`[obs-verify ${runId}] waiting for the 5-minute metrics snapshot (up to ${Math.round((deadline - Date.now()) / 1000)}s)...`);
    const hasSnapshot = () => lines.some((l) => l.json && l.json.event === "metrics_snapshot" && (l.json.requestCount || 0) > 0);
    let lastTick = Date.now();
    await waitFor(() => {
      if (Date.now() - lastTick >= 30_000) {
        lastTick = Date.now();
        console.log(`[obs-verify ${runId}]   ...${Math.round((Date.now() - startedAt) / 1000)}s elapsed`);
      }
      return hasSnapshot() || serverExited !== null;
    }, Math.max(0, deadline - Date.now()), 1000);
    // The alert is evaluated right after the snapshot; give it (and a
    // best-effort email) a moment to be written.
    await sleep(3000);
  } catch (err) {
    abortReason = err.message;
    console.error(`[obs-verify ${runId}] run aborted: ${err.message}`);
  } finally {
    server.kill();
    await sleep(1000);
    ml.server.close();
    try {
      cleanup = await cleanupTestData(mongoConn, secrets.email);
    } catch (err) {
      cleanup = { error: err.message };
    }
  }

  let runbookText = null;
  try { runbookText = fs.readFileSync(ALERT_RUNBOOK_PATH, "utf8"); } catch { runbookText = null; }

  const ourRequestCount = Object.keys(requests).length;
  const results = analyzeRun({
    lines,
    secrets,
    requests,
    mlCalls: ml.calls,
    smoke,
    env: {
      errorProvider: process.env.ERROR_AGGREGATION_PROVIDER || "",
      ownerEmail: process.env.OBS_ALERT_OWNER_EMAIL || "",
      nodeEnv,
    },
    runbookText,
    minRequestCount: ourRequestCount,
    pingCount: PING_COUNT,
  });

  const report = formatReport(results, { runId, dbName, nodeEnv, lineCount: lines.length, abortReason });
  fs.writeFileSync(logPath, lines.map((l) => `[${l.stream}] ${l.raw}`).join("\n") + "\n");
  fs.writeFileSync(reportPath, JSON.stringify({ runId, dbName, nodeEnv, startedAt: new Date(startedAt).toISOString(), abortReason, results, cleanup, smokeOutput: smoke.output }, null, 2));

  console.log(report);
  console.log("");
  console.log(`test data cleanup: ${JSON.stringify(cleanup)}`);
  console.log(`raw server log: ${logPath}`);
  console.log(`JSON report:    ${reportPath}`);

  const failed = abortReason !== null || results.some((r) => r.required && r.status === "FAIL");
  process.exit(failed ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("verifyObservability crashed:", err && err.stack);
    process.exit(1);
  });
}

module.exports = {
  extractDbName,
  isDisposableDbName,
  parseLine,
  structuralProblems,
  groupUnstructured,
  analyzeRun,
  formatReport,
  parseArgs,
};
