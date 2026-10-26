import { useState } from "react";
import "./Auth.css";
import AuthLayout from "./AuthLayout";
import { onKeyActivate } from "../../utils/onKeyActivate";
import { FiMail, FiLock, FiEye, FiEyeOff, FiArrowRight } from "react-icons/fi";

import ForgotPassword from "./passwordReset/ForgotPassword";
import { loginSuccessToast, logInErrorToast } from '../alertsEffects/toastMessages';
// FE-002-T02 -- these fields identified themselves with placeholder text only.
import { LabeledField } from '../a11y/LabeledField';
import { setAccessToken } from '../../api/sessionClient';

// Login form with an inline Forgot Password flow.
const Login = ({ setIsLoggedIn, setIsSignUp, setIsSpinnerLoad }) => {
  const [forgotPassword, setForgotPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [enteredLoginInfo, setEnteredLoginInfo] = useState({
    email: "",
    password: ""
  });

  const handleChange = (e) => {
    setEnteredLoginInfo((prev) => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSpinnerLoad(true);
    
    const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
    if (!BASE_URL) {
      setIsSpinnerLoad(false);
      return;
    }

    try {
      const response = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(enteredLoginInfo),
      });

      const data = await response.json();

      if (response.ok) {
        setAccessToken(data.token);
        setIsLoggedIn(true);
        loginSuccessToast(data);
      } else if (response.status === 429) {
        logInErrorToast({
          message: "Too many attempts. Please wait a moment and try again",
        });
      } else {
        logInErrorToast(data);
      }
    } catch (error) {
      logInErrorToast({ message: "Something went wrong. Please try again." });
    } finally {
      setIsSpinnerLoad(false);
    }
  };

  if (forgotPassword) {
    return (
      <ForgotPassword
        onBack={() => setForgotPassword(false)}
        setIsSpinnerLoad={setIsSpinnerLoad}
      />
    );
  }

  return (
    <AuthLayout>
      <div className="login-card">
        <header className="login-header">
          <h2 className="login-title">Welcome Back!</h2>
          <p className="login-subtitle">Log in to your Balensia account and take control of your finances.</p>
        </header>

        <main className="login-form">
          <form onSubmit={handleSubmit}>
            <LabeledField
              label="Email ID"
              type="email"
              name="email"
              placeholder="Enter your email"
              value={enteredLoginInfo.email}
              inputClassName="login-input login-input-with-icon"
              onChange={handleChange}
              maxLength={72}
              autoComplete="email"
              required
              leftIcon={<FiMail className="login-field-icon" />}
            />

            <LabeledField
              label="Password"
              type={showPassword ? "text" : "password"}
              name="password"
              placeholder="Enter your password"
              value={enteredLoginInfo.password}
              inputClassName="login-input login-input-with-icon login-input-with-action"
              onChange={handleChange}
              autoComplete="current-password"
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

            <div className="forgot-password">
              <p
                role="button"
                tabIndex={0}
                onClick={() => setForgotPassword(true)}
                onKeyDown={onKeyActivate(() => setForgotPassword(true))}
              >
                Forgot Password ?
              </p>
            </div>

            <button
              type="submit"
              className="login-submit"
            >
              <span>Login</span>
              <FiArrowRight className="login-submit-arrow" aria-hidden="true" />
            </button>
          </form>
        </main>

        <footer className="login-footer">
          <span className="login-divider-line" aria-hidden="true" />
          <div className="login-footer-content">
            <span>Don't have an account?</span>
            <button 
              type="button"
              className="login-signup-btn" 
              onClick={() => setIsSignUp(true)}
            >
              Sign Up
            </button>
          </div>
          <span className="login-divider-line" aria-hidden="true" />
        </footer>
      </div>
    </AuthLayout>
  );
};

export default Login;
