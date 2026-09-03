const { UserModel } = require('../../config/Schemas');
const { hashOTP, getVerificationExpiry } = require('../../Services/AuthServices/otp.service');
const {
    INVALID_OTP_RESPONSE,
    emitAuthAuditEvent,
    generateResetToken,
    hashResetToken,
    safeHashEqual,
} = require('../../Services/AuthServices/security.service');

const verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        const user = await UserModel.findOne({ email });
        const inputOtpHash = hashOTP(otp);
        const isResetFlow = Boolean(user?.isVerified && user?.isPasswordReset);
        const isSignupFlow = Boolean(user && !user.isVerified && !user.isPasswordReset);
        const hasValidOtp = Boolean(
            user?.otp &&
            user?.otpExpiry &&
            user.otpExpiry > new Date() &&
            safeHashEqual(inputOtpHash, user.otp) &&
            (isResetFlow || isSignupFlow)
        );

        if (!hasValidOtp) {
            emitAuthAuditEvent({ event: 'otp_verified', outcome: 'denied', reason: 'invalid_or_expired', req, email });
            return res.status(400).json(INVALID_OTP_RESPONSE);
        }

        const resetToken = isResetFlow ? generateResetToken() : undefined;
        const update = isResetFlow
            ? {
                $set: {
                    isVerified: true,
                    isPasswordReset: true,
                    otp: hashResetToken(resetToken),
                    passwordResetExpiry: getVerificationExpiry(10),
                },
                $unset: { otpExpiry: '', lastOtpSent: '', verificationExpiresAt: '' },
            }
            : {
                $set: { isVerified: true, isPasswordReset: false },
                $unset: { otp: '', otpExpiry: '', lastOtpSent: '', verificationExpiresAt: '', passwordResetExpiry: '' },
            };

        const verifiedUser = await UserModel.findOneAndUpdate(
            {
                _id: user._id,
                otp: inputOtpHash,
                otpExpiry: { $gt: new Date() },
                isPasswordReset: isResetFlow,
            },
            update,
            { new: true }
        );

        if (!verifiedUser) {
            emitAuthAuditEvent({ event: 'otp_verified', outcome: 'denied', reason: 'already_consumed', req, email });
            return res.status(400).json(INVALID_OTP_RESPONSE);
        }

        emitAuthAuditEvent({ event: 'otp_verified', outcome: 'success', reason: isResetFlow ? 'password_reset' : 'signup', req, email });
        res.status(200).json({
            message: isResetFlow ? 'Verification successful' : 'Email verified successfully',
            success: true,
            ...(resetToken ? { resetToken } : {}),
        });
    } catch(err) {
        emitAuthAuditEvent({ event: 'otp_verified', outcome: 'failure', reason: 'internal_error', req, email: req.body?.email });
        console.error('OTP verification failed:', err.message);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { verifyOTP };
