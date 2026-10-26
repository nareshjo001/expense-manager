import { useState } from "react";
import { FiUser, FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight, FiArrowLeft } from "react-icons/fi";
// FE-002-T02/T05 -- labelled fields with errors wired through aria-describedby.
import { LabeledField } from '../a11y/LabeledField';
import "./SignUp.css";
import "./Auth.css";
import AuthLayout from "./AuthLayout";

import OTPForm from "./OTPForm";
import { FetchingLoader } from '../alertsEffects/FetchingLoader';
import { signUpSuccessToast, signUpErrorToast } from '../alertsEffects/toastMessages';

// Signup form with client-side validation, then hands off to OTPForm for verification.
const SignUp = ({ setIsSignUp, setIsSpinnerLoad }) => {
    const [enteredUserInfo, setEnteredUserInfo] = useState({
        fullName: "",
        email: "",
        password: ""
    });

    const [showPassword, setShowPassword] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [errors, setErrors] = useState({});
    const [showOTPForm, setShowOTPForm] = useState(false);

    const validateForm = () => {
        const newErrors = {};

        if (!enteredUserInfo.fullName.trim()) {
            newErrors.fullName = 'Name is required';
        }

        if (!enteredUserInfo.email.trim()) {
            newErrors.email = 'Email is required';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(enteredUserInfo.email)) {
            newErrors.email = 'Enter a valid email';
        }

        if (!enteredUserInfo.password) {
            newErrors.password = 'Password is required';
        } else if (enteredUserInfo.password.length < 8) {
            newErrors.password = 'Password must be at least 8 characters';
        } else if (enteredUserInfo.password.length > 72) {
            newErrors.password = 'Password must be 72 characters or fewer';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    // Updates the field and clears its error as soon as the user edits it.
    const handleChange = (field) => (e) => {
        setEnteredUserInfo({ ...enteredUserInfo, [field]: e.target.value });
        
        if (errors[field]) setErrors({ ...errors, [field]: undefined });
    };

    // On success, advances to the OTP verification screen.
    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) return;
        setIsFetching(true);

        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        if (!BASE_URL) {
            setIsFetching(false);
            return;
        }

        try {
            const response = await fetch(`${BASE_URL}/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(enteredUserInfo),
            });

            const data = await response.json();

            if (response.ok) {
                signUpSuccessToast(data);
                setShowOTPForm(true);
            } else if (response.status === 429) {
                signUpErrorToast({
                    message: "Too many attempts. Please wait a moment and try again",
                });
            } else {
                signUpErrorToast(data);
            }
        } catch (error) {
            signUpErrorToast({ message: "Unable to sign up. Try again." });
        } finally {
            setIsFetching(false);
        }
    };

    if (showOTPForm) {
        return (
            <OTPForm
                email={enteredUserInfo.email}
                onSuccess={() => setIsSignUp(false)}
                setIsSpinnerLoad={setIsSpinnerLoad}
                onBack={() => setShowOTPForm(false)}
            />
        );
    }

    return (
        <AuthLayout>
            <div className="signup-card">
                <button 
                    type="button" 
                    className="auth-back-btn" 
                    onClick={() => setIsSignUp(false)}
                    aria-label="Back to login"
                    title="Back to login"
                >
                    <FiArrowLeft />
                </button>

                <header className="login-header">
                    <h2 className="login-title">Create Account</h2>
                    <p className="login-subtitle">Join Balensia and take control of your finances.</p>
                </header>

                <main className="login-form">
                    <form onSubmit={handleSubmit}>
                        <LabeledField
                            label="Full Name"
                            type="text"
                            name="fullname"
                            placeholder="Enter your full name"
                            inputClassName={`login-input login-input-with-icon ${errors.fullName ? "error" : ""}`}
                            value={enteredUserInfo.fullName}
                            onChange={handleChange('fullName')}
                            autoComplete="name"
                            error={errors.fullName}
                            required
                            leftIcon={<FiUser className="login-field-icon" />}
                        />

                        <LabeledField
                            label="Email ID"
                            type="email"
                            name="email"
                            placeholder="Enter your email"
                            inputClassName={`login-input login-input-with-icon ${errors.email ? "error" : ""}`}
                            value={enteredUserInfo.email}
                            onChange={handleChange('email')}
                            autoComplete="email"
                            error={errors.email}
                            required
                            leftIcon={<FiMail className="login-field-icon" />}
                        />

                        <LabeledField
                            label="Password"
                            type={showPassword ? "text" : "password"}
                            name="password"
                            placeholder="Create a password"
                            inputClassName={`login-input login-input-with-icon login-input-with-action ${errors.password ? "error" : ""}`}
                            value={enteredUserInfo.password}
                            onChange={handleChange('password')}
                            maxLength={72}
                            autoComplete="new-password"
                            error={errors.password}
                            required
                            leftIcon={<FiLock className="login-field-icon" />}
                            rightAction={
                                <button
                                    type="button"
                                    className="login-password-toggle-btn"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    aria-label={showPassword ? "Hide password" : "Show password"}
                                    title={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? <FiEyeOff /> : <FiEye />}
                                </button>
                            }
                        />

                        {!errors.password && (
                            <p className="signup-password-hint">
                                Use at least 8 characters with a number and a symbol.
                            </p>
                        )}

                        <button
                            type="submit"
                            className="login-submit"
                            disabled={isFetching}
                            style={{ marginTop: errors.password ? "6px" : "2px" }}
                        >
                            {isFetching ? (
                                <FetchingLoader />
                            ) : (
                                <>
                                    <span>Sign Up</span>
                                    <FiArrowRight className="login-submit-arrow" aria-hidden="true" />
                                </>
                            )}
                        </button>
                    </form>
                </main>

                <footer className="login-footer">
                    <span className="login-divider-line" aria-hidden="true" />
                    <div className="login-footer-content">
                        <span>Already have an account?</span>
                        <button 
                            type="button"
                            className="login-signup-btn" 
                            onClick={() => setIsSignUp(false)}
                        >
                            Log In
                        </button>
                    </div>
                    <span className="login-divider-line" aria-hidden="true" />
                </footer>
            </div>
        </AuthLayout>
    );
};

export default SignUp;
