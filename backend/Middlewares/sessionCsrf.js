const crypto = require("crypto");
const { CSRF_COOKIE_NAME, parseCookies } = require("../Services/AuthServices/session.service");

const rejectCsrf = (res) => res.status(403).json({ success: false, message: "Session verification failed", code: "CSRF_REJECTED" });

module.exports = (req, res, next) => {
  const cookieToken = parseCookies(req.headers.cookie)[CSRF_COOKIE_NAME];
  const headerToken = req.get("x-csrf-token");
  if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length) return rejectCsrf(res);
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) return rejectCsrf(res);
  next();
};
