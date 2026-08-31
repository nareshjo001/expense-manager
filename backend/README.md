# ⚙️ BALENISA Backend

The Express API and financial core of BALENISA. It owns identity, authorization, persistence, report generation, cache consistency, SIA orchestration, OCR, and communication with the ML service.

## 🧩 Architecture

```mermaid
flowchart TD
  Client[React client] --> API[Express routes + middleware]
  API --> Finance[Expenses · income · budgets]
  Finance --> Reports[Deterministic analytics/report engine]
  API --> Mongo[(MongoDB)]
  API --> Redis[(Redis)]
  API --> ML[FastAPI ML service]
  API --> SIA[SIA semantic pipeline]
  SIA --> Provider[Optional OpenAI / Gemini / Groq]
```

## ✨ Responsibilities

- 🔐 Auth, OTP/password recovery, and JWT ownership enforcement
- 💸 Expense, income, recurring-expense, bill, and budget operations
- 📊 Charts and deterministic financial reports
- 🔄 Cache invalidation, report refresh, and recovery-safe mutation handling
- 🧾 OCR receipt extraction and ML-category proxy calls
- 🔔 Device registration, push delivery, retries, and scheduled jobs
- 💬 SIA status, sessions, questions, voice transcription, and grounded answers

## 🗂️ Important modules

| Path | Purpose |
|---|---|
| `Routes/` + `Controllers/` | HTTP contracts and request handling |
| `Services/` | Business operations, report lifecycle, synchronization, notifications |
| `analytics/` | Data aggregation and deterministic analyzers |
| `models/` | Mongoose schemas for finance, reports, SIA, and operations |
| `sia/` | Plans, semantic routing, facts, grounding, sessions, voice, providers |
| `cron/` | Recurring expenses, notification retries, and feedback collection |

## 💬 SIA execution path

1. `POST /sia/ask` authenticates and rate-limits the caller.
2. Deterministic intents are handled directly; otherwise a semantic router emits a closed, validated plan.
3. Only allowlisted aggregates scoped to `req.userId` are retrieved.
4. Direct questions return deterministic answers; explanation requests use bounded synthesis over a minimal fact set.
5. Grounding is validated before a response is returned. Sessions and idempotency make history/retries safe.

SIA is read-only: it cannot change budgets, expenses, income, or user data.

## 🔌 API groups

| Prefix | Area |
|---|---|
| `/auth` | Authentication and recovery |
| `/expense`, `/income`, `/bills`, `/api` | Finance operations |
| `/chart`, `/report` | Analytics/report data |
| `/ml` | Backend-proxied ML features |
| `/sia` | Assistant status, sessions, questions, transcription |

## 🚀 Run locally

```bash
npm install
npm run dev
```

## 🔐 Environment essentials

```env
MONGO_CONN=mongodb://...
REDIS_URL=redis://...
JWT_SECRET=replace-with-a-secret
ML_ROUTE=http://localhost:8000
PORT=8080
```

For SIA, set `SIA_ENABLED=true`, `SIA_LLM_PROVIDER`, `SIA_LLM_MODEL`, and the matching provider key. Voice input is independently enabled with `SIA_VOICE_ENABLED=true` and its STT settings.

## 🧪 Testing

```bash
npm test
npm run test:integration
```

The Jest suite covers API behavior, recovery/idempotency, analytics, report contracts, SIA safety/grounding, and ML proxy contracts. Provider calls are mocked.

## 🔗 Related docs

[Project overview](../README.md) · [Frontend](../frontend/README.md) · [ML service](../ml-service/README.md) · [API workflows](../docs/api-workflows/README.md)
