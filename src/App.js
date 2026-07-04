import React, { useState, useEffect } from 'react';
import { 
  ThemeProvider, 
  SplashScreen,
  Spinner,
  Login,
  SignUp,
  BudgetProvider,
  ExpenseInsightsProvider,
  ChartInsightsProvider,
  LandingPage,
  expenseAddErrorToast
} from './imports/Imports';
import './App.css';

import { BrowserRouter } from 'react-router-dom';

import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { useWebPush } from "./components/hooks/useWebPush";
import { useNativePush } from "./components/hooks/useMobilePush";

function App() {
  // Controls initial splash screen visibility
  const [isLoading, setIsLoading] = useState(true);
  
  // Auth-related UI state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLogout, setIsLogout] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  
  // Global blocking spinner (API calls, auth actions, etc.)
  const [isSpinnerLoad, setIsSpinnerLoad] = useState(false);

  // For Web Push
  const {
    showNotificationPrompt,
    handleEnable,
    handleLater
  } = useWebPush(isLoggedIn);

  /**
     * Authentication bootstrap
     * Checks token presence on first app mount.
     * If logout or missing → clears storage to avoid stale state.
  */
  useEffect(() => {
    const token = localStorage.getItem("token");

    if (token && !isLogout) {
      setIsLoggedIn(true);
    } else {
      setIsLoggedIn(false);
    }
  }, [isLogout]);

  useNativePush(isLoggedIn);

  /**
     * Backend keep-alive ping
     * Prevents cold-start delay on platforms like Render.
     * Guarded to avoid invalid fetch if env variable is missing.
  */
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 2000);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
    if (!BASE_URL) return;

    const keepAlive = async () => {
      try {
        const response = await fetch(`${BASE_URL}/ping`);
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if(data.ml === 'down') {
            data.message = 'ML Server Down!';
          } else {
            data.message = 'Backend Server Down!';
          }
          expenseAddErrorToast({
            message: data.message || "Server unavailable."
          });
        }

      } catch {
        expenseAddErrorToast({
          message: 'Backend Server Down!'
        });
      }
    };

    // Initial health check
    keepAlive();

    // Periodic health check
    const interval = setInterval(
      keepAlive,
      10 * 60 * 1000
    );

    return () => clearInterval(interval);

  }, [isLoading]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    if (showNotificationPrompt) {
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
    } else {
      html.style.overflow = "auto";
      body.style.overflow = "auto";
    }

    return () => {
      html.style.overflow = "auto";
      body.style.overflow = "auto";
    };
  }, [showNotificationPrompt]);

  // Short-circuit render while splash screen is active
  if (isLoading) {
    return <SplashScreen />;
  }

  return (
    <ThemeProvider>
      {/* Global toast container (used across the app) */}
      <ToastContainer
        enableMultiContainer
        containerId="below-header"
        position="top-right"
        toastContainerClassName="below-header-toast"
      />

      {showNotificationPrompt && (
        <div className="notification-modal">
          <div className="notification-content">
            <h3>Enable Notifications?</h3>
            <p>Get real-time budget alerts and reminders.</p>

            <div className="notification-buttons">
              <button onClick={handleEnable} >
                Continue
              </button>

              <button onClick={handleLater}>
                Maybe Later
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-screen spinner overlay for blocking operations */}
      {isSpinnerLoad && <Spinner />}

      {/* Login screen */}
      {!isLoggedIn && !isSignUp && (
        <div className='align-login-signup'>
          <Login 
            setIsLoggedIn={setIsLoggedIn} 
            setIsSignUp={setIsSignUp} 
            setIsSpinnerLoad={setIsSpinnerLoad} 
          />
        </div>
      )}

      {/* Sign-up screen */}
      {!isLoggedIn && isSignUp && (
        <div className='align-login-signup'>
          <SignUp 
            setIsSignUp={setIsSignUp} 
            setIsSpinnerLoad={setIsSpinnerLoad} 
          />
        </div>
      )}

      {/* Main application (mounted only after authentication) */}
      {isLoggedIn && !isSignUp && (
        <BrowserRouter>
            <ExpenseInsightsProvider>
              <ChartInsightsProvider>
                <BudgetProvider>
                  <LandingPage setIsSpinnerLoad={setIsSpinnerLoad} setIsLogout={setIsLogout} setIsLoggedIn={setIsLoggedIn} />
                </BudgetProvider>
              </ChartInsightsProvider>
            </ExpenseInsightsProvider>
        </BrowserRouter>
      )}
    </ThemeProvider>
  );
}

export default App;