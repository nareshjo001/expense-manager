# BALENISA — Backend

The Express REST API for BALENISA. It owns all business logic and MongoDB access, serves
the React frontend, and is the only service that talks to the ML service.

See the [root README](../README.md) for the overall system and the
[frontend](../frontend/README.md) / [ML service](../ml-service/README.md) READMEs for
the other two services.

## Responsibilities

- Authentication (signup, login, OTP verification, password reset) and session issuance
- Expense, income, and budget CRUD, with ownership enforced on every query
- Report/analytics generation and caching
- Proxying and translating the frontend's ML-prediction calls to the ML service, and
  calling the ML service for description generation and retraining
- Receipt OCR (bill scanning)
- Push-notification device registration and delivery
- Scheduled jobs for recurring expenses, ML retraining triggers, and push retries

## Architecture and important modules

```
backend/
├── server.js         Express app, middleware and router mounts, cron requires
├── Routes/            One router file per resource area
├── Controllers/        One handler module per resource area
├── Middlewares/        JWT verification, error handling, upload handling
├── Services/           Business logic used by controllers (auth, budget, chart, insights, push, report)
├── analytics/          Rule-based report/insight generation
├── models/              Mongoose models outside the main schema file (DeviceToken, Notification, RecurringExpense, Report)
├── config/              DB connection, Redis client, Firebase Admin, the main Schemas.js
├── cache/               Redis-backed report cache
├── cron/                Scheduled jobs
└── utils/                Shared helpers (rate limiter, expense cache)
```

Route mounts (from `server.js`): `/auth`, `/api` (budget + device-token + recurring
toggle), `/expense`, `/bills`, `/ml` (ML proxy), `/report`, `/chart`, `/income`, plus a
bare `GET /` and `GET /ping` declared directly on the app. Every mount except `/auth`
runs behind a shared `apiLimiter` (150 requests / 15 minutes); `/auth` has its own
stricter limiter.

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
required by `server.js` and does not currently run.

Retraining acceptance from `POST /retrain-model` is asynchronous — the response only
means the run was accepted or is already in progress, never that training, validation,
or activation has completed.

## API organization

Routes are grouped one file per resource under `Routes/`, each delegating to a
controller module of the same name. Full per-endpoint documentation (request/response
shapes, exact status codes, and edge cases) lives in `docs/api-workflows/`, not in this
README — see that folder if you need endpoint-level detail rather than the module-level
summary above.

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGO_CONN` | MongoDB connection string |
| `JWT_SECRET` | Signing secret for session tokens |
| `REDIS_URL` | Redis connection string |
| `ML_ROUTE` | Base URL of the ML service |
| `BREVO_API_KEY` | Transactional email provider key, used for OTP/reset emails |

No secret values are included here or anywhere in this repository's tracked files.

## Installation and run commands

```bash
npm install
npm run dev     # nodemon server.js (auto-restart)
npm start       # node server.js
```

Listens on `process.env.PORT`, defaulting to `8080` if unset.

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
- `apiLimiter` is keyed by IP (it runs before authentication on some routes), not
  consistently by account.

## Planned backend work

- Authenticate backend→ML service calls.
- Isolate the feedback write's failure mode from expense persistence, or wrap both in a
  transaction.
- Extend request validation to update/delete/recurring mutations.
- Extend the ML feedback loop to edit-time corrections.
