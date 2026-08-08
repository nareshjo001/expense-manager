# BALENISA — Backend

The Express REST API for BALENISA. It owns all business logic and MongoDB access, serves
the React frontend, and is the only service that talks to the ML service and to SIA's LLM
provider.

See the [root README](../README.md) for the overall system and the
[frontend](../frontend/README.md) / [ML service](../ml-service/README.md) READMEs for
the other two services.

## Contents

- [Responsibilities](#responsibilities)
- [Architecture and important modules](#architecture-and-important-modules)
- [Authentication and authorization](#authentication-and-authorization)
- [Core resources](#expenses-income-budgets-reports-notifications-device-tokens)
- [Redis / cache behavior](#redis--cache-behavior)
- [Backend-to-ML integration](#backend-to-ml-integration)
- [SIA V1](#sia-v1)
- [Environment variables](#environment-variables)
- [Installation and run commands](#installation-and-run-commands)
- [Implemented versus planned](#implemented-versus-planned)

## Responsibilities

- Authentication (signup, login, OTP verification, password reset) and session issuance
- Expense, income, and budget CRUD, with ownership enforced on every query
- Report/analytics generation and caching
- Proxying and translating the frontend's ML-prediction calls to the ML service, and
  calling the ML service for description generation and retraining
- Receipt OCR (bill scanning)
- Push-notification device registration and delivery
- Scheduled jobs for recurring expenses, ML retraining triggers, and push retries
- Serving SIA: read-only, grounded explanations of a user's own structured Report

## Architecture and important modules

```
backend/
├── server.js         Process bootstrap: env, DB/Redis connect, listen, cron requires
├── app.js            Express app, middleware, and all router mounts
├── Routes/            One router file per resource area
├── Controllers/        One handler module per resource area (incl. SiaControllers/)
├── Middlewares/        JWT verification, error handling, upload handling
├── Services/           Business logic used by controllers (auth, budget, chart, insights, push, report)
├── analytics/          Rule-based report/insight generation
├── sia/                SIA config, intent classification, context building, provider adapter, formatting, safe logging
├── models/              Mongoose models outside the main schema file (DeviceToken, Notification, RecurringExpense, Report)
├── config/              DB connection, Redis client, Firebase Admin, the main Schemas.js
├── cache/               Redis-backed report cache
├── cron/                Scheduled jobs
├── tests/               Jest + Supertest suites
└── utils/                Shared helpers (rate limiter, expense cache)
```

Route mounts (from `app.js`): `/auth`, `/api` (budget + device-token + recurring toggle),
`/expense`, `/bills`, `/ml` (ML proxy), `/report`, `/chart`, `/income`, `/sia`, plus a
bare `GET /` and `GET /ping` declared directly on the app. Every mount except `/auth`
runs behind a shared `apiLimiter` (150 requests / 15 minutes); `/auth` has its own
stricter limiter, and `/sia` adds a second, per-account limiter of its own.

## Authentication and authorization

- JWT-based sessions issued on login; the token carries no expiry claim
- Password hashing with bcrypt
- A `verifyToken` middleware gates every non-`/auth` route and sets `req.userId` from
  the verified token
- Ownership is enforced in the database query itself for every resource (`{ userId,
  _id }` filters) — there is no separate authorization layer beyond that
- No refresh-token flow exists; a session is exactly one JWT until it expires or the
  user logs out client-side

## Expenses, income, budgets, reports, notifications, device tokens

- **Expenses** — create/edit/delete, list by last-week/category/custom date range, mark
  recurring. Create is the only mutation with request-body validation (Joi); update has
  none.
- **Income** — create/edit/delete/list, plus two lightweight insight-summary endpoints.
- **Budgets** — get/set/update a monthly budget; budgets are automatically recalculated
  when an expense's amount or date changes.
- **Reports** — one cached report document per user, combining expense, budget, and
  income data; refreshed synchronously on the mutations that affect it.
- **Notifications / device tokens** — `POST /api/device-token` registers a Firebase
  Cloud Messaging token (web or mobile) for a user, enforcing one owner per token. Push
  delivery itself (`Services/push.service.js`) has no HTTP endpoint — it's triggered
  from the recurring-expense cron and retried by a separate cron.
- **Bills (OCR)** — one endpoint uploads a receipt, runs it through Sharp (preprocessing)
  and Tesseract.js (OCR) in-process, and returns three best-effort guesses. Nothing is
  persisted or stored by this endpoint; the temp files are deleted before the response is
  sent.

### Report generation and caching

`Services/reportService.js` is the single entry point for a user's Report. `getReport`
checks the Redis cache first, falls back to the stored `FinancialReport` document, and
only if neither exists runs the deterministic analytics pipeline
(`analytics/generateReport.js`), upserting and caching the result. Mutations that
invalidate a report trigger a refresh through the same service — there is no second,
parallel data path, and SIA reuses this service unchanged.

## Redis / cache behavior

Redis is used (see `config/redis.js`, `cache/reportCache.js`, `utils/expenseCache.js`)
for two things: a per-user report cache (1-hour TTL) and short-lived caches on several
expense/chart read endpoints (5-minute TTL). Cache keys are cleared on the mutations that
would make them stale. Redis failures are caught and logged, not surfaced to the caller —
a failed cache read degrades to a cache miss, and a failed cache write simply leaves
nothing cached.

## Backend-to-ML integration

The backend makes four confirmed calls into the ML service, all plain HTTP via `axios`,
**none of them carrying any service-to-service authentication**:

| Call | Trigger | Timeout |
|---|---|---|
| `POST /predict-category` | Proxied from the frontend's debounced prediction request | 5000ms |
| `POST /generate-description` | Expense creation, only if the description field was left blank | 5000ms |
| `POST /retrain-model` | Daily cron, only once ≥100 pending corrections exist | not set |
| `GET /` | The backend's own `/ping` health-check route | not set |

Prediction is advisory only — the backend's own expense-creation logic never calls the
ML service itself; only the frontend does, before submission. If the ML service is
unreachable, slow, or errors, expense creation is unaffected: the description falls back
to an empty string, and the category field is simply whatever the user typed or left
blank.

## ML feedback persistence and retraining trigger

When a user corrects a predicted category **at expense-creation time**, the backend
writes an `MlFeedbackModel` document (status `pending`) immediately before saving the new
expense — as two sequential, non-transactional writes. If the feedback write fails
(validation error, duplicate key, transient DB error), the expense is **not** saved
either, because that write has no dedicated error handling the way the
description-generation call does.

**Correcting a category later, when editing an expense, never produces feedback** — the
edit controller has no reference to the feedback model at all. Only creation-time
corrections train the model.

## Scheduled jobs

| Job | File | Schedule | Behavior |
|---|---|---|---|
| Recurring expenses | `cron/recurringJob.js` | Daily at 20:30 server time | Creates due expenses from `RecurringExpense` schedules |
| ML retraining trigger | `cron/feedbackCollector.js` | Daily at 20:30 server time | Counts `pending` feedback documents; calls `POST /retrain-model` only if the count is ≥100 |
| Push retry | `cron/retryPush.js` | Every 15 minutes | Retries notifications with `pushStatus: "failed"` and fewer than 3 prior retries |

A fourth cron file, `cron/insightsPush.js`, exists in the repository but is **not**
required at startup and does not currently run.

Retraining acceptance from `POST /retrain-model` is asynchronous — the response only
means the run was accepted or is already in progress, never that training, validation,
or activation has completed.

## SIA V1

SIA exposes exactly one endpoint, `POST /sia/ask`. It is a **read-only explanation
layer**: it never writes financial data, never reads raw expense or income collections,
and never receives a user ID from the client.

### Runtime path

```text
POST /sia/ask
→ authentication          verifyToken sets req.userId from the verified JWT
→ per-user rate limit     siaLimiter, 20 requests / 15 minutes, keyed on req.userId
→ validation              question must be a non-blank string, ≤500 characters after trim
→ backend feature flag    SIA_ENABLED must be exactly "true"
→ intent classification   deterministic pattern matching; unrecognized questions are declined
→ user-isolated context   reportService.getReport(req.userId) → narrow, intent-specific fields
→ bounded provider call   one attempt, no retry, bounded by SIA_LLM_TIMEOUT_MS
→ sanitized response      server-owned answer/intent/grounding metadata
```

Each step is a hard gate: a request that fails validation never reaches classification, a
request that fails classification never reaches the Report, and a request with no usable
Report data never reaches the provider.

### Supported intents

| Intent | What the user is asking |
|---|---|
| `HEALTH_EXPLANATION` | Why their financial-health score or risk level is what it is |
| `SPENDING_CHANGE_EXPLANATION` | Why overall spending rose, fell, or compares differently to a previous period |
| `BUDGET_STATUS_EXPLANATION` | Why their budget is on track, over, under, or projected to be exceeded |
| `CATEGORY_SPENDING_EXPLANATION` | Why a category ranks, concentrates, or changed the way it did this month |

Classification is conservative by design. A question that is ambiguous, spans two
domains, requests advice, asks for a forecast, or asks SIA to change data is **declined**
rather than routed to a best guess.

### Response contracts

| Situation | Status | Body |
|---|---|---|
| Grounded answer | `200` | `{ success: true, answer, intent, basedOn: [ …Report field paths ] }` |
| Not enough report data | `200` | `{ success: true, answer: <fixed per-intent message>, intent, basedOn: ["none"] }` |
| Missing/blank/non-string question | `400` | `{ success: false, message: "question is required" }` |
| Question over 500 characters | `400` | `{ success: false, message: "question must be 500 characters or fewer" }` |
| Unsupported or ambiguous intent | `422` | `{ success: false, message: "Question not recognized for the intents SIA currently supports." }` |
| Rate limit exceeded | `429` | `{ success: false, message: "Too many requests. Please try again later." }` |
| Feature disabled, context failure, provider failure, or unusable provider result | `503` | `{ success: false, message: "SIA is temporarily unavailable." }` |

`intent` and `basedOn` are always constructed by the server from a fixed allowlist. A
provider response cannot override, inject, or influence either field.

The no-data case is deliberately a **success**, not an error: SIA truthfully says it does
not have enough data rather than inventing an explanation, and no provider call is made.

### Provider handling and safe logging

`sia/llmService.js` makes exactly one outbound request per ask, bounded by
`SIA_LLM_TIMEOUT_MS`, with **no retry**. Every distinct failure mode — timeout, network
error, HTTP error, malformed or incomplete response, empty output, missing model, missing
key — is normalized into a typed internal error and then collapsed into the single
generic `503` above. No provider message, status body, prompt, question, context, or API
key is ever included in a response.

`sia/safeLogger.js` emits a structured log line on provider success and failure. It is a
strict allowlist: only the event name, provider name, error code, and latency are ever
written. Questions, answers, financial context, user IDs, tokens, and raw provider
payloads are structurally incapable of being logged, and a logging failure never alters
the API response.

### Disabling SIA

Set `SIA_ENABLED` to anything other than the exact string `true` (or leave it unset). The
route stays mounted but returns `503` immediately, before classification, the Report, or
the provider are touched. No other endpoint's behavior changes.

## API organization

Routes are grouped one file per resource under `Routes/`, each delegating to a
controller module of the same name. Full per-endpoint documentation (request/response
shapes, exact status codes, and edge cases) lives in
[`docs/api-workflows/`](../docs/api-workflows/README.md), not in this README — see that
folder if you need endpoint-level detail rather than the module-level summary above.

## Environment variables

Values below are placeholders. No real secret is included here or in any tracked file.

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_CONN` | Yes | MongoDB connection string |
| `JWT_SECRET` | Yes | Signing secret for session tokens |
| `REDIS_URL` | Yes | Redis connection string |
| `ML_ROUTE` | Yes | Base URL of the ML service |
| `BREVO_API_KEY` | Yes | Transactional email provider key, used for OTP/reset emails |
| `PORT` | No | Listen port (defaults to `8080`) |
| `SIA_ENABLED` | No | `true` enables SIA; any other value or unset disables it (default: disabled) |
| `SIA_LLM_PROVIDER` | Only if SIA is enabled | Provider identifier; `openai` is the implemented adapter |
| `SIA_LLM_MODEL` | Only if SIA is enabled | Model identifier passed to the provider; no default is assumed |
| `SIA_LLM_TIMEOUT_MS` | No | Per-request provider timeout in ms (default `8000`) |
| `OPENAI_API_KEY` | Only if SIA is enabled with the OpenAI adapter | Provider API key, read only inside the provider adapter |

## Installation and run commands

```bash
npm install
npm run dev     # nodemon server.js (auto-restart)
npm start       # node server.js
npm test        # Jest + Supertest
```

Listens on `process.env.PORT`, defaulting to `8080` if unset.

## Testing

Suites live in `tests/`. Alongside the analytics and report suites, SIA has dedicated
coverage for configuration parsing, intent classification, context building and
isolation, the provider adapter's request shape and failure normalization, safe logging,
and the complete HTTP contract of `POST /sia/ask` across every response code above.

Every SIA test mocks the provider — no test issues a real LLM or network request.

## Current limitations

- **No service-to-service authentication** on any backend→ML call — confirmed absent at
  every call site.
- **A feedback-write failure can block expense creation.** The feedback write has no
  dedicated error handling, unlike the description-generation call, so a failure there
  propagates and the expense is never saved even though the expense data itself was
  valid.
- **Feedback and expense writes are non-transactional** — a crash between the two writes
  can leave an orphaned feedback document with no corresponding expense.
- **Edit-time corrections never train the model** — confirmed absent from the edit
  controller.
- Update, delete, and the recurring-toggle mutation have no request-body validation
  middleware (create is the only validated mutation).
- No refresh-token flow; JWTs carry no expiry claim.
- `apiLimiter` is applied at the app-level mount, before per-route authentication runs,
  so it is keyed by IP rather than by account. SIA's own `siaLimiter` runs after
  authentication and is correctly keyed per account.
- SIA supports four intents only; everything else is declined by design.

## Implemented versus planned

| Capability | Status |
|---|---|
| Auth, expense/income/budget CRUD, ownership enforcement | Implemented |
| Deterministic analytics/report engine with Redis caching | Implemented |
| Receipt OCR, ML prediction proxy, retraining trigger | Implemented |
| SIA V1 — four intents, read-only, feature-flagged | Implemented |
| SIA safe structured logging and bounded provider calls | Implemented |
| SIA conversation history, streaming, tools, RAG, or agent behavior | Not implemented — no such code exists |
| SIA write access to financial data | Not implemented, and out of scope by design |
| Service-to-service authentication for backend→ML calls | Planned |
| Transactional expense + feedback writes | Planned |
| Request validation on update/delete/recurring mutations | Planned |
| Edit-time ML feedback capture | Planned |
| Forecasting, risk, and anomaly analytics | Planned |
