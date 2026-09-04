# TST-001-T05: Playwright end-to-end user journeys

`e2e/` holds a small [Playwright](https://playwright.dev/) suite covering
this app's core user journeys against the **real** Express backend and a
**real** MongoDB + Redis -- not mocks, and not a component-level render
test. It closes the gap
[TST-001-risk-coverage-matrix.md](./TST-001-risk-coverage-matrix.md)
identified: "no Playwright, Cypress, or `e2e`/`cypress` directory exists
anywhere in `frontend/`."

## Where this lives, and why

`e2e/` is its own top-level npm package, a sibling of `backend/` and
`frontend/` -- there is no monorepo-root `package.json` in this repo to
attach Playwright to instead, and each existing concern here
(`backend/`, `frontend/`, `ml-service/`) already gets its own directory
and its own `package.json`. Keeping Playwright out of `frontend/`'s own
`package.json` also avoids mixing two different meanings of `npm test`
(CRA/Jest component tests vs. Playwright's own `test` command) in one
package.

## What's covered

Four journeys, in `e2e/tests/`:

| Spec | Journey | Why this one |
|---|---|---|
| `auth.spec.js` | Log in with valid credentials, land on the authenticated dashboard (nav links visible, welcome toast) | The most basic "does auth actually work end to end" proof -- nothing at the API-test layer proves the login *form* submits correctly or that the SPA actually flips state on a 2xx. |
| `auth.spec.js` | Log in with invalid credentials, see a real, visible error, stay on the login screen | Auth is this repo's most heavily API-tested risk area (`backend/tests/auth.*.test.js`) -- this journey deliberately does NOT re-cover that; it only proves the real 401 response actually renders as something a user can see and read, and that a failed login can't accidentally leave a false "logged in" UI state. |
| `expense.spec.js` | Fill the Add Expense form, submit, see the new expense in the real expense list | The core "committed-write, then re-read" loop for this app's central object, through a real create request and a real re-fetch (not a mocked mutation). |
| `budget.spec.js` | Set this month's budget, see it reflected in the real `BudgetBar` | The other core mutate-then-see-it-reflected loop `ExpensesPage.js` renders on every visit to the dashboard. |

Deliberately **not** covered: sign-up. A real sign-up requires reading an
OTP out of a delivered email, which no CI runner or local dev sandbox
without a real inbox can do. See "How the login user is seeded" below for
how login gets tested anyway.

This is a "core journeys" suite, not exhaustive E2E coverage -- charts,
income, recurring expenses, bill-scan/OCR, merchant rules, and SIA are all
out of scope here by design (T05's own task scope says "core", not "all").

## How the login user is seeded

Playwright's `globalSetup` (`e2e/global-setup.js`) runs once before any
spec, against the same backend + MongoDB the `webServer` config just
started:

1. `POST /auth/signup` for real, against the real backend. This exercises
   the real signup controller and gets a genuinely bcrypt-hashed password
   into MongoDB the exact way a real user's would be.
2. Connects to the same MongoDB directly and applies the same mutation
   `backend/Controllers/AuthControllers/verifyOTP.js` makes on a correct
   OTP: `isVerified: true`, OTP fields cleared.

Step 2 is the *only* thing this suite fakes, and it fakes exactly one
thing: "a human read the OTP out of their email and typed it in." It does
not fake, mock, or bypass anything about login, session issuance, cookies,
or the dashboard itself -- all of that runs for real, every time, in every
spec.

## Selectors: no `data-testid` was added

Every existing form and interactive element this suite touches
(`Login.js`, `AddExpense.js`, `SetBudget.js`, `ExpenseItem.js`,
`LandingPage.js`'s nav) already has a real `<label htmlFor>`, a
placeholder, an accessible role, or stable visible text -- so every
selector in this suite is `getByLabel` / `getByPlaceholder` / `getByRole`
/ `getByText`. **No frontend source file was modified for this task.**

One genuine ambiguity turned up during selector work: the Add/Add Income
type-toggle button in `Add.js` and the Add Expense form's own submit
button in `AddExpense.js` are both literally labelled "Add Expense", so
`getByRole('button', { name: 'Add Expense' })` matches two elements. That
was resolved with the form's own pre-existing `.submit-btn` class
(`page.locator('form.add-expense .submit-btn')`) rather than adding a new
attribute -- the instructed target for adding a testid ("only where
visible-text/role matching would be fragile or ambiguous, and only the
specific elements needed") turned out, on inspection, to already have a
stable non-testid selector available.

## Running it for real, locally

You need a **real MongoDB and a real Redis** reachable from your machine
(a real backend/DB is a hard requirement -- see "Why this session
couldn't run it live" below for why that's non-negotiable for this kind
of suite). From the repo root:

```bash
# 1. Install each package's own dependencies (only needed once, or after
#    a dependency change):
npm ci --prefix backend
npm ci --prefix frontend
npm ci --prefix e2e

# 2. Install Playwright's browser binary (only needed once):
npx --prefix e2e playwright install --with-deps chromium

# 3. Point the suite at your real Mongo/Redis (defaults assume
#    mongodb://127.0.0.1:27017 and redis://127.0.0.1:6379 -- override if
#    yours differ):
export MONGO_CONN="mongodb://127.0.0.1:27017/expense_manager_e2e"
export REDIS_URL="redis://127.0.0.1:6379"
export JWT_SECRET="local-e2e-secret"

# 4. Run it. Playwright starts both the real backend and the real
#    frontend dev server itself (see e2e/playwright.config.js's
#    `webServer` entries) and tears them down after.
npm test --prefix e2e
```

Useful variants: `npm run test:headed --prefix e2e` (watch it run in a
real visible browser), `npm run test:ui --prefix e2e` (Playwright's
interactive UI runner), `npm run test:list --prefix e2e` (enumerate specs
without running anything -- no server or DB needed for this one).

`E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT` env vars override the default
ports (8081 / 3000) if either is already in use on your machine.

## Running it in CI

`.github/workflows/ci.yml`'s new `e2e` job runs this suite automatically
on every push/PR, using the same real-service-container pattern the
existing `backend-integration` job already uses: real `mongo:7` and
`redis:7-alpine` containers, `MONGO_CONN`/`REDIS_URL`/`JWT_SECRET` pointed
at them, then `npx playwright install --with-deps chromium` followed by
`npx playwright test`. A `playwright-report` artifact is uploaded
(`if: always()`) so a CI failure's trace/screenshots/video are
downloadable without needing to reproduce it locally first.

## Why this session couldn't run it live

This task was carried out inside a device sandbox whose network is
HTTP(S)-proxy-only against an allowlist. Confirmed directly, not assumed:

- No `mongod`, `redis-server`, or `docker` binary is installed, and there
  is no root/sudo access to install one.
- `dns.lookup()` against a MongoDB Atlas hostname fails outright
  (`EAI_AGAIN`) -- raw MongoDB wire-protocol connections have nowhere to
  go, allowlisted or not.
- `npx playwright install chromium` itself fails:
  `cdn.playwright.dev`'s browser-binary download returns `403 Connection
  blocked by network allowlist`. That means there is no way to launch
  *any* real browser in this sandbox at all -- not even a
  backend-independent "does the login page render" smoke check was
  achievable, since it still needs a real Chromium binary to drive.
- `npm install` against the public npm registry works fine, which is
  exactly why dependency installation and every static-verification step
  below succeeded.

Given that, this session's own verification stopped at the static/
enumeration tier -- real, meaningful checks that don't require a live
browser or a live database, but stop short of claiming a browser actually
ran:

- `npm install` in `e2e/` succeeds: `@playwright/test` and `mongodb`
  installed, `npx playwright --version` reports `Version 1.62.1`.
- `node --check` passes on every new `.js` file in `e2e/`.
- `npx playwright test --list` -- which only parses/imports the spec
  files, no server or browser involved -- enumerates all four journeys
  correctly (all four appear in the "Total: 4 tests in 3 files" listing).

**No live browser run happened, and none is claimed here.** This suite's
first real, green-or-red execution will be the new `e2e` CI job on this
repo's next push/PR trigger.

## Files

- `e2e/package.json`, `e2e/package-lock.json` -- the suite's own npm
  package (`@playwright/test`, `mongodb`).
- `e2e/playwright.config.js` -- test config; starts the real backend and
  real frontend dev server as `webServer` entries.
- `e2e/global-setup.js` -- seeds the one verified login user (see above).
- `e2e/fixtures/testUser.js` -- that user's fixed email/password/name.
- `e2e/tests/helpers/login.js` -- shared UI-login helper used by every
  spec that needs to start from an authenticated state.
- `e2e/tests/auth.spec.js`, `expense.spec.js`, `budget.spec.js` -- the
  four journeys themselves.
- `.github/workflows/ci.yml` -- new `e2e` job.
- `docs/testing/TST-001-risk-coverage-matrix.md` -- updated with this
  task's closure note.
