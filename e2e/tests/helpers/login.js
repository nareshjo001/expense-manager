'use strict';

// TST-001-T05 -- shared UI login helper so each spec's own body stays
// about what THAT journey is asserting, not about re-deriving login
// mechanics. Selectors below are all existing, accessible markup
// (placeholder-based field lookup, role-based button lookup) --
// frontend/src/components/loginSignUp/Login.js was not modified for this
// suite; nothing here needed a data-testid.
const { expect } = require('@playwright/test');
const { E2E_USER } = require('../../fixtures/testUser');

async function loginAsE2EUser(page) {
  await page.goto('/');

  await page.getByPlaceholder('Email ID').fill(E2E_USER.email);
  await page.getByPlaceholder('Password').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Login' }).click();

  // The authenticated app shell (frontend/src/components/landingPage/LandingPage.js)
  // always renders this line in its header -- a reliable "you're past the
  // login screen and the SPA has mounted the real dashboard" signal.
  await expect(page.getByText('Track your expenses easily!').first()).toBeVisible({
    timeout: 15_000,
  });
}

module.exports = { loginAsE2EUser };
