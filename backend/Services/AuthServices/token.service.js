const jwt = require('jsonwebtoken');

// Remediation Workstream E -- JWT expiration.
const DEFAULT_EXPIRES_IN = '15m';

// Resolves and validates the configured expiration duration. Throws
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
  return trimmed;
}

// Issues a signed access token for `payload` (the caller's exact JWT claims,
function issueAccessToken(payload) {
  const expiresIn = resolveExpiresIn();
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
}

module.exports = { issueAccessToken, DEFAULT_EXPIRES_IN, resolveExpiresIn };
