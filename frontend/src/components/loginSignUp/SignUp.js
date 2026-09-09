import { useState } from "react";
// FE-002-T02/T05 -- labelled fields with errors wired through aria-describedby.
import { LabeledField } from '../a11y/LabeledField';
import "./SignUp.css";
import back from '../../icons/left-arrow.png';

import OTPForm from "./OTPForm";
import { FetchingLoader }from '../alertsEffects/FetchingLoader';
import { signUpSuccessToast, signUpErrorToast } from '../alertsEffects/toastMessages';

// Signup form with client-side validation, then hands off to OTPForm for verification.
const SignUp = ({ setIsSignUp, setIsSpinnerLoad }) => {
    const [enteredUserInfo, setEnteredUserInfo] = useState({
        fullName:"",
        email:"",
        password:""
    })

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
            />
        );
    }

    return (
        <div className="signup-card fade-from-right">
            <button onClick={() => setIsSignUp(false)} >
                <img src={back} alt="nav-back" />
            </button>

            <header>
                <div className="signup-header">
                    <h1 className="signup-title">Sign Up</h1>
                    <p className="signup-subtitle">Create your account securely</p>
                </div>
            </header>

            <main>
                <div className="signup-form">
                    <form onSubmit={handleSubmit}>
                        
                        <div className="field">
                            <LabeledField
                                label="Full Name"
                                type="text"
                                name="fullname"
                                inputClassName={`signup-input ${errors.fullName ? "error" : ""}`}
                                value={enteredUserInfo.fullName}
                                onChange={handleChange('fullName')}
                                autoComplete="name"
                                error={errors.fullName}
                                required
                                />
                        </div>

                        <div className="field">
                            <LabeledField
                                label="Email"
                                type="email"
                                name="email"
                                inputClassName={`signup-input ${errors.email ? "error" : ""}`}
                                value={enteredUserInfo.email}
                                onChange={handleChange('email')}
                                autoComplete="email"
                                error={errors.email}
                                required
                                />
                        </div>

                        <div className="field">
                            <LabeledField
                                label="Password"
                                type="password"
                                name="password"
                                inputClassName={`signup-input ${errors.password ? "error" : ""}`}
                                value={enteredUserInfo.password}
                                onChange={handleChange('password')}
                                maxLength={72}
                                autoComplete="new-password"
                                error={errors.password}
                                required
                                />
                        </div>

                        <button
                            type="submit"
                            className="forgot-pass-submit"
                            disabled={isFetching}
                            style={{marginTop: "14px"}}
                        >
                            {isFetching ? <FetchingLoader /> :  "Sign Up"}
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
};

export default SignUp;
