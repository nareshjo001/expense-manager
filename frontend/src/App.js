import React, { useState, useEffect } from 'react';
import { 
  ThemeProvider, 
  SplashScreen,
  Spinner,
  Login,
  SignUp,
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
import ErrorBoundary from "./components/ErrorBoundary";
import { SiaLauncherProvider } from "./components/sia/SiaLauncherContext";
import { refreshAccessToken } from "./api/sessionClient";

// Root app shell: gates the splash screen, authentication state, and global providers/routing.
function App() {
  // Controls initial splash screen visibility
  const [isLoading, setIsLoading] = useState(true);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLogout, setIsLogout] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  // Global blocking spinner (API calls, auth actions, etc.)
  const [isSpinnerLoad, setIsSpinnerLoad] = useState(false);

  const {
    showNotificationPrompt,
    showDetailedPreviews,
    setShowDetailedPreviews,
    handleEnable,
    handleLater
  } = useWebPush(isLoggedIn);

  // Restores the in-memory access credential from the rotated HttpOnly session cookie.
  useEffect(() => {
    let active = true;
    if (isLogout) {
      setIsLoggedIn(false);
      setIsLoading(false);
      return undefined;
    }
    refreshAccessToken().then((session) => {
      if (!active) return;
      setIsLoggedIn(Boolean(session?.token));
      setIsLoading(false);
    });
    return () => { active = false; };
  }, [isLogout]);

  useNativePush(isLoggedIn);

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

    keepAlive();

    const interval = setInterval(
      keepAlive,
      10 * 60 * 1000
    );

    return () => clearInterval(interval);

  }, [isLoading]);

  // Locks page scroll while the notification prompt is open.
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
      <ToastContainer
        enableMultiContainer
        containerId="below-header"
        position="top-right"
        toastContainerClassName="below-header-toast"
      />

      {showNotificationPrompt && (
        <div className="notification-modal">
          <div className="notification-content">
            <h3>Notification Privacy</h3>
            <p>Get reminders when recurring expenses are created.</p>
            <label>
              <input
                type="checkbox"
                checked={showDetailedPreviews}
                onChange={(event) => setShowDetailedPreviews(event.target.checked)}
              />
              Show expense names in notification previews
            </label>
            <p>Leave this off to keep lock-screen notifications private.</p>

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

      {isSpinnerLoad && <Spinner />}

      {!isLoggedIn && !isSignUp && (
        <div className='align-login-signup'>
          <Login 
            setIsLoggedIn={setIsLoggedIn} 
            setIsSignUp={setIsSignUp} 
            setIsSpinnerLoad={setIsSpinnerLoad} 
          />
        </div>
      )}

      {!isLoggedIn && isSignUp && (
        <div className='align-login-signup'>
          <SignUp 
            setIsSignUp={setIsSignUp} 
            setIsSpinnerLoad={setIsSpinnerLoad} 
          />
        </div>
      )}

      {isLoggedIn && !isSignUp && (
        <BrowserRouter>
          <ErrorBoundary>
            <ExpenseInsightsProvider>
              <ChartInsightsProvider>
                <SiaLauncherProvider>
                  <LandingPage setIsSpinnerLoad={setIsSpinnerLoad} setIsLogout={setIsLogout} setIsLoggedIn={setIsLoggedIn} />
                </SiaLauncherProvider>
              </ChartInsightsProvider>
            </ExpenseInsightsProvider>
          </ErrorBoundary>
        </BrowserRouter>
      )}
    </ThemeProvider>
  );
}

export default App;
