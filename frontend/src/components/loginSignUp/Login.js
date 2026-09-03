import { useState } from "react";
import "./Auth.css";

import ForgotPassword from "./passwordReset/ForgotPassword";
import { loginSuccessToast, logInErrorToast } from '../alertsEffects/toastMessages';
import { setAccessToken } from '../../api/sessionClient';

// Login form with an inline Forgot Password flow.
const Login = ({setIsLoggedIn, setIsSignUp, setIsSpinnerLoad }) => {

  const [forgotPassword, setForgotPassword] = useState(false);

  const [enteredLoginInfo, setEnteredLoginInfo] = useState({
    email: "",
    password: ""
  })

  const handleChange = (e) => {
    setEnteredLoginInfo(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  }

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
    <div className="login-card fade-from-right">
      <header className="login-header">
        <h2 className="login-title">User Login</h2>
        <p className="login-subtitle">Access your account securely</p>
      </header>

      <main className="login-form">
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            name="email"
            placeholder="Email ID"
            className="login-input"
            onChange={handleChange}
            maxLength={72}
            required
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            className="login-input"
            onChange={handleChange}
            required
          />

          <div className="forgot-password">
            <p onClick={() => setForgotPassword(true)}>Forgot Password ?</p>
          </div>

          <input
            type="submit"
            value="Login"
            className="login-submit"
          />
        </form>
      </main>

      <footer className="login-footer">
        <p>Don't have an account?</p>
        <button 
          className="login-signup-btn" 
          onClick={() => setIsSignUp(true)}
        >
          Sign Up
        </button>
      </footer>
    </div>
  );
};

export default Login;
