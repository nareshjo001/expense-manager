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

const signup = async (req, res) => {
  try {
    // Extract user input from request body
    const { fullName, email, password } = req.body;

    // Check if a user already exists with the given email
    let user = await UserModel.findOne({ email });

    // If user exists and is already verified, block duplicate registration
    if (user && user.isVerified) {
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

    // Send OTP email for account verification
    await sendOTPEmail(email, otp, "verify");

    // Final success response after signup initiation
    res.status(201).json({ message: 'Registered successfully. Verify OTP to continue', success: true });
  
  } catch (err) {
    // Handle unexpected server errors
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { signup };