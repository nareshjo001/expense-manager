'use strict';

// TST-001-T05 -- core auth journeys, at the real browser/UI layer.
//
// docs/testing/TST-001-risk-coverage-matrix.md already tracks auth very
// heavily at the API layer (backend/tests/auth.*.test.js,
// auth.jwtExpiration.test.js, auth.recoverySecurity.test.js,
// auth.sessionSecurity.test.js). Neither of the two journeys below
// re-covers that ground -- they cover what only a real browser can:
// that the login FORM actually submits the right payload, that a real
// 2xx response actually flips the SPA from the login screen to the
// authenticated dashboard, and that a real 401 actually surfaces as a
// visible, readable error to the user rather than a silent failure.
//
// Sign-up is intentionally NOT one of these journeys: real signup
// requires reading an emailed OTP, which no CI/sandbox environment can do
// (see global-setup.js and docs/testing/TST-001-T05-e2e-setup.md for how
// the seeded login user below is provisioned instead).
const { test, expect } = require('@playwright/test');
const { loginAsE2EUser } = require('./helpers/login');
const { E2E_USER } = require('../fixtures/testUser');

test.describe('Authentication', () => {
  test('logs in with valid credentials and lands on the authenticated dashboard', async ({ page }) => {
    await loginAsE2EUser(page);

    // The post-login nav (frontend/src/components/landingPage/LandingPage.js)
    // is the concrete, user-visible proof the SPA is now in its
    // authenticated state, not just that some text appeared.
    await expect(page.getByRole('link', { name: 'Expenses' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add' })).toBeVisible();

    // loginSuccessToast (frontend/src/components/alertsEffects/toastMessages.js)
    // renders "Welcome {firstname}" using the real name the seeded user
    // was signed up with.
    await expect(page.getByText(`Welcome ${E2E_USER.fullName}`)).toBeVisible();
  });

  test('shows a visible error and stays on the login screen for invalid credentials', async ({ page }) => {
    await page.goto('/');

    // A random, never-signed-up identity each run: backend/utils/rateLimiter.js's
    // loginLimiter is keyed per-identity (10 attempts / 15 min), so reusing
    // one fixed bad-login email across repeated local runs against a
    // reused dev server would eventually 429 instead of 401 -- a fresh
    // identity every run sidesteps that without weakening the assertion.
    const unknownEmail = `nonexistent-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

    await page.getByPlaceholder('Email ID').fill(unknownEmail);
    await page.getByPlaceholder('Password').fill('totally-wrong-password');
    await page.getByRole('button', { name: 'Login' }).click();

    // backend/Services/AuthServices/security.service.js's
    // INVALID_CREDENTIALS_RESPONSE.message, rendered verbatim by
    // logInErrorToast.
    await expect(page.getByText('Invalid email or password', { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // Still on the login screen -- no false "logged in" state.
    await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expenses' })).toHaveCount(0);
  });
});
