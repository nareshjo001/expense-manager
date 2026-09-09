#!/usr/bin/env node
"use strict";

// TST-001-T07 -- deployment smoke test.
//
// OPS-004's runbook has a smoke-test section a human works through by hand:
// curl six endpoints, read the JSON, decide whether each field means what it
// should. That is fine once. It is not fine as the thing standing between a
// bad deploy and your users, because it is slow, it is skippable, and under
// pressure people skip the steps that have never failed before -- which are
// exactly the steps that catch the deploy where something moved.
//
// This is that section, executable. One command, a pass/fail per check, and
// a non-zero exit code so a deploy pipeline can gate on it.
//
// READ-ONLY, ON PURPOSE. Every request here is a GET against an endpoint
// that either needs no authentication or is expected to REFUSE the request.
// Nothing is created, updated or deleted, no account is touched, and no
// credentials are needed. That is what makes it safe to point at production
// immediately after a deploy -- which is when you most want to run it and
// least want to think about whether it is safe.
//
// REQUIRED vs INFORMATIONAL is the distinction that makes the output
// trustworthy. A required check failing means this deployment is broken and
// the exit code says so. An informational one reports a real fact that is
// not, by itself, grounds to roll back -- Redis being down degrades caching
// and job coordination but the app serves correctly without it (ADR-0002),
// and the ML service being down disables category prediction and nothing
// else. Marking those as failures would train people to ignore a red run,
// which is worse than not having the check.
//
// Usage:
//   node scripts/smokeTest.js https://balenisa-backend.onrender.com
//   node scripts/smokeTest.js --expect-role=web https://...
//   SMOKE_BASE_URL=https://... node scripts/smokeTest.js
//
// Exit code: 0 if every REQUIRED check passed, 1 otherwise.

const DEFAULT_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Tiny HTTP helper. Uses the global fetch (Node 18+; CI and the deploy target
// both run 20). No dependency, because a smoke test that cannot run until you
// have installed something is one more thing to go wrong at the worst moment.
// ---------------------------------------------------------------------------

async function get(baseUrl, path, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = new URL(path, baseUrl).toString();
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON. Several checks below care about that, so it is recorded
    // rather than thrown.
  }

  return { status: response.status, headers: response.headers, text, json };
}

// ---------------------------------------------------------------------------
// Checks.
//
// Each returns { ok, detail }. `detail` is written to be read during an
// incident: it says what was actually observed, not just "failed".
// ---------------------------------------------------------------------------

