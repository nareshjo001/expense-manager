'use strict';

// TST-001-T05 -- the single seeded, pre-verified account every E2E spec
// logs in as. Fixed (not randomized per run) so global-setup.js is
// idempotent: re-running it locally against an already-seeded database
// just re-verifies the same user instead of accumulating duplicates.
const E2E_USER = {
  fullName: 'Playwright E2E',
  email: 'e2e-core-journeys@expense-manager.test',
  password: 'E2E-Test-Passw0rd!',
};

module.exports = { E2E_USER };
