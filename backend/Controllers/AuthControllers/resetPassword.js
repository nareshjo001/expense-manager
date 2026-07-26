const { UserModel } = require('../../config/Schemas');

// Password utility functions for hashing
const { hashPassword } = require('../../Services/AuthServices/password.service');

const resetPassword = async (req, res) => {
    try {
        // Extract credentials and validate user existence
        const { email, password } = req.body;

        const user = await UserModel.findOne({ email });
        
        // If user not exists
        if(!user) {
            return res.status(404).json({ message: 'User not found', success: false });
        }

        // Ensure password reset is allowed only for verified accounts
        if(!user.isVerified) {
            return res.status(403).json({ message: 'Account not verified. Sign Up Again', success: false});
        }

        // Require a completed, unexpired OTP verification.
        if (
            !user.isPasswordReset ||
            !user.passwordResetExpiry ||
            user.passwordResetExpiry < new Date()
        ) {
            return res.status(403).json({ message: 'Password reset not authorized. Please verify OTP again', success: false });
        }

        // Securely hash the new password before persisting
        const hashedPassword = await hashPassword(password);

        // Update password and consume the reset authorization.
        user.password = hashedPassword;
        user.isPasswordReset = false;
        user.passwordResetExpiry = undefined;
        await user.save();

        // Successful password reset response
        res.status(200).json({ message: 'Password Changed Successfully', success: true });
    
    } catch (err) {
        // Handle unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { resetPassword };