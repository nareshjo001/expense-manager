# OBS-001-T04 error aggregation setup

Status as of this writing: **code-feasible work is done; nothing is
activated.** This file tells the eventual owner exactly what remains -- a
vendor decision and real credentials, neither of which this session could
make or fabricate -- and the one env-var change that turns it on.

## What exists today

`backend/utils/errorReporter.js` is a vendor-agnostic error-aggregation
module: `reportError(error, context)`. It is already wired into the app's
real error paths:

- `backend/Middlewares/error.middleware.js` (the centralized Express error
  handler, OBS-001-T03) -- every unhandled request error, alongside its
  existing structured log line.
- `backend/server.js` -- `process.on("uncaughtException", ...)`,
  `process.on("unhandledRejection", ...)`, and the server startup `catch`
  block. None of these process-level handlers existed before this task;
  they were added so a crash is reported (with an environment tag) before
  the process exits, without changing the fail-fast outcome Node already
  has by default on this Node version.

By default -- i.e. right now, with no configuration -- every call goes to a
`NoopTransport`: nothing is sent anywhere, no network call is made, and no
third-party SDK is loaded. Each call instead emits one structured
`scope: "errorReporter", event: "noop_report"` log line (via the existing
OBS-001 logger, `backend/utils/logger.js`) so "a report would have been
sent here" stays observable in the same structured logs everything else in
this app already uses. This is a supported, permanent configuration for any
environment that never wants a third-party vendor -- not a degraded one.

## Why this stayed blocked, and what "unblocked" means here

The project tracker previously showed OBS-001-T04 as **Blocked**: *"needs
an owner decision on a third-party vendor (Sentry/Datadog/etc.) per the
spec's architecture/privacy requirement; skipped for now per owner
instruction."*

That vendor decision -- which product, whether this financial-data app's
architecture/privacy requirements let a third party receive any error
context at all, signing up for an account, and generating a real DSN/API
key -- is **still** not made, and still cannot be made from this session:
it needs a human owner's judgment and real, non-fabricated credentials.

What changed is that the *integration point* no longer has to wait on that
decision. The abstraction, the redaction-safe context it builds, the
environment tagging, and a reference vendor transport all exist and are
exercised by real tests today. Turning on a real vendor later is a
one-file, two-env-var change -- not a rewrite.

## Redaction: what a transport can ever receive

Every transport -- including a future non-Sentry one -- only ever receives
two pre-built objects, produced by explicit allowlist code in
`errorReporter.js` (no spreading of caller-supplied objects, matching the
same safety model as `backend/utils/logger.js` and `backend/sia/
safeLogger.js`):

- **`safeError`**: `{ name, message }` from the thrown `Error`, truncated
  to 500 characters. Never `.stack` (file paths/internals) and never any
  custom property a caller may have attached to the error object (a raw
  request body, an amount, a token, etc.).
- **`safeContext`**: `{ environment, requestId, route, method, statusCode,
  errorCode, scope, event }` -- the exact field set OBS-001-T01/T03 already
  treat as safe to log in `error.middleware.js`'s existing `logEvent` call,
  plus the environment tag. `requestId` is re-validated against the same
  safe-shape pattern as `backend/Middlewares/requestId.js`. No financial
  amount, merchant name, user email, or other PII field is ever read by
  this module, by construction -- there is no code path through which one
  could reach a transport.

## Environment tagging

Every report carries `environment`, resolved from `process.env.NODE_ENV`
(the app's existing convention -- see `backend/config/httpSecurity.js`,
`backend/Services/AuthServices/session.service.js`), lowercased, defaulting
to `"development"` when unset. No new environment-detection convention was
introduced.

## Reference transport: Sentry

`errorReporter.js` includes a **reference** `SentryTransport`, written
against Sentry's stable, documented Node SDK shape
(`Sentry.init` / `Sentry.captureException` --
https://docs.sentry.io/platforms/node/). It is deliberately **not** wired
to an installed SDK by this task:

- `@sentry/node` is **not** added to `package.json` as a dependency.
- The transport's `require("@sentry/node")` is reached only when
  `ERROR_AGGREGATION_PROVIDER=sentry` is explicitly set, and is wrapped in
  try/catch. If the package isn't installed, `errorReporter.js` logs a
  `transport_init_failed` warning and falls back to `NoopTransport` --
  it never crashes the app.
- An app that never sets `ERROR_AGGREGATION_PROVIDER=sentry` never
  `require()`s `@sentry/node` at all, installed or not.

This choice (a written-but-inert reference implementation, over adding a
real SDK dependency now) was made deliberately: installing a real
third-party SDK into a financial-data application's dependency tree is
itself part of the architecture/privacy decision this task is not the
owner to make, and this sandbox's network access is not a substitute for
that decision either. Once a vendor is approved, activating it is the
"To activate" steps below -- no code changes required for Sentry
specifically.

### To activate Sentry for real

An owner needs to do all of the following in a real deployment environment
(none of this is done, or done for you, by anything in this codebase):

1. **Make the vendor decision.** Confirm Sentry (or re-evaluate against
   Datadog/Rollbar/etc. -- see "Changing vendors" below) satisfies this
   app's architecture/privacy requirements for a financial-data product.
2. **Create a Sentry account and project**, and obtain a real DSN.
3. **Install the SDK**: `npm install @sentry/node` in `backend/`.
4. **Set two environment variables** in the real deployment environment
   (not committed to the repo, same convention as every other secret this
   app already uses, e.g. `FIREBASE_SERVICE_ACCOUNT`, `GROQ_API_KEY`):
   - `ERROR_AGGREGATION_PROVIDER=sentry`
   - `SENTRY_DSN=<the real DSN from step 2>`
5. Restart the app. `errorReporter.js` will initialize Sentry once per
   process and start sending reports; the `NoopTransport`'s structured
   `noop_report` log lines stop appearing for `reportError` calls (an
   `error_reported`-equivalent flow now goes to Sentry instead).

No other code change is required for the Sentry path specifically.

### Changing vendors later

Swapping Sentry for Datadog, Rollbar, or anything else is a one-file
change: add a new transport factory in `errorReporter.js` (same shape as
`createSentryTransport` -- accept `(safeError, safeContext)`, return
`{ name, send }`), branch on a new `ERROR_AGGREGATION_PROVIDER` value in
`getTransport()`, and lazily `require()` that vendor's SDK the same way.
Nothing in `error.middleware.js`, `server.js`, or any other caller of
`reportError()` needs to change -- they only ever call the stable
`reportError(error, context)` interface.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ERROR_AGGREGATION_PROVIDER` | unset (`NoopTransport`) | `"sentry"` activates the Sentry transport (only if `SENTRY_DSN` is also set and `@sentry/node` is installed); any other/unset value stays on `NoopTransport`. |
| `SENTRY_DSN` | unset | Required alongside `ERROR_AGGREGATION_PROVIDER=sentry`. Never commit a real value to the repo. |

## Explicitly not done by this session

- No vendor was chosen. Sentry is used only as the reference
  implementation because it is the most common Node.js choice -- this is
  not an endorsement or a decision on the owner's behalf.
- No account was created and no real DSN was generated or used anywhere in
  this codebase or its tests (all tests exercise the missing-DSN and
  SDK-not-installed fallback paths, never a live Sentry project).
- `@sentry/node` was not installed as a dependency.
- Nothing in this codebase currently sends error data to any third party.

See also `docs/runbooks/OBS-001-alerts.md` (OBS-001-T06), which alerts on
aggregate metrics using already-approved infrastructure and links back to
this file for the vendor-decision context.
