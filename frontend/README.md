# 🖥️ BALENISA Frontend

The React client for BALENISA: the authenticated finance workspace for expenses, income, budgets, charts, monthly insights, receipt scanning, and SIA.

## ✨ Capabilities

- 🔐 Login, signup, OTP verification, and password recovery
- 💸 Expense CRUD, filters, lazy rendering, and receipt-scan prefills
- 💰 Income and budget management
- 📊 Line, bar, and pie visualizations
- 📈 Report-driven budget, trend, anomaly, forecast, and income insights
- 💬 SIA sessions, safe Markdown answers, source disclosure, optional voice capture, and contextual entry points
- 🔔 Web/native push registration and 🌗 light/dark themes

## 🧱 Client architecture

```text
App shell → feature components → query/mutation hooks → api clients → Express backend
                         └──────── SIA conversation + launcher ────────┘
```

`src/api/axios.js` is the shared authenticated client. It attaches only an in-memory access token, refreshes it through a rotated HttpOnly session cookie, and centrally handles authentication, rate-limit, and conflict responses. The browser never calls the ML service or LLM providers directly.

## 📁 Key folders

| Path | Role |
|---|---|
| `src/components/expensesHandling` | Expenses, income, and budgets |
| `src/components/monthlyInsights` | Report-driven insight cards |
| `src/components/charts` | Spending visualizations |
| `src/components/sia` | Launcher, panel, voice, history, and answer rendering |
| `src/hooks/queries` / `mutations` | TanStack Query reads and actions |
| `src/api` | Backend resource clients |
| `src/query` | Shared query client and keys |

## 🚀 Run locally

```bash
npm install
npm start
```

## 🔧 Environment

```env
REACT_APP_BACKEND_URL=http://localhost:8080
REACT_APP_SIA_ENABLED=true
```

`REACT_APP_SIA_ENABLED` controls only launcher visibility; the backend is the authoritative availability and security gate. CRA embeds `REACT_APP_*` values at build time.

## 🔒 Production deployment

The Vercel project Root Directory must be `frontend`. Set this production variable in Vercel before rebuilding:

```env
REACT_APP_BACKEND_URL=/backend
```

`vercel.json` proxies `/backend/*` to Render so refresh cookies remain first-party to `balensia.vercel.app`; do not point the production browser directly at Render. The session design uses an HttpOnly refresh cookie, a readable CSRF cookie/header pair, and a memory-only access token. Keep the CSP report-only until a production browser check confirms Firebase messaging, Google Fonts, and every API path work as expected.

## 🧠 SIA UI behavior

- Available on finance, analytics, and chart surfaces—not expense entry.
- Uses conversation/session APIs through `useSiaConversation`.
- Renders provider text through a restricted Markdown renderer; raw HTML is never injected.
- Shows source/period metadata supplied by the backend.
- Shows voice controls only when the backend advertises voice capability.

## 🧪 Commands

```bash
npm test -- --watchAll=false
npm run build
```

## 🔗 Related docs

[Project overview](../README.md) · [Backend](../backend/README.md) · [ML service](../ml-service/README.md)
