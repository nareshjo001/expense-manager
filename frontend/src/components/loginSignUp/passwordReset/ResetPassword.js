import { useState, useEffect } from "react";
import back from '../../../icons/left-arrow.png';
import { signUpSuccessToast, logInErrorToast } from "../../alertsEffects/toastMessages";

const styles = {
    resetPassError: {
        color: "#dc2626",
        fontSize: "14px",
        marginTop: "-6px",
        textAlign: "left",
    }
}

// Final step of the forgot-password flow: sets a new password after OTP verification.
const ResetPassword = ({ onBack, email, setIsSpinnerLoad }) => {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [error, setError] = useState("");

    // Re-validates the password fields on every keystroke, keeping the error message and submit state in sync.
    useEffect(() => {
        if (!password && !confirmPassword) {
            setError("");
            return;
        }

        if (password.length < 8) {
            setError("Password must be at least 8 characters");
        } else if (confirmPassword && password !== confirmPassword) {
            setError("Passwords do not match");
        } else {
            setError("");
        }
    }, [password, confirmPassword]);

    const isDisabled =
        !password ||
        !confirmPassword ||
        error.length > 0;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isDisabled) return;

        setIsSpinnerLoad(true);
        
        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsSpinnerLoad(false);
            return;
        }

        try {
            const response = await fetch(`${BASE_URL}/auth/reset-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            const data = await response.json();

            if (response.ok) {
                signUpSuccessToast(data);
                onBack(); // Return user to previous auth screen
            } else if (response.status === 403) {
                // The OTP authorization window expired or was never completed — send the user back to restart the flow.
                logInErrorToast({
                    message: "Verification expired. Please request a new OTP",
                });
                onBack();
            } else if (response.status === 429) {
                logInErrorToast({
                    message: "Too many attempts. Please wait a moment and try again",
                });
            } else {
                logInErrorToast(data);
            }
        } catch (error) {
            logInErrorToast({ message: "Unable to reset password. Try again." });
        } finally {
            setIsSpinnerLoad(false);
        }
    };

    return (
        <div className="reset-pass-card fade-from-right" style={{padding: "25px 25px 45px"}}>
            <button onClick={onBack}>
                <img src={back} alt="reset-pass-back" />
            </button>
            
            <header className="reset-pass-header">
                <h1 className="reset-pass-text">Set New Password</h1>
                <p className="reset-pass-subtext">
                    Your new password must be at least 8 characters long.
                </p>
            </header>
            
            <main className="reset-pass">
                <form onSubmit={handleSubmit}>
                    <input
                        type="password"
                        placeholder="New Password"
                        className="reset-pass-input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />

                    <input
                        type="password"
                        placeholder="Confirm Password"
                        className="reset-pass-input"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                    />

                    {error && (
                        <p className="reset-pass-error" style={styles.resetPassError}>
                            {error}
                        </p>
                    )}

                    <input
                        type="submit"
                        value="Change"
                        className="reset-pass-submit"
                        disabled={isDisabled}
                    />
                </form>
            </main>
        </div>
    );
};

export default ResetPassword;