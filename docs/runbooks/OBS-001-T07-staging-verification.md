# OBS-001-T07: Observability verification in staging

A checklist for whoever has staging deploy access to run once this batch
of OBS-001 work (T01-T06) is deployed there. This session cannot execute
any of it directly -- there is no staging environment reachable from this
sandbox, the same gate DAT-003-T07 and DAT-001-T06 hit for their own
staging-dependent steps. Everything below is real, specific, and grounded
in what T01-T06 actually built (not a generic "check your logs" list) --
it is the concrete verification T07 asks for, written down so it takes
minutes to run once someone has access, not a fresh investigation.

## Prerequisites

- A staging deployment running this branch's backend (and, once
  activated, the ML service).
- Shell/log access to that deployment (however this project normally
  tails logs -- container logs, a hosting platform's log viewer, etc.).
- A way to make a handful of real HTTP requests against the staging
  backend (`curl`, Postman, or the deployed frontend itself).

## 1. Redaction policy (T01) -- no financial data or PII in raw logs

Trigger a few ordinary authenticated requests that touch real data:
create an expense with a specific, greppable amount and description, log
in with a specific email, and trigger a 4xx (e.g. a malformed request
body) and a 5xx if you can safely force one.

**Check:** grep the resulting log output for the raw amount, description,
email, and password you used. None should appear verbatim -- only
whatever T01's redaction policy explicitly allows through (check
`docs/decisions/` for T01's own ADR/policy doc for the exact allowed
field list before judging pass/fail here, since "redacted" doesn't mean
"absent," it means matching that documented policy).

**Expected:** every log line touching that request is either free of the
sensitive fields entirely, or has them replaced with the policy's
documented redaction marker (e.g. `[REDACTED]` or similar -- confirm the
exact convention from the policy doc, don't assume a specific string).

## 2. Request/correlation ID propagation (T02)

Make one request with a client-supplied correlation/request ID header
(check `backend/Middlewares/requestId.middleware.js` for the exact header
name this repo uses) and one without.

**Check:** every log line emitted while handling that request carries the
same ID -- the client-supplied one when given, and a server-generated one
otherwise (confirm it's actually present, not blank/undefined). If the
request touches the ML service or any other downstream call, confirm the
ID is forwarded there too, not just used locally.

**Expected:** one correlation ID appears consistently across every log
line for a single request/response cycle, including into downstream
service calls.

## 3. Structured log format (T03)

**Check:** pull a sample of recent log lines (a mix of info/warn/error,
across a few different routes) and confirm every one is valid, parseable
structured output (JSON or whatever format T03 standardized on -- check
`backend/utils/logger.js`) with the fields T03's own design specifies
present and correctly typed (not stringified numbers where numbers are
expected, timestamps in the documented format, etc.).

**Expected:** no free-text/unstructured log lines mixed in from the
paths this batch of work touched (a stray `console.log` somewhere is the
most common way this silently regresses -- if you find one, it's a real
bug worth filing, not a false alarm).

## 4. Error aggregation (T04) -- verify the CURRENT state, whichever it is

T04 shipped a vendor-agnostic error-reporting module
(`backend/utils/errorReporter.js`) that defaults to a structured no-op
unless an owner has since chosen a vendor and configured it (see
`docs/runbooks/OBS-001-T04-error-aggregation-setup.md`). This step
verifies whichever of the two states is actually true in staging --
it does not assume one.

**If `ERROR_AGGREGATION_PROVIDER` is unset in staging (the shipped
default):** trigger an error (e.g. hit a route with malformed input) and
confirm in the logs that a structured `transport_init_failed`-style or
no-op debug line appears where a real report *would* have gone, and
confirm nothing was actually sent anywhere external (no outbound call to
a vendor). This is the expected, supported state until an owner acts on
the T04 runbook.

**If a vendor has since been configured** (`ERROR_AGGREGATION_PROVIDER`
set, e.g. to `sentry`, with a real DSN): trigger a real error the same
way, then confirm it actually appears in that vendor's dashboard within a
reasonable delay, tagged with the correct environment (`staging`, not
`production` or `development`) and carrying the same correlation ID as
step 2 -- and confirm none of the fields step 1 found redacted show up
unredacted in the vendor's UI either. A vendor integration that leaks
what the app's own logs already redact is a real regression, not
acceptable just because "the vendor decision was made."

## 5. Metrics (T05)

**Check:** hit whatever metrics endpoint/snapshot mechanism T05 built
(check `backend/utils/metrics.js` and however it's exposed --
`/ml-status`-style endpoint, a scrape endpoint, or an internal snapshot
function) after generating a small amount of real traffic (a mix of
successful and failing requests across a couple of routes).

**Expected:** `requestCount`, `distinctRoutes`, error-rate, and latency
figures reflect the real traffic you just generated (not zeros, not
obviously stale numbers from before your test traffic).

## 6. Alerts and runbook links (T06)

This is the one step worth deliberately forcing a real threshold breach
for, since alerts firing correctly is exactly the kind of thing that only
proves itself under real load, not a code review.

**Check:** temporarily lower `OBS_ALERT_ERROR_RATE_THRESHOLD` (or
`OBS_ALERT_LATENCY_MS_THRESHOLD`) to something trivially easy to trigger
in staging only (never in production), generate enough failing/slow
requests to cross `MIN_SAMPLE_SIZE`, and confirm: (a) a structured
`scope: "alert"` log line appears, (b) if `OBS_ALERT_OWNER_EMAIL` is
configured in staging, a real email arrives via the existing Brevo
integration, and (c) the alert (in the log line, and the email if sent)
links to the correct section of `docs/runbooks/OBS-001-alerts.md` for
that specific alert type. Restore the threshold to its real value
afterward.

**Expected:** all three fire correctly, and the runbook link actually
resolves to real, relevant content (not a 404 or the wrong section).

## Sign-off

Once every step above has been run and passed, T07 -- and OBS-001 as a
whole -- can be marked genuinely Done in the tracker, not just
code-complete. Record the date, who ran it, and which staging environment
was used, next to this checklist or in the tracker's notes for T07.
