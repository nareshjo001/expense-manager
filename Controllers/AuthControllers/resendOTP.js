const { UserModel } = require('../../config/Schemas');

// Service responsible for sending OTP emails to users
const { sendOTPEmail } = require('../../Services/AuthServices/email.service');

// OTP utility functions for generation, security, expiry control
const { 
    canResendOtp,
    generateOTP, 
    hashOTP, 
    getOtpExpiry, 
    getVerificationExpiry, 
} = require('../../Services/AuthServices/otp.service');

const resendOTP = async (req, res) => {
    try {
        // Extract email and validate user existence
        const { email } = req.body;
        
        // Check if a user exists with the given email
        const user = await UserModel.findOne({ email });
        
        // If not exists
        if(!user) {
            return res.status(404).json({ message: 'User not found', success: false });
        }

        // Prevent OTP resend for already verified users
        if(user.isVerified) {
            return res.status(400).json({ message: 'User already verified', success: false});
        }

        // Enforce cooldown window to avoid OTP abuse
        const COOLDOWN_MS = 120 * 1000;
        const otpCheck = canResendOtp(user.lastOtpSent, COOLDOWN_MS);
        
        // Check cooldown
        if (!otpCheck.allowed) {
            return res.status(429).json({
                message: `Please wait ${otpCheck.remaining}s before requesting a new OTP`,
                success: false,
                cooldown: otpCheck.remaining
            });
        }       

        // Generate and persist a fresh OTP with updated expiry data
        const otp = generateOTP();
        user.otp = hashOTP(otp);
        user.otpExpiry = getOtpExpiry(5);
        user.lastOtpSent = new Date();
        user.verificationExpiresAt = getVerificationExpiry(10);
        await user.save();

        // Send OTP email to user
        await sendOTPEmail(email, otp, "verify");

        // Successful resend response
        res.status(200).json({ message: 'OTP resent successfully', success:true, cooldown: Math.ceil(COOLDOWN_MS / 1000) });

    } catch(err) {
        // Handle unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { resendOTP };