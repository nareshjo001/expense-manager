import React, { useContext } from 'react';
import './Auth.css';
import { ThemeContext } from '../contexts/ThemeContext';
import { FiSun, FiMoon } from 'react-icons/fi';
import appLogoPink from '../../icons/Logo Pink.png';
import appLogoDark from '../../icons/Logo Dark.png';

const AuthLayout = ({ children }) => {
  const themeContext = useContext(ThemeContext);
  const theme = themeContext?.theme || 'light-theme';
  const toggleTheme = themeContext?.toggleTheme;
  const isDark = theme === 'dark-theme';

  return (
    <div className={`login-page-wrapper fade-from-right ${theme}`}>
      {toggleTheme && (
        <div className="auth-theme-toggle-wrapper">
          <button
            type="button"
            className="auth-theme-toggle-btn"
            onClick={toggleTheme}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            title={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? <FiSun className="auth-theme-toggle-icon" /> : <FiMoon className="auth-theme-toggle-icon" />}
          </button>
        </div>
      )}

      <div className="login-page-inner">
        <header className="login-brand-header">
          <div className="login-brand-badge" aria-hidden="true">
            <img
              src={isDark ? appLogoDark : appLogoPink}
              alt="Balensia"
              className="login-brand-logo-img"
            />
          </div>
          <div className="login-brand-text">
            <h1 className="login-brand-title">Balensia</h1>
            <p className="login-brand-tagline">Track • Plan • Save</p>
          </div>
        </header>

        <div className="login-card-column">
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