function buildChecks({ expectRole }) {
  return [
    {
      id: "health.live",
      title: "Liveness probe responds",
      required: true,
      why: "If /health/live is not 200, the platform's restart check will loop this service.",
      async run(base) {
        const res = await get(base, "/health/live");
        if (res.status !== 200) return { ok: false, detail: `expected 200, got ${res.status}` };
        if (!res.json || res.json.status !== "live") {
          return { ok: false, detail: `expected status:"live", got ${JSON.stringify(res.json)}` };
        }
        if (typeof res.json.uptimeSeconds !== "number") {
          return { ok: false, detail: "uptimeSeconds missing or not a number" };
        }
        return { ok: true, detail: `up ${res.json.uptimeSeconds}s, role "${res.json.role}"` };
      },
    },

    {
      id: "health.ready",
      title: "Readiness probe reports MongoDB reachable",
      required: true,
      why: "MongoDB is the authoritative store (ADR-0002). Without it nearly every route errors, and this instance should not be taking traffic.",
      async run(base) {
        const res = await get(base, "/health/ready");
        if (res.status === 503) {
          return {
            ok: false,
            detail: "503 -- MongoDB is unreachable. Check MONGO_CONN and the database's network allowlist before anything else; those two account for nearly every occurrence.",
          };
        }
        if (res.status !== 200) return { ok: false, detail: `expected 200 or 503, got ${res.status}` };
        if (!res.json || res.json.mongo !== "up") {
          return { ok: false, detail: `200 but mongo is not "up": ${JSON.stringify(res.json)}` };
        }
        return { ok: true, detail: "mongo up" };
      },
    },

    {
      id: "process.role",
      title: "Process role is what this service is meant to be",
      // Required only when the caller stated an expectation. Without one
      // there is nothing to be wrong about.
      required: Boolean(expectRole),
      why: 'A web service reporting role "all" is also running every scheduled job, so scaling it multiplies job execution (OPS-004-T05).',
      async run(base) {
        const res = await get(base, "/health/live");
        const role = res.json && res.json.role;
        if (!role) return { ok: false, detail: "no role reported" };
        if (!expectRole) {
          return {
            ok: true,
            detail: role === "all"
              ? 'role "all" -- this process serves HTTP AND runs the scheduled jobs. Correct for a single-process deploy; wrong for a scaled web tier. Pass --expect-role=web to assert.'
              : `role "${role}"`,
          };
        }
        if (role !== expectRole) {
          return { ok: false, detail: `expected role "${expectRole}", got "${role}"` };
        }
        return { ok: true, detail: `role "${role}"` };
      },
    },

    {
      id: "health.deps",
      title: "Dependency report is reachable and well-formed",
      required: true,
      why: "This endpoint is how an operator sees which dependencies are degraded. It must answer even when they are.",
      async run(base) {
        const res = await get(base, "/health/deps");
        if (res.status !== 200) {
          return { ok: false, detail: `expected 200 regardless of dependency state, got ${res.status}` };
        }
        const deps = res.json && res.json.dependencies;
        if (!deps) return { ok: false, detail: "no dependencies object in the response" };
        const summary = Object.entries(deps).map(([k, v]) => `${k}=${v}`).join(" ");
        if (deps.mongo !== "up") return { ok: false, detail: `mongo is "${deps.mongo}" -- ${summary}` };
        return { ok: true, detail: summary };
      },
    },

    {
      id: "deps.redis",
      title: "Redis is connected",
      required: false,
      why: "Disposable by design (ADR-0002): caching falls through to MongoDB and scheduled jobs fail closed (REC-001-T03). Not grounds to roll back -- but do not finish a deploy leaving it down, or you find out weeks later when someone asks why recurring expenses stopped.",
      async run(base) {
        const res = await get(base, "/health/deps");
        const state = res.json && res.json.dependencies && res.json.dependencies.redis;
        return state === "up"
          ? { ok: true, detail: "connected" }
          : { ok: false, detail: `redis is "${state}" -- caching disabled, fail-closed jobs will skip their cycles` };
      },
    },

    {
      id: "deps.ml",
      title: "ML service is reachable",
      required: false,
      why: "Optional capability. Its absence disables category prediction and description generation; nothing else changes.",
      async run(base) {
        const res = await get(base, "/health/deps");
        const state = res.json && res.json.dependencies && res.json.dependencies.ml;
        if (state === "up") return { ok: true, detail: "reachable" };
        if (state === "not_configured") {
          return { ok: false, detail: "ML_ROUTE is not set -- capability is off. Intentional or not, decide which." };
        }
        return { ok: false, detail: `ml is "${state}" -- category prediction degrades` };
      },
    },

    {
      id: "ping.compat",
      title: "/ping still answers in its original shape",
      required: true,
      why: "The frontend and existing monitoring read this endpoint. Its 503-when-ML-is-down behaviour is intentional and preserved; what must not change is the shape.",
      async run(base) {
        const res = await get(base, "/ping");
        // 503 here means the ML service is down. That is /ping's documented
        // meaning, and it is why nothing automated should be pointed at it --
        // but it is NOT a smoke-test failure.
        if (![200, 503].includes(res.status)) {
          return { ok: false, detail: `expected 200 or 503, got ${res.status}` };
        }
        const body = res.json || {};
        for (const field of ["backend", "ml", "push"]) {
          if (!(field in body)) return { ok: false, detail: `missing "${field}" field: ${res.text.slice(0, 200)}` };
        }
        return {
          ok: true,
          detail: res.status === 503
            ? "503 (ML down) -- expected shape, and not a deployment failure"
            : "200, expected shape",
        };
      },
    },

    {
      id: "auth.enforced",
      title: "Authenticated routes refuse an unauthenticated request",
      required: true,
      why: "The worst possible smoke-test failure is a deploy serving user data without authentication. If this check ever fails, stop and roll back before diagnosing.",
      async run(base) {
        const routes = ["/report", "/expense", "/income"];
        const wrong = [];
        for (const route of routes) {
          const res = await get(base, route);
          // 401 is the contract. 403 and 404 are acceptable in the sense
          // that they also do not serve data; anything 2xx is not.
          if (res.status < 400) wrong.push(`${route} -> ${res.status}`);
        }
        if (wrong.length) {
          return { ok: false, detail: `SERVING WITHOUT AUTH: ${wrong.join(", ")}` };
        }
        return { ok: true, detail: `${routes.length} routes refuse unauthenticated access` };
      },
    },

    {
      id: "obs.requestId.echo",
      title: "Correlation ID is echoed back (OBS-001-T02)",
      required: true,
      why: "The correlation ID is what ties a user's report of a problem to the log lines for that exact request. If it is not echoed, that link does not exist.",
      async run(base) {
        const sent = `smoke-${Date.now()}`;
        const res = await get(base, "/health/live", { headers: { "X-Request-ID": sent } });
        const echoed = res.headers.get("x-request-id");
        if (!echoed) return { ok: false, detail: "no X-Request-ID on the response" };
        if (echoed !== sent) {
          return { ok: false, detail: `sent "${sent}", got back "${echoed}"` };
        }
        return { ok: true, detail: "client-supplied ID preserved" };
      },
    },

    {
      id: "obs.requestId.generated",
      title: "A correlation ID is generated when the client sends none",
      required: true,
      why: "Most real traffic sends no ID. If the server does not mint one, those requests are the ones you cannot trace -- and they are the majority.",
      async run(base) {
        const res = await get(base, "/health/live");
        const generated = res.headers.get("x-request-id");
        if (!generated) return { ok: false, detail: "no X-Request-ID generated" };
        return { ok: true, detail: `generated (${generated.length} chars)` };
      },
    },

    {
      id: "obs.requestId.hostile",
      title: "A malformed correlation ID is replaced, not echoed",
      required: true,
      why: "The header is attacker-controlled and ends up in log lines. A value carrying spaces, quotes or angle brackets can corrupt a parsed log stream; requestId.js only reuses a caller's value when it matches [A-Za-z0-9._-]{1,128}, and this proves that guard is live in the deployed build.",
      async run(base) {
        // Deliberately NOT a CRLF payload. Node's HTTP client refuses to
        // transmit header values containing CR or LF, so a CRLF probe never
        // reaches the server and the check would pass without testing
        // anything. This value is hostile in the way that matters -- it fails
        // requestId.js's pattern -- and is transmittable, so the server is
        // genuinely the thing being tested.
        const hostile = 'smoke "injected" id <with> spaces';
        const res = await get(base, "/health/live", { headers: { "X-Request-ID": hostile } });

        const echoed = res.headers.get("x-request-id") || "";
        if (!echoed) return { ok: false, detail: "no X-Request-ID on the response" };
        if (echoed === hostile || echoed.includes("injected")) {
          return { ok: false, detail: `malformed value echoed back verbatim: ${JSON.stringify(echoed)}` };
        }
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(echoed)) {
          return { ok: false, detail: `replacement is itself malformed: ${JSON.stringify(echoed)}` };
        }
        return { ok: true, detail: "replaced with a safely-shaped generated ID" };
      },
    },

    {
      id: "sec.headers",
      title: "Security headers are present (SEC-001)",
      required: true,
      why: "helmet is applied in app.js. Their absence means the middleware chain is not what the code says it is.",
      async run(base) {
        const res = await get(base, "/health/live");
        const missing = [];
        if (res.headers.get("x-content-type-options") !== "nosniff") missing.push("X-Content-Type-Options: nosniff");
        if (!res.headers.get("content-security-policy")) missing.push("Content-Security-Policy");
        if (res.headers.get("referrer-policy") !== "no-referrer") missing.push("Referrer-Policy: no-referrer");
        if (missing.length) return { ok: false, detail: `missing: ${missing.join(", ")}` };
        return { ok: true, detail: "nosniff, CSP and referrer-policy present" };
      },
    },

    {
      id: "sec.hsts",
      title: "HSTS is set (production only)",
      required: false,
      why: "httpSecurity.js enables Strict-Transport-Security only when NODE_ENV=production. Its absence on a production deploy means NODE_ENV is not what you think it is -- which also means CORS and secure cookies are not either.",
      async run(base) {
        const res = await get(base, "/health/live");
        const hsts = res.headers.get("strict-transport-security");
        if (hsts) return { ok: true, detail: hsts };
        return {
          ok: false,
          detail: "not set -- expected on a production deployment; harmless in a non-production environment",
        };
      },
    },

    {
      id: "sec.cors",
      title: "An unknown Origin is not granted CORS access",
      required: true,
      why: "If a disallowed origin gets access-control-allow-origin echoed back, CORS_ALLOWED_ORIGINS is misconfigured -- most often set to a wildcard to make something work.",
      async run(base) {
        const res = await get(base, "/health/live", {
          headers: { Origin: "https://smoke-test-definitely-not-allowed.example" },
        });
        const allowed = res.headers.get("access-control-allow-origin");
        if (!allowed) return { ok: true, detail: "no access-control-allow-origin returned" };
        if (allowed === "*") {
          return { ok: false, detail: 'access-control-allow-origin is "*" -- any site can call this API from a browser' };
        }
        if (allowed.includes("smoke-test-definitely-not-allowed")) {
          return { ok: false, detail: `unknown origin echoed back: ${allowed}` };
        }
        return { ok: true, detail: `unrelated origin not echoed (returned "${allowed}")` };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  let expectRole = null;
  let baseUrl = process.env.SMOKE_BASE_URL || null;
  let json = false;

  for (const arg of args) {
    if (arg.startsWith("--expect-role=")) expectRole = arg.split("=")[1];
    else if (arg === "--json") json = true;
    else if (!arg.startsWith("--")) baseUrl = arg;
  }

  return { baseUrl, expectRole, json };
}

async function runSmokeTest({ baseUrl, expectRole = null } = {}) {
  const checks = buildChecks({ expectRole });
  const results = [];

  for (const check of checks) {
    let result;
    try {
      result = await check.run(baseUrl);
    } catch (err) {
      // A thrown check is a failed check, never a crashed run -- the other
      // checks still carry information, and an operator should get the whole
      // picture in one pass rather than one failure at a time.
      result = {
        ok: false,
        detail: `request failed: ${err && err.message}`,
      };
    }
    results.push({ ...check, ...result, run: undefined });
  }

  const requiredFailures = results.filter((r) => r.required && !r.ok);
  const advisories = results.filter((r) => !r.required && !r.ok);

  return { results, requiredFailures, advisories, ok: requiredFailures.length === 0 };
}

function report({ results, requiredFailures, advisories, ok }, baseUrl) {
  const lines = [];
  lines.push(`Deployment smoke test -- ${baseUrl}`);
  lines.push("");

  for (const r of results) {
    const mark = r.ok ? "PASS" : r.required ? "FAIL" : "WARN";
    lines.push(`  [${mark}] ${r.title}`);
    lines.push(`         ${r.detail}`);
    if (!r.ok) lines.push(`         why it matters: ${r.why}`);
  }

  lines.push("");
  if (ok && advisories.length === 0) {
    lines.push(`All ${results.length} checks passed.`);
  } else if (ok) {
    lines.push(
      `Passed, with ${advisories.length} advisory (${advisories.map((a) => a.id).join(", ")}). ` +
        "These are degraded states the app serves correctly through -- not grounds to roll back, but do not leave them unresolved."
    );
  } else {
    lines.push(
      `FAILED: ${requiredFailures.length} required check(s) -- ${requiredFailures.map((f) => f.id).join(", ")}.`
    );
  }

  return lines.join("\n");
}

async function main() {
  const { baseUrl, expectRole, json } = parseArgs(process.argv);

  if (!baseUrl) {
    console.error(
      "Usage: node scripts/smokeTest.js <base-url> [--expect-role=web|worker|all] [--json]\n" +
        "   or: SMOKE_BASE_URL=<base-url> node scripts/smokeTest.js"
    );
    process.exit(2);
  }

  const outcome = await runSmokeTest({ baseUrl, expectRole });

  if (json) {
    console.log(JSON.stringify({ baseUrl, ...outcome }, null, 2));
  } else {
    console.log(report(outcome, baseUrl));
  }

  process.exit(outcome.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Smoke test crashed:", err && err.message);
    process.exit(1);
  });
}

module.exports = { runSmokeTest, buildChecks, report, parseArgs };
