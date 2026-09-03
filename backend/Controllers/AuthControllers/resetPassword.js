const { UserModel } = require('../../config/Schemas');
const { hashPassword } = require('../../Services/AuthServices/password.service');
const {
    INVALID_RESET_RESPONSE,
    emitAuthAuditEvent,
    hashResetToken,
} = require('../../Services/AuthServices/security.service');
const { revokeAllSessions } = require('../../Services/AuthServices/session.service');

const resetPassword = async (req, res) => {
    try {
        const { email, password, resetToken } = req.body;
        const hashedPassword = await hashPassword(password);
        const user = await UserModel.findOneAndUpdate(
            {
                email,
                isVerified: true,
                isPasswordReset: true,
                otp: hashResetToken(resetToken),
                passwordResetExpiry: { $gt: new Date() },
            },
            {
                $set: { password: hashedPassword, isPasswordReset: false },
                $unset: {
                    otp: '',
                    otpExpiry: '',
                    lastOtpSent: '',
                    passwordResetExpiry: '',
                    verificationExpiresAt: '',
                },
            },
            { new: true }
        );

        if (!user) {
            emitAuthAuditEvent({ event: 'password_reset_completed', outcome: 'denied', reason: 'invalid_or_expired_token', req, email });
            return res.status(403).json(INVALID_RESET_RESPONSE);
        }

        await revokeAllSessions(user._id);
        emitAuthAuditEvent({ event: 'password_reset_completed', outcome: 'success', req, email });
        res.status(200).json({ message: 'Password Changed Successfully', success: true });
    } catch (err) {
        emitAuthAuditEvent({ event: 'password_reset_completed', outcome: 'failure', reason: 'internal_error', req, email: req.body?.email });
        console.error('Password reset failed:', err.message);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { resetPassword };
