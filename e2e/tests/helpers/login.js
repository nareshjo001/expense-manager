'use strict';

// TST-001-T05 -- shared UI login helper so each spec's own body stays
// about what THAT journey is asserting, not about re-deriving login
// mechanics. Selectors are all existing, accessible markup (label-based
// field lookup, role-based button lookup); nothing here needs a
// data-testid.
//
// FE-002-T02 (2026-09-09): these were getByPlaceholder until the login
// fields gained real <label> elements and stopped relying on placeholder
// text to identify themselves. getByLabel is the better selector anyway --
// it resolves through the same label/id relationship a screen reader uses,
// so this suite now fails if that binding is ever broken, which is exactly
// what an end-to-end test should notice.
const { expect } = require('@playwright/test');
const { E2E_USER } = require('../../fixtures/testUser');

async function loginAsE2EUser(page) {
  await page.goto('/');

  await page.getByLabel(/Email ID/).fill(E2E_USER.email);
  await page.getByLabel(/Password/).fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Login' }).click();

  // The authenticated app shell (frontend/src/components/landingPage/LandingPage.js)
  // always renders this line in its header -- a reliable "you're past the
  // login screen and the SPA has mounted the real dashboard" signal.
  await expect(page.getByText('Track your expenses easily!').first()).toBeVisible({
    timeout: 15_000,
  });
}

module.exports = { loginAsE2EUser };
