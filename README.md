# BALENISA

**BALENISA** is a full-stack personal finance platform for tracking expenses and income, managing monthly budgets, exploring spending patterns, and receiving structured financial insights.

It combines a React client, a Node/Express API, MongoDB and Redis, and a separate FastAPI machine-learning service. The project is developed in phases; this README separates working functionality from planned work.

## Contents

- [The problem BALENISA solves](#the-problem-balenisa-solves)
- [Current status](#current-status)
- [What is implemented](#what-is-implemented)
- [System overview](#system-overview)
- [End-to-end flow](#end-to-end-flow)
- [SIA V1](#sia-v1)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Run locally](#run-locally)
- [Testing](#testing)
- [Implemented versus planned](#implemented-versus-planned)
- [Known limitations](#known-limitations)

## The problem BALENISA solves

Most people can record what they spent, but not understand it. Bank apps and spreadsheets show transactions; they rarely answer *why* a month looked different, whether a budget is genuinely at risk, or which category is actually driving a change.

BALENISA closes that gap in three steps: it captures financial data with as little friction as possible (manual entry, receipt OCR, ML-suggested categories), turns that raw data into a deterministic structured **Report** covering spending, budgets, categories, trends and habits, and then — through SIA — lets the user ask plain-language questions about that report and get a grounded explanation back.

The design principle throughout: **calculations are deterministic and owned by the backend; the language layer only explains numbers that were already computed.**

## Current status

Actively developed. Core finance management, analytics, charts, receipt OCR and ML category prediction are implemented and in use. **SIA V1** — the read-only explanation layer — is implemented and shipped behind feature flags that default to off. Forecasting, risk prediction and anomaly-detection models remain planned.

## What is implemented

- Authentication with signup, email OTP verification, login, JWT-protected sessions, and password recovery
- Expense and income management
- Monthly budgets and utilization tracking
- Weekly, monthly, yearly, category, and comparison charts
- Receipt-image upload with OCR-assisted expense extraction
- ML-assisted expense-category prediction with confidence
- Correction feedback and guarded model retraining
- Deterministic financial reports covering spending, budgets, categories, trends, and habits
- Income and budget insight views
- MongoDB persistence and Redis caching
- Web/mobile push-token registration and scheduled notifications
- Responsive light and dark user interfaces
- Health, readiness, model-status, and training-run monitoring endpoints
- **SIA V1** — an optional, authenticated, read-only explanation layer over the structured Report (feature-flagged, off by default)

## System overview

```text
React frontend
      │
      │ JWT-protected REST API
      ▼
Node.js / Express backend
├── MongoDB         Finance data, reports, feedback, and training runs
├── Redis           Report and expense caching
├── Firebase/Brevo  Notifications and authentication email
├── FastAPI ML service
│     ├── Category prediction
│     ├── Template descriptions
│     └── Model retraining and activation
└── SIA             Read-only explanations over the structured Report
      └── External LLM provider (bounded, single attempt, optional)
```

The frontend communicates only with the Express backend. The backend owns authorization and coordinates persistence, analytics, notifications, ML requests, and SIA.

| Service | Responsibility |
|---|---|
| `frontend/` | All user-facing screens, client-side caching, form input. Talks only to the backend. |
| `backend/` | Authentication, ownership enforcement, all business logic, MongoDB/Redis access, the analytics/report engine, and the only caller of the ML service and of SIA's provider. |
| `ml-service/` | Expense-category prediction, template descriptions, and the model training/validation/activation lifecycle. No user accounts, no LLM. |

## End-to-end flow

**Recording data.** The user enters an expense; the frontend asks the backend's proxy for a category suggestion, which forwards to the ML service. The user accepts or overrides it. On submit the backend persists the expense, records a training-feedback document when the user corrected a live prediction, and refreshes the caches and report affected by the change.

**Producing analytics.** The backend's deterministic analyzers evaluate spending, budgets, categories, trends and habits into one structured Report document per user, stored in MongoDB and cached in Redis. Charts and insight views read from that same structured output — no model is involved in producing the numbers.

**Explaining analytics.** When SIA is enabled, a user question goes to `POST /sia/ask`. The backend authenticates the request, rate-limits it per account, validates the question, classifies it into one of the supported intents, builds a narrow context from **that authenticated user's** Report, and asks a bounded external LLM call to explain those already-computed values. The answer is returned with server-owned grounding metadata. If anything fails, the caller gets a single generic unavailable response.

See the [report flow diagrams](docs/api-workflows/report/) for the analytics engine and refresh paths, and [`docs/api-workflows/`](docs/api-workflows/) for per-endpoint documentation.

## SIA V1

SIA is an **optional, authenticated, read-only explanation layer** over structured Report analytics. It does not compute financial values — it explains values the analytics engine already produced.

**What SIA V1 does:**

- Answers questions in four supported areas: financial-health score, overall spending change, budget status, and monthly category spending
- Uses only the authenticated user's own structured Report as context
- Returns an answer plus server-owned metadata naming the Report fields the answer was grounded in
- Degrades to a single generic message on any provider, timeout, or configuration failure

**What SIA V1 explicitly does not do:**

- Does not accept a client-supplied user ID — identity comes only from the verified JWT
- Does not mutate, create, or delete any financial data
- Does not query raw expense or income collections directly; its only data source is the structured Report
- Has no conversation history, RAG, tool use, streaming, voice, or agent behavior
- Is not financial advice, and does not forecast, predict risk, or detect anomalies

SIA requires two independent feature flags — one on the backend, one on the frontend — and both must be set to the exact string `true`. With either unset, the application behaves exactly as it did before SIA existed. See the [backend README](backend/README.md#sia-v1) and [frontend README](frontend/README.md#sia-feature-flagged-entry-point-and-panel) for details.

## Tech stack

| Layer | Technologies |
|---|---|
| Frontend | React, TanStack Query, Axios, React Router, Recharts, Framer Motion |
| Backend | Node.js, Express, Mongoose, Redis, JWT, Joi, Tesseract.js, Sharp |
| ML service | FastAPI, scikit-learn, Pandas, NumPy, Joblib, PyMongo |
| Data | MongoDB, Redis |
| Notifications | Firebase Cloud Messaging, Capacitor |
| SIA | External LLM provider over HTTPS, called only from the backend |

## Repository structure

```text
.
├── frontend/       React user interface
├── backend/        Express API, analytics, persistence, SIA, and integrations
├── ml-service/     FastAPI inference and model lifecycle
└── docs/           Generated per-endpoint API workflow documentation and diagrams
```

Each service has its own documentation:

- [Frontend README](frontend/README.md)
- [Backend README](backend/README.md)
- [ML service README](ml-service/README.md)
- [API workflow documentation](docs/api-workflows/README.md)

## Run locally

Start the services in this order:

1. MongoDB and Redis
2. ML service on port `8000`
3. Backend on port `8080`
4. Frontend development server

Refer to each service README for environment variables and commands. Keep `.env` files, database credentials, JWT secrets, email keys, LLM provider keys, and Firebase service credentials out of Git.

SIA is off unless you explicitly enable it on both the backend and the frontend, and supply a provider key.

## Testing

Each service owns its own test suite and its own runner — there is no repository-wide aggregate command or coverage figure:

| Service | Runner | Command |
|---|---|---|
| Backend | Jest + Supertest | `cd backend && npm test` |
| Frontend | Jest + React Testing Library (CRA) | `cd frontend && npm test` |
| ML service | pytest | see [ML service README](ml-service/README.md#installation-and-runtest-commands) |

The backend SIA suites cover configuration, intent classification, context building, provider adapter behavior, safe logging, and the full HTTP contract of `POST /sia/ask`. All automated tests mock the LLM provider — no test contacts a real external service. ML-service integration tests refuse to run unless pointed at an isolated database whose name contains `test`.

## Implemented versus planned

| Capability | Status |
|---|---|
| Expense, income, and budget management | Implemented |
| Charts and deterministic financial analytics | Implemented |
| Receipt OCR | Implemented |
| Expense-category ML prediction | Implemented |
| Correction-driven retraining | Implemented |
| Template-based description generation | Implemented |
| SIA V1 — read-only explanations over the Report | Implemented (feature-flagged, off by default) |
| SIA conversation history, streaming, voice, tools, or agent behavior | Not implemented — no such code exists |
| Retrieval-augmented generation (RAG) over documents | Not implemented |
| Expense forecasting | Planned |
| Financial-risk prediction | Planned |
| Server-side anomaly-detection model | Planned |
| Personalized (per-user) ML models | Planned |

## Known limitations

- SIA answers only the four supported intents; anything else is declined rather than guessed at.
- SIA quality depends on the user having enough report data — thin data returns an explicit "not enough data" answer, not an invented explanation.
- Backend-to-ML calls do not currently use service-to-service authentication.
- Corrections made during expense editing do not enter the ML feedback dataset.
- Expense and ML-feedback writes are not currently enclosed in one MongoDB transaction.
- ML retraining is global rather than user-personalized.
- The ML description generator is template-based, not model-driven.
- The frontend has no URL-based routing, so screens are not deep-linkable.

## Project direction

BALENISA is intended to grow as a reliable personal finance system, not as a collection of disconnected AI features. Planned work extends the deterministic analytics engine with forecasting, risk and anomaly models first — and only then exposes those structured results through SIA, on the same grounded, read-only terms as SIA V1.
