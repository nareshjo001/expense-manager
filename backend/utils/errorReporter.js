// OBS-001-T04 -- vendor-agnostic error-aggregation integration point, with
// environment tagging. This module is the stable interface the rest of the
// codebase calls (`reportError`); which third-party vendor (if any) actually
// receives the report is a pluggable "transport" selected by a single env
// var (`ERROR_AGGREGATION_PROVIDER`).
//
// Status: code-feasible work is done. The vendor DECISION itself (Sentry vs.
// Datadog vs. Rollbar vs. none) is explicitly NOT made here -- that needs a
// human owner and real account/DSN, neither of which this session has. See
// docs/runbooks/OBS-001-T04-error-aggregation-setup.md for exactly what an
// owner needs to do to turn this on for real.
//
// Safety model (mirrors backend/utils/logger.js and sia/safeLogger.js):
// `reportError(error, context)`'s `context` is destructured into an explicit
// allowlist of named, primitive-typed fields -- there is no spread of
// caller-supplied data anywhere in this file. A caller cannot smuggle a raw
// request body, financial amount, or other PII into a report just by
// passing a bigger `context` object; only the fields named in
// `buildSafeContext` below are ever read, matching the same fields
// OBS-001-T01/T03 already treat as safe to log (backend/Middlewares/
// error.middleware.js's existing logEvent call uses this exact field set).
//
// Never-throws guarantee: error reporting exists to report errors FROM the
// app, so a broken/misconfigured transport (network failure, bad SDK state,
// vendor outage) must never itself crash the app or the request that
// triggered it. Every external call in this file is wrapped so reportError
// can never throw.
"use strict";

const { logEvent, safeString, safeRequestId } = require("./logger");

const SCOPE = "errorReporter";
const MAX_MESSAGE_LENGTH = 500;

const NOOP_PROVIDER = "none";
const SENTRY_PROVIDER = "sentry";

// --- environment tagging ---------------------------------------------------
// Reuses the app's existing NODE_ENV convention (see config/httpSecurity.js,
// Services/AuthServices/session.service.js) rather than inventing a new one.
function resolveEnvironmentTag() {
  const raw = typeof process.env.NODE_ENV === "string" ? process.env.NODE_ENV.trim().toLowerCase() : "";
  return raw !== "" ? raw : "development";
}

// --- redaction-safe context / error shaping ---------------------------------
// Explicit allowlist destructure -- see file header. Anything not named here
// is silently dropped, never forwarded to a transport.
function buildSafeContext(context) {
  const { requestId, route, path, method, statusCode, errorCode, scope, event } = context || {};
  return {
    environment: resolveEnvironmentTag(),
    requestId: safeRequestId(requestId),
    route: safeString(route || path, 200),
    method: safeString(method, 20),
    statusCode: typeof statusCode === "number" && Number.isFinite(statusCode) ? statusCode : null,
    errorCode: safeString(errorCode, 100),
    scope: safeString(scope, 50) || "app",
    event: safeString(event, 100) || "unhandled_error",
  };
}

// Only ever forwards an error's name/message (truncated) -- never `.stack`
// (file paths/internals) and never any custom enumerable property a caller
// might have attached to an Error (e.g. `err.body`, `err.details`).
function normalizeError(error) {
  if (error instanceof Error) {
    return {
      name: safeString(error.name, 100) || "Error",
      message: safeString(error.message, MAX_MESSAGE_LENGTH) || "(no message)",
    };
  }
  return {
    name: "NonErrorThrown",
    message: safeString(typeof error === "string" ? error : String(error), MAX_MESSAGE_LENGTH) || "(unrepresentable value)",
  };
}

// --- NoopTransport -----------------------------------------------------------
// Default transport. Sends nothing anywhere; emits a structured debug-level
// log line instead, so "a report would have been sent here" is observable
// (e.g. in local dev, or in an environment that hasn't opted into a vendor)
// without ever making a network call.
function createNoopTransport() {
  return {
    name: NOOP_PROVIDER,
    send(safeError, safeContext) {
      logEvent({
        level: "info",
        scope: SCOPE,
        event: "noop_report",
        requestId: safeContext.requestId,
        route: safeContext.route,
        environment: safeContext.environment,
        errorCode: safeError.name,
      });
    },
  };
}

// --- SentryTransport (reference implementation) ------------------------------
// Reference vendor implementation, written against Sentry's stable, well-
// documented Node SDK shape (Sentry.init / Sentry.captureException --
// https://docs.sentry.io/platforms/node/). Deliberately NOT wired to an
// installed SDK by this task: `@sentry/node` is not added as a project
// dependency here (see docs/runbooks/OBS-001-T04-error-aggregation-setup.md
// for why, and the exact activation steps). The require below is reached
// only when ERROR_AGGREGATION_PROVIDER=sentry is explicitly set, is wrapped
// in try/catch, and never runs at all otherwise -- so an app that never
// configures Sentry never touches the Sentry SDK, installed or not.
let sentrySdkSingleton = null; // memoized: Sentry.init() runs at most once per process

