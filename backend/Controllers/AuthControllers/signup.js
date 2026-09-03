const { UserModel } = require('../../config/Schemas');

// Service responsible for sending OTP emails to users
const { sendOTPEmail } = require('../../Services/AuthServices/email.service');

// OTP utility functions for generation, security, expiry control
const { 
    generateOTP, 
    hashOTP, 
    getOtpExpiry, 
    getVerificationExpiry, 
} = require('../../Services/AuthServices/otp.service');

// Password utility functions for hashing and comparing
const { hashPassword } = require('../../Services/AuthServices/password.service');
const { emitAuthAuditEvent } = require('../../Services/AuthServices/security.service');

const signup = async (req, res) => {
  try {
    // Extract user input from request body
    const { fullName, email, password } = req.body;

    // Check if a user already exists with the given email
    let user = await UserModel.findOne({ email });

    // If user exists and is already verified, block duplicate registration
    if (user && user.isVerified) {
      emitAuthAuditEvent({ event: 'signup_requested', outcome: 'denied', reason: 'existing_verified_account', req, email });
      return res.status(409).json({ message: 'User Already Exists', success: false });
    }

    // Generate OTP and related security metadata
    const otp = generateOTP();
    const hashedOTP = hashOTP(otp);
    const otpExpiry = getOtpExpiry(5);
    const verificationExpiresAt = getVerificationExpiry(10);

    // Securely hash the user's password
    const hashedPassword = await hashPassword(password);

    // If user exists but is NOT verified, reuse the same record
    // This avoids duplicate users and allows OTP re-verification
    if (user && !user.isVerified) {
      user.fullName = fullName;
      user.password = hashedPassword;
      user.otp = hashedOTP;
      user.otpExpiry = otpExpiry;
      user.lastOtpSent = new Date();
      user.verificationExpiresAt = verificationExpiresAt;
      user.isPasswordReset = false;
      user.passwordResetExpiry = undefined;
      await user.save();
    } 
    // Otherwise, create a brand-new unverified user
    else {
      user = new UserModel({
        fullName,
        email,
        password: hashedPassword,
        otp: hashedOTP,
        otpExpiry,
        lastOtpSent: new Date(),
        verificationExpiresAt
      });
      await user.save();
    }

    try {
      await sendOTPEmail(email, otp, "verify");
    } catch (emailError) {
      await UserModel.updateOne(
        { _id: user._id, otp: hashedOTP },
        { $unset: { otp: '', otpExpiry: '', lastOtpSent: '', verificationExpiresAt: '' } }
      );
      emitAuthAuditEvent({ event: 'signup_otp_issued', outcome: 'failure', reason: 'email_delivery_failed', req, email });
      console.error('Signup verification email failed:', emailError.message);
      return res.status(503).json({ message: 'Verification email could not be sent. Please try again.', success: false });
    }

    emitAuthAuditEvent({ event: 'signup_otp_issued', outcome: 'success', req, email });
    res.status(201).json({ message: 'Registered successfully. Verify OTP to continue', success: true });
  
  } catch (err) {
    emitAuthAuditEvent({ event: 'signup_otp_issued', outcome: 'failure', reason: 'internal_error', req, email: req.body?.email });
    console.error('Signup failed:', err.message);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { signup };
