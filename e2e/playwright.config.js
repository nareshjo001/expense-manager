// @ts-check
'use strict';

// TST-001-T05 -- Playwright config for the core user-journey E2E suite.
//
// Starts BOTH real servers (the real Express backend, wired to a real
// MongoDB + Redis; the real CRA dev server for the frontend) via
// `webServer`, the same pattern this repo's CI already uses for
// backend-integration (see .github/workflows/ci.yml's `backend-integration`
// job and backend/jest.integration.config.js) -- just extended one layer
// further, up through an actual browser. See
// docs/testing/TST-001-T05-e2e-setup.md for the full setup story,
// including why this session could not execute a live run in its own
// sandbox.
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');

const BACKEND_PORT = process.env.E2E_BACKEND_PORT || '8081';
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT || '3000';
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

const MONGO_CONN = process.env.MONGO_CONN || 'mongodb://127.0.0.1:27017/expense_manager_e2e';
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const JWT_SECRET = process.env.JWT_SECRET || 'e2e-local-jwt-secret-not-for-production';

// Shared with global-setup.js (and available to spec files) regardless of
// how this config ends up invoked.
process.env.E2E_BACKEND_URL = BACKEND_URL;
process.env.E2E_MONGO_CONN = MONGO_CONN;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: require.resolve('./global-setup.js'),

  use: {
    baseURL: FRONTEND_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Two real servers, following the same env-var names as
  // backend/config/db.js (MONGO_CONN), backend/config/redis.js
  // (REDIS_URL), and backend/Middlewares/Auth.js (JWT_SECRET) -- not
  // invented names. REFRESH_TOKEN_SECRET intentionally omitted:
  // backend/Services/AuthServices/session.service.js already falls back
  // to JWT_SECRET when it's unset.
  webServer: [
    {
      command: 'node server.js',
      cwd: BACKEND_DIR,
      url: BACKEND_URL + '/',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV || 'test',
        PORT: BACKEND_PORT,
        MONGO_CONN,
        REDIS_URL,
        JWT_SECRET,
        // No real ML service runs in this suite -- point at a port
        // nothing listens on so backend/utils/mlServiceClient.js calls
        // fail fast (ECONNREFUSED) instead of hanging. The frontend's ML
        // category-suggestion call already treats any non-2xx response as
        // a silent no-op (frontend/src/components/expensesHandling/AddExpense.js),
        // so this never blocks the Add Expense journey.
        ML_ROUTE: process.env.ML_ROUTE || 'http://127.0.0.1:65535',
        // Only used if global-setup's seed signup call reaches the email
        // step; a dummy key is fine since that call's failure mode (503)
        // is explicitly handled as a non-error there.
        BREVO_API_KEY: process.env.BREVO_API_KEY || 'e2e-dummy-brevo-key',
      },
    },
    {
      command: 'npm start',
      cwd: FRONTEND_DIR,
      url: FRONTEND_URL,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PORT: FRONTEND_PORT,
        BROWSER: 'none',
        CI: 'true',
        REACT_APP_BACKEND_URL: BACKEND_URL,
      },
    },
  ],
});
