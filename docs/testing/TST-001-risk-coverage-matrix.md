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
| End-to-end user journeys (real browser) | None found -- no Playwright, Cypress, or `e2e`/`cypress` directory exists anywhere in `frontend/` | Not covered | T05 is a genuine, total gap -- the highest-value remaining TST-001 task after this one. |
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
