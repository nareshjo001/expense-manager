const { UserModel } = require("../../config/Schemas");
const { issueAccessToken } = require("../../Services/AuthServices/token.service");
const {
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  cookieOptions,
  createSession,
  parseCookies,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} = require("../../Services/AuthServices/session.service");
const { emitAuthAuditEvent } = require("../../Services/AuthServices/security.service");

function writeSessionCookies(res, { refreshToken, csrfToken }) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, cookieOptions(true));
  res.cookie(CSRF_COOKIE_NAME, csrfToken, cookieOptions(false));
}

function clearSessionCookies(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions(true));
  res.clearCookie(CSRF_COOKIE_NAME, cookieOptions(false));
}

async function createLoginSession(user, req, res) {
  const sessionData = await createSession(user._id, req);
  writeSessionCookies(res, sessionData);
  return issueAccessToken({ email: user.email, _id: user._id, sid: sessionData.session._id.toString() });
}

const refresh = async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const sessionData = await rotateSession(cookies[REFRESH_COOKIE_NAME], cookies[CSRF_COOKIE_NAME], req);
    if (!sessionData) return res.status(401).json({ success: false, message: "Session expired" });
    const user = await UserModel.findById(sessionData.session.userId).lean();
    if (!user?.isVerified) return res.status(401).json({ success: false, message: "Session expired" });
    writeSessionCookies(res, sessionData);
    const token = issueAccessToken({ email: user.email, _id: user._id, sid: sessionData.session._id.toString() });
    emitAuthAuditEvent({ event: "session_refreshed", outcome: "success", req, email: user.email });
    return res.status(200).json({ success: true, token, email: user.email, firstname: user.fullName });
  } catch (err) {
    console.error("Session refresh failed:", err.message);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const logout = async (req, res) => {
  try {
    const refreshToken = parseCookies(req.headers.cookie)[REFRESH_COOKIE_NAME];
    await revokeSession(refreshToken);
    clearSessionCookies(res);
    return res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (err) {
    console.error("Logout failed:", err.message);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

const logoutAll = async (req, res) => {
  try {
    await revokeAllSessions(req.userId);
    clearSessionCookies(res);
    return res.status(200).json({ success: true, message: "Logged out from all sessions" });
  } catch (err) {
    console.error("Logout-all failed:", err.message);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { createLoginSession, logout, logoutAll, refresh };