function createSentryTransport() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    throw new Error("ERROR_AGGREGATION_PROVIDER=sentry but SENTRY_DSN is not set");
  }

  if (!sentrySdkSingleton) {
    let Sentry;
    try {
      // eslint-disable-next-line global-require -- intentionally lazy, see file header
      Sentry = require("@sentry/node");
    } catch {
      throw new Error(
        "@sentry/node is not installed -- run `npm install @sentry/node` to activate the Sentry transport " +
          "(see docs/runbooks/OBS-001-T04-error-aggregation-setup.md)"
      );
    }

    Sentry.init({
      dsn,
      environment: resolveEnvironmentTag(),
      // OBS-001-T01/T03 financial-data redaction policy backstop: this
      // transport is only ever called with the pre-redacted, allowlisted
      // safeError/safeContext this file builds -- never a raw Error's
      // custom properties, a request body, or an amount/PII field. These
      // two settings are a second, independent layer of protection in case
      // a future caller/SDK default would otherwise widen what leaves the
      // process (e.g. Sentry's own request-body capture).
      sendDefaultPii: false,
      beforeSend(sentryEvent) {
        if (sentryEvent && sentryEvent.request) {
          delete sentryEvent.request.data;
          delete sentryEvent.request.cookies;
          delete sentryEvent.request.headers;
        }
        return sentryEvent;
      },
    });

    sentrySdkSingleton = Sentry;
  }

  return {
    name: SENTRY_PROVIDER,
    send(safeError, safeContext) {
      const syntheticError = new Error(safeError.message);
      syntheticError.name = safeError.name;
      sentrySdkSingleton.captureException(syntheticError, {
        tags: {
          environment: safeContext.environment,
          scope: safeContext.scope,
          event: safeContext.event,
          errorCode: safeContext.errorCode || undefined,
          route: safeContext.route || undefined,
          method: safeContext.method || undefined,
        },
        extra: {
          requestId: safeContext.requestId,
          statusCode: safeContext.statusCode,
        },
      });
    },
  };
}

// --- transport selection ------------------------------------------------------
let cachedTransport = null;
let cachedProviderKey = null;

function currentProviderKey() {
  const raw = typeof process.env.ERROR_AGGREGATION_PROVIDER === "string" ? process.env.ERROR_AGGREGATION_PROVIDER.trim().toLowerCase() : "";
  return raw;
}

// Lazy, memoized transport resolution -- mirrors config/firebaseAdmin.js's
// guarded-singleton pattern for an optional capability. Re-resolves if the
// configured provider value changes at runtime (tests toggle process.env
// directly rather than restarting the process).
function getTransport() {
  const providerKey = currentProviderKey();
  if (cachedTransport && cachedProviderKey === providerKey) {
    return cachedTransport;
  }
  cachedProviderKey = providerKey;

  if (providerKey === SENTRY_PROVIDER) {
    try {
      cachedTransport = createSentryTransport();
    } catch (initErr) {
      // A misconfigured/unavailable vendor transport must never take error
      // reporting itself offline -- fall back to the no-op transport.
      logEvent({
        level: "warn",
        scope: SCOPE,
        event: "transport_init_failed",
        errorCode: safeString(initErr && initErr.message, 200),
      });
      cachedTransport = createNoopTransport();
    }
  } else {
    cachedTransport = createNoopTransport();
  }

  return cachedTransport;
}

// --- public entry point -------------------------------------------------------
// Never throws. Returns a small result object (mainly useful for tests);
// production callers can ignore the return value, same convention as
// backend/utils/alerts.js's evaluateAndDispatchAlerts.
function reportError(error, context) {
  let transport;
  try {
    transport = getTransport();
    const safeContext = buildSafeContext(context);
    const safeError = normalizeError(error);

    transport.send(safeError, safeContext);

    return { attempted: true, provider: transport.name, failed: false };
  } catch (transportErr) {
    try {
      logEvent({
        level: "warn",
        scope: SCOPE,
        event: "transport_send_failed",
        errorCode: safeString(transportErr && transportErr.message, 200),
      });
    } catch {
      // even the failure-path log must never throw
    }
    return { attempted: true, provider: transport ? transport.name : "unknown", failed: true };
  }
}

function _resetTransportForTesting() {
  cachedTransport = null;
  cachedProviderKey = null;
}

function _setTransportForTesting(transport) {
  cachedTransport = transport;
  cachedProviderKey = currentProviderKey();
}

module.exports = {
  reportError,
  resolveEnvironmentTag,
  buildSafeContext,
  normalizeError,
  createNoopTransport,
  createSentryTransport,
  NOOP_PROVIDER,
  SENTRY_PROVIDER,
  _resetTransportForTesting,
  _setTransportForTesting,
  _getTransportForTesting: getTransport,
};
