import { useState, useEffect } from "react";
import { FiLock, FiEye, FiEyeOff, FiArrowLeft } from "react-icons/fi";
// FE-002-T02 -- placeholder-only fields replaced with real labels.
import { LabeledField } from '../../a11y/LabeledField';
import "../Auth.css";
import AuthLayout from "../AuthLayout";
import { signUpSuccessToast, logInErrorToast } from "../../alertsEffects/toastMessages";

const styles = {
    resetPassError: {
        color: "#dc2626",
        fontSize: "13px",
        marginTop: "2px",
        marginBottom: "6px",
        textAlign: "left",
    }
};

// Final step of the forgot-password flow: sets a new password after OTP verification.
const ResetPassword = ({ onBack, email, resetToken, setIsSpinnerLoad }) => {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPass, setShowPass] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

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
                body: JSON.stringify({ email, password, resetToken }),
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
        <AuthLayout>
            <div className="reset-pass-card">
                <button 
                    type="button" 
                    className="auth-back-btn" 
                    onClick={onBack}
                    aria-label="Back"
                    title="Back"
                >
                    <FiArrowLeft />
                </button>
                
                <header className="login-header">
                    <h2 className="login-title">Set New Password</h2>
                    <p className="login-subtitle">
                        Your new password must be at least 8 characters long.
                    </p>
                </header>
                
                <main className="login-form">
                    <form onSubmit={handleSubmit}>
                        <LabeledField
                            label="New Password"
                            type={showPass ? "text" : "password"}
                            name="newPassword"
                            placeholder="Enter new password"
                            inputClassName="login-input login-input-with-icon login-input-with-action"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            maxLength={72}
                            autoComplete="new-password"
                            required
                            leftIcon={<FiLock className="login-field-icon" />}
                            rightAction={
                                <button
                                    type="button"
                                    className="login-password-toggle-btn"
                                    onClick={() => setShowPass((prev) => !prev)}
                                    aria-label={showPass ? "Hide password" : "Show password"}
                                    title={showPass ? "Hide password" : "Show password"}
                                >
                                    {showPass ? <FiEyeOff /> : <FiEye />}
                                </button>
                            }
                        />

                        <LabeledField
                            label="Confirm Password"
                            type={showConfirm ? "text" : "password"}
                            name="confirmPassword"
                            placeholder="Confirm new password"
                            inputClassName="login-input login-input-with-icon login-input-with-action"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            maxLength={72}
                            autoComplete="new-password"
                            required
                            leftIcon={<FiLock className="login-field-icon" />}
                            rightAction={
                                <button
                                    type="button"
                                    className="login-password-toggle-btn"
                                    onClick={() => setShowConfirm((prev) => !prev)}
                                    aria-label={showConfirm ? "Hide password" : "Show password"}
                                    title={showConfirm ? "Hide password" : "Show password"}
                                >
                                    {showConfirm ? <FiEyeOff /> : <FiEye />}
                                </button>
                            }
                        />

                        {error && (
                            <p className="reset-pass-error" style={styles.resetPassError}>
                                {error}
                            </p>
                        )}

                        <input
                            type="submit"
                            value="Change"
                            className="login-submit"
                            disabled={isDisabled}
                            style={{ marginTop: "12px" }}
                        />
                    </form>
                </main>
            </div>
        </AuthLayout>
    );
};

export default ResetPassword;
