import React from 'react';
import './Auth.css';

export const AuthHeroColumn = () => (
  <aside className="login-hero-column" aria-label="Balensia Overview">
    <div className="login-brand-header">
      <div className="login-brand-badge" aria-hidden="true">
        <img src="/icons/logo-dark.png" alt="" className="login-brand-logo-img" />
      </div>
      <div className="login-brand-text">
        <h1 className="login-brand-title">Balensia</h1>
        <p className="login-brand-tagline">Track • Plan • Save</p>
      </div>
    </div>

    <div className="login-hero-illustration-wrapper">
      <img
        src="/images/login-hero-illustration.png"
        alt="Financial growth and budgeting illustration"
        className="login-hero-img"
      />
    </div>
  </aside>
);

const AuthLayout = ({ children }) => {
  return (
    <div className="login-page-wrapper fade-from-right">
      <div className="login-page-inner">
        <AuthHeroColumn />
        <div className="login-card-column">
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
