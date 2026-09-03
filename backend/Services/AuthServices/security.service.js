const crypto = require("crypto");

const RECOVERY_RESPONSE = Object.freeze({
  success: true,
  message: "If the account is eligible, a verification code has been sent.",
  cooldown: 120,
});

const INVALID_CREDENTIALS_RESPONSE = Object.freeze({
  success: false,
  message: "Invalid email or password.",
  code: "INVALID_CREDENTIALS",
});

const INVALID_OTP_RESPONSE = Object.freeze({
  success: false,
  message: "Invalid or expired verification code.",
  code: "INVALID_VERIFICATION_CODE",
});

const INVALID_RESET_RESPONSE = Object.freeze({
  success: false,
  message: "Password reset authorization is invalid or expired.",
  code: "INVALID_RESET_AUTHORIZATION",
});

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const generateResetToken = () => crypto.randomBytes(32).toString("base64url");

const hashResetToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

const safeHashEqual = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
};

const fingerprint = (value, env = process.env) => {
  const secret = env.AUTH_AUDIT_HASH_SECRET || env.JWT_SECRET;
  if (!secret || !value) return undefined;
  return crypto.createHmac("sha256", secret).update(String(value)).digest("hex").slice(0, 24);
};

const emitAuthAuditEvent = ({ event, outcome, req, email, reason }) => {
  const auditEvent = {
    type: "auth_security_event",
    featureId: "AUTH-002",
    event,
    outcome,
    reason,
    identityHash: fingerprint(normalizeEmail(email)),
    ipHash: fingerprint(req?.ip),
    requestId: String(req?.get?.("X-Request-ID") || "").slice(0, 128) || undefined,
    occurredAt: new Date().toISOString(),
  };

  console.info(JSON.stringify(auditEvent));
};

const getRecoveryMinDelayMs = (env = process.env) => {
  if (env.NODE_ENV === "test" && env.AUTH_RECOVERY_MIN_RESPONSE_MS === undefined) return 0;
  const configured = Number(env.AUTH_RECOVERY_MIN_RESPONSE_MS ?? 250);
  if (!Number.isFinite(configured)) return 250;
  return Math.min(Math.max(Math.floor(configured), 0), 2000);
};

const waitForRecoveryResponse = async (startedAt, env = process.env) => {
  const remaining = getRecoveryMinDelayMs(env) - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
};

module.exports = {
  INVALID_CREDENTIALS_RESPONSE,
  INVALID_OTP_RESPONSE,
  INVALID_RESET_RESPONSE,
  RECOVERY_RESPONSE,
  emitAuthAuditEvent,
  fingerprint,
  generateResetToken,
  getRecoveryMinDelayMs,
  hashResetToken,
  normalizeEmail,
  safeHashEqual,
  waitForRecoveryResponse,
};
