import { useState, useEffect } from "react"
import back from '../../../icons/left-arrow.png';

import ResetPassword from "./ResetPassword";
import { signUpSuccessToast, logInErrorToast } from "../../alertsEffects/toastMessages";
import { FetchingLoader } from "../../alertsEffects/FetchingLoader";

const ForgotPassword = ({ onBack, setIsSpinnerLoad }) => {

    // Email entered by user
    const [email, setEmail] = useState('');
    
    // OTP flow state
    const [isOTPSent, setIsOTPSent] = useState(false);
    const [otp, setOtp] = useState("");
    const [isOTPVerified, setIsOTPVerified] = useState(false);
    
    // Countdown timer for OTP resend
    const [countdown, setCountdown] = useState(120);
    
    // Prevents duplicate API calls
    const [isFetching, setIsFetching] = useState(false);

    /**
     * OTP resend countdown
     * Runs only when countdown > 0
     * Cleans up timer on unmount or state change
    */
    useEffect(() => {
        if (countdown <= 0) return;

        const timer = setTimeout(() => {
            setCountdown((prev) => prev - 1);
        }, 1000);

        return () => clearTimeout(timer);
    }, [countdown]);

    /**
     * Handles both:
     * 1. Sending OTP (forgot-password)
     * 2. Verifying OTP (verify-otp)
    */
    const handleSubmit = async (e) => {
        e.preventDefault();

        if (isFetching) return;
        setIsFetching(true);

        const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsFetching(false);
            return;
        }

        try {
            if (!isOTPSent) {
                // STEP 1: Send OTP
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
                // STEP 2: Verify OTP
                const response = await fetch(`${BASE_URL}/auth/verify-otp`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email, otp }),
                });

                const data = await response.json();

                if (response.ok) {
                    signUpSuccessToast(data);
                    setIsOTPVerified(true);
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

    // Resends OTP after countdown reaches zero
    const handleResend = async () => {
        if (countdown > 0 || isFetching) return;
        setIsFetching(true);

        const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
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

    // Once OTP is verified, move to Reset Password screen
    if (isOTPVerified) {
        return (
            <ResetPassword
                onBack={onBack}
                email={email}
                setIsSpinnerLoad={setIsSpinnerLoad}
            />
        );
    }

    return (
        <div className="forgot-pass-card fade-from-right" style={{padding: "25px 25px 45px"}}>
            <button onClick={onBack}>
                <img src={back} alt="forgot-pass-back" />
            </button>
            
            <header className="forgot-pass-header">
                <h1 className="forgot-pass-text">Forgot Password ?</h1>
                <p className="forgot-pass-subtext">
                    Enter your email address and we'll send you a OTP to reset your password
                </p>
            </header>
            
            <main className="forgot-pass">
                <form onSubmit={handleSubmit}>
                    <input
                        type="email"
                        placeholder="Email ID"
                        className="forgot-pass-input"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={isOTPSent}
                    />

                    <div className={`otp-wrapper ${isOTPSent ? "open" : ""}`}>
                        <input
                            type="text"
                            placeholder="Enter OTP"
                            className="forgot-pass-input"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value)}
                            required={isOTPSent}
                        />
                    </div>

                    <button
                        type="submit"
                        className="forgot-pass-submit"
                        disabled={isFetching}
                    >
                        {isFetching ? <FetchingLoader /> : isOTPSent ? "Verify" : "Send OTP"}
                    </button>

                </form>
                
                { isOTPSent && 
                    <p className={`otp-resend ${countdown > 0 ? "disabled" : ""}`}>
                        {countdown > 0 ? (
                        <>Resend OTP in <span>{countdown}s</span></>
                        ) : (
                        <span onClick={handleResend}>Resend OTP</span>
                        )}
                    </p>
                }
            </main>
        </div>
    )
}

export default ForgotPassword;