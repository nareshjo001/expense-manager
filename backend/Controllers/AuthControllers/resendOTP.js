const { UserModel } = require('../../config/Schemas');
const { sendOTPEmail } = require('../../Services/AuthServices/email.service');
const { 
    canResendOtp,
    generateOTP, 
    hashOTP, 
    getOtpExpiry, 
    getVerificationExpiry, 
} = require('../../Services/AuthServices/otp.service');
const {
    RECOVERY_RESPONSE,
    emitAuthAuditEvent,
    waitForRecoveryResponse,
} = require('../../Services/AuthServices/security.service');

const COOLDOWN_MS = 120 * 1000;

const sendGenericResendResponse = async (res, startedAt) => {
    await waitForRecoveryResponse(startedAt);
    return res.status(202).json(RECOVERY_RESPONSE);
};

const resendOTP = async (req, res) => {
    const startedAt = Date.now();

    try {
        const { email } = req.body;
        const user = await UserModel.findOne({ email });

        if (!user || user.isVerified || !canResendOtp(user.lastOtpSent, COOLDOWN_MS).allowed) {
            emitAuthAuditEvent({ event: 'verification_otp_resent', outcome: 'accepted', reason: 'ineligible_or_cooldown', req, email });
            return sendGenericResendResponse(res, startedAt);
        }       

        const otp = generateOTP();
        const hashedOtp = hashOTP(otp);
        user.otp = hashedOtp;
        user.otpExpiry = getOtpExpiry(5);
        user.lastOtpSent = new Date();
        user.verificationExpiresAt = getVerificationExpiry(10);
        user.isPasswordReset = false;
        user.passwordResetExpiry = undefined;
        await user.save();

        try {
            await sendOTPEmail(email, otp, 'verify');
            emitAuthAuditEvent({ event: 'verification_otp_resent', outcome: 'success', req, email });
        } catch (emailError) {
            await UserModel.updateOne(
                { _id: user._id, otp: hashedOtp },
                { $unset: { otp: '', otpExpiry: '', lastOtpSent: '', verificationExpiresAt: '' } }
            );
            emitAuthAuditEvent({ event: 'verification_otp_resent', outcome: 'failure', reason: 'email_delivery_failed', req, email });
            console.error('Verification email failed:', emailError.message);
        }

        return sendGenericResendResponse(res, startedAt);
    } catch(err) {
        emitAuthAuditEvent({ event: 'verification_otp_resent', outcome: 'failure', reason: 'internal_error', req, email: req.body?.email });
        console.error('OTP resend failed:', err.message);
        await waitForRecoveryResponse(startedAt);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { resendOTP };
