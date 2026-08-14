const jwt = require('jsonwebtoken');

// Remediation Workstream E -- JWT expiration.
//
// Centralizes every access-token issuance so the whole app enforces exactly
// ONE expiration policy, instead of each call site independently deciding
// (or forgetting) whether to set `expiresIn`. Before this fix,
// Controllers/AuthControllers/login.js called `jwt.sign({ email, _id },
// process.env.JWT_SECRET)` with no `expiresIn` option at all -- the issued
// token had no `exp` claim and never expired. A leaked/stolen token
// therefore remained valid forever, with no revocation mechanism anywhere in
// the codebase. login.js is confirmed to be the ONLY place in the backend
// that issues a real, user-facing access token (signup/OTP/password-reset
// flows do not return a JWT -- verified by an exhaustive `jwt.sign` search
// across backend/Controllers and backend/Services before this change).
//
// JWT_EXPIRES_IN accepts anything jsonwebtoken's own `expiresIn` option
// accepts: a bare number of seconds, or a vercel/ms-style duration string
// ("15m", "1h", "7d", ...). This module does not reimplement that parsing --
// it only rejects an obviously-wrong numeric value (<= 0) before ever
// calling jwt.sign, and lets jwt.sign itself validate any non-numeric
// string, so there is exactly one source of truth for "what counts as a
// valid duration".
//
// Explicit, bounded default: DEFAULT_EXPIRES_IN below. This is never a
// silent "fall back to no expiration" -- if JWT_EXPIRES_IN is unset or
// blank, this documented, non-infinite default is used instead, and is
// covered by this module's own tests. Production deployments are expected
// to set JWT_EXPIRES_IN explicitly; this default exists so local
// development/tests never accidentally exercise an unbounded token either.
const DEFAULT_EXPIRES_IN = '15m';

// Resolves and validates the configured expiration duration. Throws
// synchronously (never returns an unsafe value) if JWT_EXPIRES_IN is set but
// resolves to a non-positive numeric duration -- a misconfiguration must
// fail loudly, not silently issue an already-expired or effectively
// non-expiring token.
function resolveExpiresIn() {
  const raw = process.env.JWT_EXPIRES_IN;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return DEFAULT_EXPIRES_IN;
  }

  const trimmed = raw.trim();
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    if (asNumber <= 0) {
      throw new Error('JWT_EXPIRES_IN must resolve to a positive duration.');
    }
    return asNumber;
  }

  // A non-numeric string (e.g. "15m") -- deferred to jsonwebtoken's own
  // ms()-based parser inside issueAccessToken/jwt.sign, which throws for an
  // unparseable string. Never silently treated as "no expiration".
  return trimmed;
}

// Issues a signed access token for `payload` (the caller's exact JWT claims,
// e.g. `{ email, _id }`) with the bounded expiration policy applied
// consistently. `jwt.sign` always stamps `iat` automatically; passing
// `expiresIn` here is what additionally stamps `exp`. Never silently
// produces a non-expiring token: a misconfigured JWT_EXPIRES_IN throws
// before any token is returned, and an invalid resulting duration causes
// jwt.sign itself to throw -- both surface as a request failure, never a
// successfully-issued token with unintended lifetime semantics.
function issueAccessToken(payload) {
  const expiresIn = resolveExpiresIn();
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

module.exports = { issueAccessToken, DEFAULT_EXPIRES_IN, resolveExpiresIn };
