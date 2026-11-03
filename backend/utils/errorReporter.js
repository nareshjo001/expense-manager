// Vendor-agnostic error-aggregation integration point, with environment tagging.
"use strict";

const { logEvent, safeString, safeRequestId } = require("./logger");

const SCOPE = "errorReporter";
const MAX_MESSAGE_LENGTH = 500;

const NOOP_PROVIDER = "none";
const SENTRY_PROVIDER = "sentry";

// Js) rather than inventing a new one.
function resolveEnvironmentTag() {
  const raw = typeof process.env.NODE_ENV === "string" ? process.env.NODE_ENV.trim().toLowerCase() : "";
  return raw !== "" ? raw : "development";
}

// --- redaction-safe context / error shaping --------------------------------- Explicit allowlist destructure -- see file header.
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

// G. details`). details`).
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

// --- NoopTransport ----------------------------------------------------------- Default transport.
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

// Io/platforms/node/). md for why, and the exact activation steps).
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
      // T01/T03 financial-data redaction policy backstop: this transport is only ever called with the pre-redacted, allowlisted safeError/safeContext this file builds -- never a raw Error's custom properties, a request body, or an amount/PII field.
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

// Js's guarded-singleton pattern for an optional capability. env directly rather than restarting the process).
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

// --- public entry point ------------------------------------------------------- Never throws.
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
