const { UserModel } = require('../../config/Schemas');

// Service responsible for sending OTP emails to users
const { sendOTPEmail } = require('../../Services/AuthServices/email.service');

// OTP utility functions for generation, security, expiry control
const { 
    canResendOtp,
    generateOTP, 
    hashOTP, 
    getOtpExpiry, 
} = require('../../Services/AuthServices/otp.service');

const forgotPassword = async (req, res) => {
    try {
        // Extract email and verify user existence
        const { email } = req.body;
        
        const user = await UserModel.findOne({ email });
        
        // If user not exists
        if(!user) {
            return res.status(404).json({ message: 'User not found', success: false });
        }

        // Allow password reset only for verified accounts
        if(!user.isVerified) {
            return res.status(403).json({ message: 'Account not verified. Sign Up Again', success: false});
        }

        // Enforce cooldown to prevent OTP abuse
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

        // Generate OTP for password reset and update user state
        const otp = generateOTP();
        user.otp = hashOTP(otp);
        user.otpExpiry = getOtpExpiry(5);
        user.lastOtpSent = new Date();
        user.isPasswordReset = true;
        await user.save();

        // Send password reset OTP email
        await sendOTPEmail(email, otp, "reset");

        // Successful OTP dispatch response
        res.status(200).json({ message: 'OTP sent successfully', success:true, cooldown: Math.ceil(COOLDOWN_MS / 1000) });

    } catch(err) {
        // Handle unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { forgotPassword };