const crypto = require('crypto');

const generateOTP = () => crypto.randomInt(100000, 999999).toString();

const hashOTP = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

const getOtpExpiry = (minutes = 5) => new Date(Date.now() + minutes * 60 * 1000);

const getVerificationExpiry = (minutes = 10) => new Date(Date.now() + minutes * 60 * 1000);

const canResendOtp = (lastSent, cooldownMs = 120000) => {
  if (!lastSent) return { allowed: true };
  const diff = Date.now() - lastSent.getTime();
  if (diff >= cooldownMs) return { allowed: true };
  return {
    allowed: false,
    remaining: Math.ceil((cooldownMs - diff) / 1000),
  };
};

const clearOtpFields = (user) => {
  user.otp = undefined;
  user.otpExpiry = undefined;
  user.lastOtpSent = undefined;
  user.verificationExpiresAt = undefined;
  user.isPasswordReset = false;
};

module.exports = {
  generateOTP,
  hashOTP,
  getOtpExpiry,
  getVerificationExpiry,
  canResendOtp,
  clearOtpFields,
};