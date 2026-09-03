const crypto = require('crypto');

// Generate a cryptographically random 6-digit OTP.
const generateOTP = () => crypto.randomInt(100000, 999999).toString();

// Hash the OTP so the plaintext value is never persisted.
const hashOTP = (otp) => crypto.createHash('sha256').update(String(otp)).digest('hex');

const getOtpExpiry = (minutes = 5) => new Date(Date.now() + minutes * 60 * 1000);

const getVerificationExpiry = (minutes = 10) => new Date(Date.now() + minutes * 60 * 1000);

// Enforce the resend cooldown, reporting the seconds still remaining.
const canResendOtp = (lastSent, cooldownMs = 120000) => {
  if (!lastSent) return { allowed: true };
  const diff = Date.now() - lastSent.getTime();
  if (diff >= cooldownMs) return { allowed: true };
  return {
    allowed: false,
    remaining: Math.ceil((cooldownMs - diff) / 1000),
  };
};

module.exports = {
  generateOTP,
  hashOTP,
  getOtpExpiry,
  getVerificationExpiry,
  canResendOtp,
};
