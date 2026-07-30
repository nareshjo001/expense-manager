import { useState, useRef, useEffect } from "react";
import './OTPForm.css';

import { signUpSuccessToast, signUpErrorToast } from '../alertsEffects/toastMessages';
import { FetchingLoader } from "../alertsEffects/FetchingLoader";

// Six-digit OTP entry with auto-advance/paste handling, resend countdown, and backend verification.
const OTPForm = ({ email, onSuccess, setIsSpinnerLoad }) => {
    const [otp, setOtp] = useState(['', '', '', '', '', '']);

    const [otpError, setOtpError] = useState(false);

    const [countdown, setCountdown] = useState(120);

    const [isFetching, setIsFetching] = useState(false);

    const otpRefs = useRef([]);

    // Ticks the resend countdown down to zero, one second at a time.
    useEffect(() => {
        if (countdown <= 0) return;

        const timer = setTimeout(() => {
            setCountdown(prev => prev - 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [countdown]);

    // Accepts only a single digit per box and auto-advances focus to the next box.
    const handleOtpChange = (index, value) => {
        if (value && !/^\d$/.test(value)) return;

        const newOtp = [...otp];
        newOtp[index] = value;
        setOtp(newOtp);

        if (value && index < 5) otpRefs.current[index + 1]?.focus();
    };

    const handleOtpKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !otp[index] && index > 0) {
            otpRefs.current[index - 1]?.focus();
        }
    };

    // Distributes a pasted 6-digit code across the individual OTP boxes.
    const handleOtpPaste = (e) => {
        e.preventDefault();
        
        const pastedData = e.clipboardData.getData('text').slice(0, 6);
        const newOtp = [...otp];

        for (let i = 0; i < pastedData.length; i++) {
            if (/^\d$/.test(pastedData[i])) newOtp[i] = pastedData[i];
        }

        setOtp(newOtp);

        const nextIndex = Math.min(pastedData.length, 5);
        otpRefs.current[nextIndex]?.focus();
    };

    const handleVerify = async () => {
        if (otp.join('').length !== 6) return;
        
        setIsSpinnerLoad(true);

        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsSpinnerLoad(false);
            return;
        }

        try {
            const res = await fetch(`${BASE_URL}/auth/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, otp: otp.join('') }),
            });

            const data = await res.json();

            if (res.ok) {
                signUpSuccessToast(data);
                onSuccess();
            } else if (res.status === 429) {
                throw new Error(
                    "Too many attempts. Please wait a moment and try again"
                );
            } else {
                throw data;
            }
        } catch (error) {
            signUpErrorToast(error);
            setOtpError(true);
            setOtp(['', '', '', '', '', '']);
            otpRefs.current[0]?.focus();

            // Removes the shake class once its animation finishes.
            setTimeout(() => setOtpError(false), 400);
        } finally {
            setIsSpinnerLoad(false);
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
            const res = await fetch(`${BASE_URL}/auth/resend-otp`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });

            const data = await res.json();

            if (res.ok) {
                signUpSuccessToast(data);
                setOtp(['', '', '', '', '', '']);
                setCountdown(120);
                otpRefs.current[0]?.focus();
            } else if (res.status === 429) {
                signUpErrorToast({
                    message: "Too many attempts. Please wait a moment and try again",
                });
            } else {
                signUpErrorToast(data);
            }
        } catch (error) {
            signUpErrorToast({ message: "Failed to resend OTP" });
        } finally {
            setIsFetching(false);
        }
    };

    return (
        <div className="otp-card fade-from-right">
            <h1 className="otp-title">Verify OTP</h1>
            <p className="otp-subtitle">
                Enter the 6-digit code sent to {email}
            </p>

            <div className={`otp-inputs ${otpError ? "otp-shake" : ""}`}>
                {otp.map((digit, index) => (
                <input
                    key={index}
                    ref={(el) => (otpRefs.current[index] = el)}
                    className={`otp-input ${otpError ? "error" : ""}`}
                    type="text"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(index, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(index, e)}
                    onPaste={handleOtpPaste}
                />
                ))}
            </div>

            <button
                className="otp-submit"
                onClick={handleVerify}
                disabled={otp.join('').length !== 6}
            >
                {isFetching ? <FetchingLoader /> :  "Verify OTP"}
            </button>

            <p className={`otp-resend ${countdown > 0 ? "disabled" : ""}`}
                style={{marginBottom: "-5px"}}
            >
                {countdown > 0 ? (
                <>Resend OTP in <span>{countdown}s</span></>
                ) : (
                <span onClick={handleResend}>Resend OTP</span>
                )}
            </p>
        </div>
    );

}

export default OTPForm;