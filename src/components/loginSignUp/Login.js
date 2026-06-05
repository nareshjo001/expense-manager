import { useState } from "react";
import "./Auth.css";

import ForgotPassword from "./passwordReset/ForgotPassword";
import { loginSuccessToast, logInErrorToast } from '../alertsEffects/toastMessages';

const Login = ({setIsLoggedIn, setIsSignUp, setIsSpinnerLoad }) => {

  // Toggles the Forgot Password flow within the same auth feature
  const [forgotPassword, setForgotPassword] = useState(false);

  // Stores controlled form input values
  const [enteredLoginInfo, setEnteredLoginInfo] = useState({
    email: "",
    password: ""
  })

  /**
     * Handles controlled input updates.
     * Uses input `name` attribute to update corresponding state field.
  */
  const handleChange = (e) => {
    setEnteredLoginInfo(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  }

  /**
     * Submits login credentials to backend.
     * - Shows global spinner during request
     * - Persists auth data on success
     * - Handles success/error toasts
  */
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
        body: JSON.stringify(enteredLoginInfo),
      });

      const data = await response.json();

      if (response.ok) {

        localStorage.setItem("token", data.token);
  
        setIsLoggedIn(true);
        loginSuccessToast(data);

      } else {
        logInErrorToast(data);
      }
    } catch (error) {
      // Network or unexpected failure
      logInErrorToast({ message: "Something went wrong. Please try again." });
    } finally {
      // Ensure spinner always stops
      setIsSpinnerLoad(false);
    }
  };

  /**
     * Conditional render for Forgot Password flow.
     * Keeps auth-related screens within the same feature boundary.
  */
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