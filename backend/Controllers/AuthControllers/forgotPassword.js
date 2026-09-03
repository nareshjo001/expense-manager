const { UserModel } = require('../../config/Schemas');
const { sendOTPEmail } = require('../../Services/AuthServices/email.service');
const { 
    canResendOtp,
    generateOTP, 
    hashOTP, 
    getOtpExpiry, 
} = require('../../Services/AuthServices/otp.service');
const {
    RECOVERY_RESPONSE,
    emitAuthAuditEvent,
    waitForRecoveryResponse,
} = require('../../Services/AuthServices/security.service');

const COOLDOWN_MS = 120 * 1000;

const sendGenericRecoveryResponse = async (res, startedAt) => {
    await waitForRecoveryResponse(startedAt);
    return res.status(202).json(RECOVERY_RESPONSE);
};

const forgotPassword = async (req, res) => {
    const startedAt = Date.now();

    try {
        const { email } = req.body;
        const user = await UserModel.findOne({ email });

        if (!user || !user.isVerified) {
            emitAuthAuditEvent({ event: 'password_reset_requested', outcome: 'accepted', reason: 'ineligible_identity', req, email });
            return sendGenericRecoveryResponse(res, startedAt);
        }

        if (!canResendOtp(user.lastOtpSent, COOLDOWN_MS).allowed) {
            emitAuthAuditEvent({ event: 'password_reset_requested', outcome: 'accepted', reason: 'cooldown_active', req, email });
            return sendGenericRecoveryResponse(res, startedAt);
        }

        const otp = generateOTP();
        const hashedOtp = hashOTP(otp);
        user.otp = hashedOtp;
        user.otpExpiry = getOtpExpiry(5);
        user.lastOtpSent = new Date();
        user.isPasswordReset = true;
        user.passwordResetExpiry = undefined;
        await user.save();

        try {
            await sendOTPEmail(email, otp, 'reset');
            emitAuthAuditEvent({ event: 'password_reset_otp_issued', outcome: 'success', req, email });
        } catch (emailError) {
            await UserModel.updateOne(
                { _id: user._id, otp: hashedOtp },
                { $unset: { otp: '', otpExpiry: '', lastOtpSent: '', passwordResetExpiry: '' }, $set: { isPasswordReset: false } }
            );
            emitAuthAuditEvent({ event: 'password_reset_otp_issued', outcome: 'failure', reason: 'email_delivery_failed', req, email });
            console.error('Password reset email failed:', emailError.message);
        }

        return sendGenericRecoveryResponse(res, startedAt);
    } catch(err) {
        emitAuthAuditEvent({ event: 'password_reset_requested', outcome: 'failure', reason: 'internal_error', req, email: req.body?.email });
        console.error('Password reset request failed:', err.message);
        await waitForRecoveryResponse(startedAt);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { forgotPassword };
