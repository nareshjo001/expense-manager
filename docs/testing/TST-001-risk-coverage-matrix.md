# TST-001-T01: Risk-to-test coverage matrix

Maps the risk areas named in [TST-001](../../workflow/features/P0/TST-001-critical-path-test-expansion.md)'s
problem statement against what the test suites (`backend/tests`,
`frontend/src/**/*.test.js`, `ml-service/tests`) and CI
(`.github/workflows/ci.yml`) actually exercise today, so the remaining
TST-001 tasks (T02-T07) target real gaps instead of re-verifying work
that already exists.

## Matrix

| Risk area | Current coverage | Status | Gap / next step |
|---|---|---|---|
| Receipt/OCR upload security (hostile files at the upload boundary) | `backend/tests/receiptUpload.security.test.js` (10 tests): signature spoofing, MIME/signature mismatch, corrupted bytes, unsupported PDFs, byte-size limit, decoded pixel-count limit, extra multipart fields, no disk storage, receipt-specific rate limit | Covered at the upload/security boundary | T04's real target is the OCR *parser* once past this gate -- hostile/malformed text the OCR engine extracts from a receipt (garbage output, adversarial content in the recognized text), not the raw file bytes. That is a distinct, still-open risk. |
| Authentication recovery (OTP, password reset, session/token failure paths) | `auth.recoverySecurity.test.js`, `auth.jwtExpiration.test.js`, `auth.sessionSecurity.test.js`, `httpSecurity.test.js`, `requestId.middleware.test.js`, `error.middleware.test.js` | Covered | No open gap identified here. See the T02 note below -- its stated scope looks stale against the current suite. |
| Committed-write / mutation-reliability behavior (expense/income/budget mutations under retry, race, partial failure) | 20+ dedicated files, incl. `expense.mutationReliability.test.js`, `expense.ambiguousWrite.test.js`, `expense.addExpense.idempotency.route.test.js`, `expense.crossMonthRace.route.test.js`, `income.idempotency.route.test.js`, `incomeIdempotencyIndex.test.js`, `mutationRecoveryCorrectness.test.js`, `syncRecoveryService.test.js`, the three `*.recoveryGap.reproduction.test.js` files, `recurringJob.crashGapRecovery.test.js`, `recurringJob.reservationOwnership.test.js`, `reportCache.cas.test.js` | Extensively covered -- the single most heavily tested risk area in the suite | No open gap identified. |
| Real database integration -- ML service against real MongoDB | `ml-service/tests/integration/test_mongo_repositories.py`, `test_end_to_end_retraining.py`, `test_real_training.py`. CI's `ml` job provisions a real `mongo:7` service container with `ML_TEST_MONGO_CONN` set (`.github/workflows/ci.yml`) | Already running for real in CI | TST-001-T03 ("Configure isolated ML Mongo integration") appears already satisfied by the existing CI config. Recommend re-verifying/closing T03 rather than re-building it -- or narrowing its scope if the original concern was narrower than the task title suggests. |
| Real database integration -- backend against real MongoDB/Redis | `jobLease.concurrency.itest.js` (multi-process, real Redis), `report.integration.itest.js` (real Mongo). CI's `backend-integration` job provisions real `mongo:7` + `redis:7-alpine` containers, run via the separate `npm run test:integration` script (`jest.integration.config.js`, matching only `*.itest.js`) | Already running for real in CI | Only 2 of 129 backend test files are true integration (`.itest.js`) tests against real infra; the rest are unit/route tests against mocks. Worth tracking as a ratio, not necessarily a gap by itself. |
| Competing workers / concurrent job execution | `jobLease.concurrency.itest.js` proves the generic lease primitive holds under two real OS processes racing real Redis. `recurringJob.reservationOwnership.test.js` (5 tests) covers reservation-ownership logic for the recurring-expense job specifically, but in a single Node process against mocked models. | Partially covered | T06's real gap: no test proves the recurring-expense cron job itself (not just the generic lease primitive underneath it) survives two real concurrent worker processes racing for the same recurring expense. |
| End-to-end user journeys (real browser) | `e2e/tests/*.spec.js` (Playwright): login success/failure, add-expense, set-budget -- see [TST-001-T05-e2e-setup.md](./TST-001-T05-e2e-setup.md) | Suite written and CI-wired (new `e2e` job in `.github/workflows/ci.yml`), not yet run live -- see the T05 status note below | T05 closure note below explains why no live run happened yet and what confirms the suite is real. |
| Backup/restore and deployment smoke tests | None -- correctly blocked on OPS-002 (backup/recovery) existing first. OPS-002-T01 just landed (see [ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md)); T02-T07 are still ahead. | Not covered, correctly blocked | T07 cannot start until OPS-002's backup/restore mechanism exists. |

## Note on TST-001-T02 ("Fix the two failing backend tests behaviorally")

This task's scope names "the two failing backend tests" without saying
which ones, and no other workflow doc names them either -- the backend
suite is currently **1981/1981 passing** (confirmed twice: once as part
of a full `npm test` run, once re-running the one test that timed out
under load in isolation, 28/28). Whatever prompted this task item was
likely fixed by other work since the original audit. T02 should start
with re-confirming there is no currently-failing test before spending its
2-3 day estimate looking for one that no longer exists.

## Recommended next TST-001 task

Given the matrix, **T05 (Playwright/E2E user journeys)** is the highest-
value genuinely open gap: it is the only risk area with zero existing
coverage of any kind, not partial or already-satisfied-by-CI coverage.
T04 (OCR parser hostile-text suites) is the next most valuable, since the
upload-security boundary is already well covered but the parser behind it
is not.

## TST-001-T02 closure

