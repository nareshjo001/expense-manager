const crypto = require("crypto");
const RefreshSession = require("../../models/RefreshSession");

const REFRESH_COOKIE_NAME = "balensia_refresh";
const CSRF_COOKIE_NAME = "balensia_csrf";
const DEFAULT_SESSION_DAYS = 30;

function sessionSecret() {
  const secret = process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("Refresh session secret is not configured");
  return secret;
}

function hashSecret(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("hex");
}

function issueOpaqueToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function resolveSessionDays() {
  const configured = Number(process.env.REFRESH_SESSION_DAYS || DEFAULT_SESSION_DAYS);
  if (!Number.isInteger(configured) || configured < 1 || configured > 90) {
    throw new Error("REFRESH_SESSION_DAYS must be an integer between 1 and 90");
  }
  return configured;
}

function cookieOptions(httpOnly) {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly,
    secure: production,
    sameSite: "lax",
    path: "/",
    maxAge: resolveSessionDays() * 24 * 60 * 60 * 1000,
  };
}

function userAgentHash(req) {
  const value = req?.get?.("user-agent") || req?.headers?.["user-agent"] || "";
  return value ? crypto.createHash("sha256").update(value).digest("hex").slice(0, 32) : null;
}

function parseCookies(header = "") {
  return Object.fromEntries(
    String(header)
      .split(";")
      .map((part) => part.trim().split(/=(.*)/s, 2))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, value]) => [name, decodeURIComponent(value)])
  );
}

async function createSession(userId, req) {
  const refreshToken = issueOpaqueToken();
  const csrfToken = issueOpaqueToken();
  const expiresAt = new Date(Date.now() + cookieOptions(true).maxAge);
  const session = await RefreshSession.create({
    userId,
    tokenHash: hashSecret(refreshToken),
    csrfHash: hashSecret(csrfToken),
    expiresAt,
    userAgentHash: userAgentHash(req),
  });
  return { session, refreshToken, csrfToken };
}

async function rotateSession(refreshToken, csrfToken, req) {
  if (!refreshToken || !csrfToken) return null;
  const now = new Date();
  const current = await RefreshSession.findOne({ tokenHash: hashSecret(refreshToken) });
  if (!current || current.revokedAt || current.expiresAt <= now || current.csrfHash !== hashSecret(csrfToken)) {
    if (current?.userId) await RefreshSession.updateMany({ userId: current.userId, revokedAt: null }, { $set: { revokedAt: now } });
    return null;
  }
  const replacement = await createSession(current.userId, req);
  const revoked = await RefreshSession.findOneAndUpdate(
    { _id: current._id, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, lastUsedAt: now } },
    { new: false }
  );
  if (!revoked) {
    await RefreshSession.updateOne({ _id: replacement.session._id, revokedAt: null }, { $set: { revokedAt: now } });
    return null;
  }
  return replacement;
}

async function revokeSession(refreshToken) {
  if (!refreshToken) return null;
  return RefreshSession.findOneAndUpdate(
    { tokenHash: hashSecret(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true }
  );
}

async function revokeAllSessions(userId) {
  return RefreshSession.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

async function isSessionActive(sessionId, userId) {
  if (!sessionId) return true;
  const session = await RefreshSession.findOne({ _id: sessionId, userId, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
  return Boolean(session);
}

module.exports = {
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  cookieOptions,
  createSession,
  isSessionActive,
  parseCookies,
  revokeAllSessions,
  revokeSession,
  rotateSession,
};
