const { UserModel } = require('../../config/Schemas');

// OTP utility functions for security and clearing otp fields control
const { hashOTP, clearOtpFields, getVerificationExpiry } = require('../../Services/AuthServices/otp.service');

const verifyOTP = async (req, res) => {
    try {
        // Extract email and OTP from request body
        const { email, otp } = req.body;
        
        // Check if a user exists with the given email
        const user = await UserModel.findOne({ email });
        
        // If user not exists
        if(!user) {
            return res.status(404).json({ message: 'User not found', success: false });
        }

        // Prevent re-verification unless it's part of a password reset flow
        if(user.isVerified && !user.isPasswordReset) {
            return res.status(400).json({ message: 'User already verified', success: false });
        }

        // Validate OTP expiry before comparing values
        const inputOTP = hashOTP(otp);
        if (user.otpExpiry < new Date()) {
            return res.status(400).json({ message: 'OTP has expired. Please request a new one', success: false });
        }

        // Compare hashed OTP values for security
        if (inputOTP !== user.otp) {
            return res.status(400).json({ message: 'Invalid OTP', success: false });
        }

        const isResetFlow = user.isPasswordReset;

        // Mark user as verified and clear OTP fields.
        user.isVerified = true;
        clearOtpFields(user);

        // Grant a short-lived window to complete a password reset.
        if (isResetFlow) {
            user.isPasswordReset = true;
            user.passwordResetExpiry = getVerificationExpiry(10);
        }

        await user.save();

        // Successful verification response
        res.status(200).json({ message: 'Email verified successfully', success:true });
    
    } catch(err) {
        // Handle unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { verifyOTP };