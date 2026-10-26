import { useState, useEffect } from "react";
import { FiMail, FiKey, FiArrowLeft } from "react-icons/fi";
// FE-002-T02 -- placeholder-only fields replaced with real labels.
import { LabeledField } from '../../a11y/LabeledField';
import { onKeyActivate } from "../../../utils/onKeyActivate";
import "../Auth.css";
import AuthLayout from "../AuthLayout";

import ResetPassword from "./ResetPassword";
import { signUpSuccessToast, logInErrorToast } from "../../alertsEffects/toastMessages";
import { FetchingLoader } from "../../alertsEffects/FetchingLoader";

// Forgot-password flow: send an OTP, verify it, then hand off to ResetPassword.
const ForgotPassword = ({ onBack, setIsSpinnerLoad }) => {

    const [email, setEmail] = useState('');

    const [isOTPSent, setIsOTPSent] = useState(false);
    const [otp, setOtp] = useState("");
    const [isOTPVerified, setIsOTPVerified] = useState(false);
    const [resetToken, setResetToken] = useState("");

    const [countdown, setCountdown] = useState(120);

    const [isFetching, setIsFetching] = useState(false);

    // Ticks the OTP resend countdown down to zero, one second at a time.
    useEffect(() => {
        if (countdown <= 0) return;

        const timer = setTimeout(() => {
            setCountdown((prev) => prev - 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [countdown]);

    // Handles both steps of the flow: sends the OTP first, then verifies it, based on isOTPSent.
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (isFetching) return;
        setIsFetching(true);

        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsFetching(false);
            return;
        }

        try {
            if (!isOTPSent) {
                const response = await fetch(`${BASE_URL}/auth/forgot-password`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email }),
                });

                const data = await response.json();

                if (response.ok) {
                    signUpSuccessToast(data);
                    setIsOTPSent(true);
                    setCountdown(data.cooldown || 120);
                } else if (response.status === 429) {
                    logInErrorToast({
                        message: "Too many attempts. Please wait a moment and try again",
                    });
                } else {
                    logInErrorToast(data);
                }
            } else {
                const response = await fetch(`${BASE_URL}/auth/verify-otp`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, otp }),
                });

                const data = await response.json();

                if (response.ok && typeof data.resetToken === "string") {
                    signUpSuccessToast(data);
                    setResetToken(data.resetToken);
                    setIsOTPVerified(true);
                } else if (response.ok) {
                    logInErrorToast({ message: "Verification could not be completed. Please request a new code." });
                } else if (response.status === 429) {
                    logInErrorToast({
                        message: "Too many attempts. Please wait a moment and try again",
                    });
                } else {
                    logInErrorToast(data);
                }
            }
        } catch (error) {
            logInErrorToast({ message: "Something went wrong. Please try again." });
        } finally {
            setIsFetching(false);
        }
    };

    const handleResend = async () => {
        if (countdown > 0 || isFetching) return;

        setIsFetching(true);

        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsFetching(false);
            return;
        }

        try {
            const response = await fetch(`${BASE_URL}/auth/forgot-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const data = await response.json();

            if (response.ok) {
                signUpSuccessToast(data);
                setCountdown(data.cooldown || 120);
            } else if (response.status === 429) {
                logInErrorToast({
                    message: "Too many attempts. Please wait a moment and try again",
                });
            } else {
                logInErrorToast(data);
            }
        } catch (error) {
            logInErrorToast({ message: "Unable to resend OTP." });
        } finally {
            setIsFetching(false);
        }
    };

    if (isOTPVerified) {
        return (
            <ResetPassword
                onBack={onBack}
                email={email}
                resetToken={resetToken}
                setIsSpinnerLoad={setIsSpinnerLoad}
            />
        );
    }

    return (
        <AuthLayout>
            <div className="forgot-pass-card">
                <button 
                    type="button" 
                    className="auth-back-btn" 
                    onClick={onBack}
                    aria-label="Back to login"
                    title="Back to login"
                >
                    <FiArrowLeft />
                </button>
                
                <header className="login-header">
                    <h2 className="login-title">Forgot Password ?</h2>
                    <p className="login-subtitle">
                        Enter your email address and we'll send you an OTP to reset your password.
                    </p>
                </header>
                
                <main className="login-form">
                    <form onSubmit={handleSubmit}>
                        <LabeledField
                            label="Email ID"
                            type="email"
                            name="email"
                            placeholder="Enter your email"
                            inputClassName="login-input login-input-with-icon"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoComplete="email"
                            required
                            disabled={isOTPSent}
                            leftIcon={<FiMail className="login-field-icon" />}
                        />

                        <div className={`otp-wrapper ${isOTPSent ? "open" : ""}`}>
                            <LabeledField
                                label="One-time password"
                                hint="Six digits, sent to your email."
                                type="text"
                                name="otp"
                                placeholder="Enter 6-digit code"
                                inputClassName="login-input login-input-with-icon"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                required={isOTPSent}
                                leftIcon={<FiKey className="login-field-icon" />}
                            />
                        </div>

                        <button
                            type="submit"
                            className="login-submit"
                            disabled={isFetching}
                            style={{ marginTop: "8px" }}
                        >
                            {isFetching ? <FetchingLoader /> : isOTPSent ? "Verify" : "Send OTP"}
                        </button>

                    </form>
                    
                    {isOTPSent && (
                        <p className={`otp-resend ${countdown > 0 ? "disabled" : ""}`}>
                            {countdown > 0 ? (
                                <>Resend OTP in <span>{countdown}s</span></>
                            ) : (
                                <span
                                    role="button"
                                    tabIndex={0}
                                    onClick={handleResend}
                                    onKeyDown={onKeyActivate(handleResend)}
                                >
                                    Resend OTP
                                </span>
                            )}
                        </p>
                    )}
                </main>
            </div>
        </AuthLayout>
    );
};

export default ForgotPassword;