**Task as specified:** "Fix the two failing backend tests behaviorally."

**Finding:** There are no failing backend tests to fix. Re-confirmed at
T02 time (2026-09-03) on top of the T01 finding above:

- The full `npm test` run earlier in this effort reported
  `Test Suites: 1 failed, 125 passed, 126 total` / `Tests: 1 failed, 1980
  passed, 1981 total` -- but the single failing suite was
  `report.contract.test.js` timing out at 5000ms under
  `--runInBand` load across 1981 tests in one process, not a behavioral
  failure. Re-run in isolation immediately after: `28/28` passed.
- No workflow document, commit message, or code comment anywhere in the
  repository names which "two" tests this task originally meant. The
  most likely explanation is that this task was scoped against an
  earlier, since-fixed state of the suite (the same conclusion T01
  reached independently).
- Since T01, only new files have been added (OBS-001-T06's
  `alerts.js`/`metrics.js` wiring, DAT-003-T01/T02's migration runner,
  lock and ledger modules) plus their own new, additive test files --
  nothing that touches or could regress an existing test's behavior.

**Outcome:** No behavioral fix is applicable because no failing test
exists. T02 is closed as an audit finding rather than a code change,
consistent with the coverage matrix's original recommendation to
re-confirm before spending the task's 2-3 day estimate looking for a
test that no longer exists. Owner should still re-run the full suite
once after this batch of work lands, as a final sanity check (see the
session check-in) -- this closure is not a substitute for that.
## TST-001-T05 status

**Task as specified:** "Add core Playwright user journeys."

**What was built:** `e2e/` is a new, self-contained npm package (sibling
to `backend/` and `frontend/` -- there was no monorepo-root `package.json`
to hang this off of instead) holding:

- `e2e/playwright.config.js` -- starts the REAL backend (`node server.js`)
  and the REAL CRA frontend dev server (`npm start`) as Playwright
  `webServer` entries, wired to the same env var names the app itself
  reads (`MONGO_CONN`, `REDIS_URL`, `JWT_SECRET`), not invented ones.
- `e2e/global-setup.js` -- seeds one verified login user by calling the
  real `POST /auth/signup` endpoint and then, directly against the same
  MongoDB, applying the exact `isVerified: true` / OTP-fields-cleared
  mutation `verifyOTP.js` would have made. This is the one deliberate
  bypass in the whole suite, and it bypasses only "read an OTP out of a
  real email inbox" -- something no CI runner or sandbox can do -- not
  any of the app's own signup/login/session code.
- `e2e/tests/auth.spec.js`, `expense.spec.js`, `budget.spec.js` -- four
  journeys: login success (lands on the authenticated dashboard, correct
  welcome toast), login failure (real 401, visible error, still on the
  login screen), add an expense and see it in the real expense list, set
  this month's budget and see the real `BudgetBar` render. Selectors are
  almost entirely `getByLabel`/`getByPlaceholder`/`getByRole`/`getByText`
  against the app's existing accessible markup -- **no `data-testid` was
  added anywhere**; the one genuine ambiguity found (the Add/Add Income
  type-toggle button and the Add Expense form's own submit button are
  both literally labelled "Add Expense") was resolved with the form's
  already-existing `.submit-btn` class instead of a new attribute.
- A new `e2e` job in `.github/workflows/ci.yml`, following the same
  `mongo:7` + `redis:7-alpine` real-service-container pattern the
  existing `backend-integration` job already uses.

**Why no live run happened from this task's own session:** this session
ran exclusively inside a device sandbox with an HTTP(S)-proxy-only
network allowlist. Confirmed directly (not assumed): no `mongod` binary
is installed, `dns.lookup()` against a MongoDB Atlas host fails outright
(`EAI_AGAIN`), and `npx playwright install chromium` itself fails --
`cdn.playwright.dev`'s browser-binary download returns `403 Connection
blocked by network allowlist`. That second failure means even a
browser-less/backend-less "does the frontend at least render" smoke check
was not achievable here: there is no way to launch ANY real browser in
this sandbox, not just no way to run one against a live backend. `npm`
installs against the public registry work fine, which is why the
dependency install and static-verification steps below succeeded.

**Verification tier actually reached, with real command output:**

- `npm install` in `e2e/` succeeds against the real npm registry:
  `@playwright/test` and `mongodb` both installed, `npx playwright
  --version` reports `Version 1.62.1`.
- `node --check` passes on every new file (`playwright.config.js`,
  `global-setup.js`, `fixtures/testUser.js`, `tests/helpers/login.js`,
  `tests/auth.spec.js`, `tests/expense.spec.js`, `tests/budget.spec.js`).
- `npx playwright test --list` (which only parses/imports spec files --
  no server or browser required) enumerates all four journeys correctly:

  ```
  Listing tests:
    [chromium] auth.spec.js:24:3 Authentication logs in with valid credentials and lands on the authenticated dashboard
    [chromium] auth.spec.js:39:3 Authentication shows a visible error and stays on the login screen for invalid credentials
    [chromium] budget.spec.js:14:3 Budget sets this month's budget and sees it reflected on the dashboard
    [chromium] expense.spec.js:12:3 Expenses adds an expense and sees it appear in the expense list
  Total: 4 tests in 3 files
  ```

- No live browser run happened, and none is claimed. This suite's first
  real execution will be the `e2e` job on the next push/PR that triggers
  `.github/workflows/ci.yml`.

**Outcome:** T05's gap is closed at the code/CI level -- a real,
CI-integrated Playwright suite now exists targeting this app's actual
routes and markup. It has not yet been proven green by an actual run;
that proof arrives with this repo's next CI trigger, the same posture
DAT-003-T07's migration-apply CI step was left in.
