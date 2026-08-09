# BALENISA — Frontend

The React single-page application for BALENISA: the UI for authentication, expense and
income entry, budgets, charts, receipt scanning, and the SIA explanation panel. It talks
only to the BALENISA backend — it never calls the ML service or any LLM provider
directly.

See the [root README](../README.md) for the overall system and the
[backend](../backend/README.md) / [ML service](../ml-service/README.md) READMEs for the
other two services.

## Contents

- [Responsibilities](#responsibilities)
- [Implemented screens / modules](#implemented-screens--modules)
- [Routing and authentication behavior](#routing-and-authentication-behavior)
- [API communication](#api-communication)
- [Server-state management and caching](#server-state-management-and-caching)
- [Expense creation and ML prediction workflow](#expense-creation-and-ml-prediction-workflow)
- [SIA: feature-flagged entry point and panel](#sia-feature-flagged-entry-point-and-panel)
- [Environment variables](#environment-variables)
- [Installation and commands](#installation-and-commands)
- [Implemented versus planned](#implemented-versus-planned)

## Responsibilities

- Render the authenticated app shell and all user-facing screens
- Collect and validate form input client-side before sending it to the backend
- Own client-side server-state caching (TanStack Query) so repeat views don't always
  re-fetch
- Trigger the ML category-prediction call while the user types an expense name, and let
  the user override the suggestion at any time
- Present SIA's read-only explanations when the feature is enabled
- Register the device for push notifications

## Implemented screens / modules

| Area | What it does |
|---|---|
| Login / Signup | Email+password auth, OTP verification, forgot/reset password |
| Landing page | Authenticated home — expense list, filters, budget summary |
| Add/Edit Expense | Manual entry, ML-assisted category suggestion, optional bill scan prefill, edit an existing expense |
| Bill scanner | Upload a receipt photo; OCR-extracted name/amount/date prefill the expense form (still editable, not auto-saved) |
| Income handling | Add/edit/delete income entries |
| Charts | Line, bar, and pie charts for spending trends and category breakdowns |
| Insights / monthly insights | Rule-based summary cards computed from expense/chart data — not a separate AI feature |
| Spending Forecast (Prediction Layer V1) | Reads the `forecast` section of the existing analytics report — predicted next-month spend, range, category breakdown and target-month budget risk. No extra fetch, no separate query key. Every figure is labelled an estimate; no accuracy figure is shown because none is measured. |
| SIA panel | Feature-flagged question/answer surface for explanations of the user's own report |
| Theme | Light/dark theme via `ThemeContext` |

## Routing and authentication behavior

There is **no URL-based multi-page routing**. `react-router-dom`'s `BrowserRouter` is
mounted (so hooks like `useNavigate` work after a mutation), but `App.js` renders the
Login/SignUp screen or the authenticated `LandingPage` by conditionally checking
component state (`isLoggedIn`), not by matching a path against `<Route>` elements.

Auth state is restored from `localStorage` on load: if a `token` is present, the app
treats the user as logged in without re-validating the token against the backend until
the next authenticated request is made. There is no client-side route guard beyond this
state check, because there are no separate routes to guard — the entire authenticated
experience is one screen tree.

## API communication

All backend calls go through a single shared Axios instance
(`src/api/axios.js`), which:
- Adds `Authorization: Bearer <token>` from `localStorage` to every request
- Centrally handles `401` (forces re-authentication), `429`, and `409` responses so
  individual components don't need their own logic for those cases

Two frontend files intentionally bypass this shared instance and use the raw `fetch` API
instead: the push-notification registration calls in
`src/components/hooks/useWebPush.js` and `useMobilePush.js`, and the backend health
check in `App.js`. Every other API call — including SIA's — goes through `src/api/*.js`
and therefore through the shared instance.

## Server-state management and caching

TanStack Query (`@tanstack/react-query`) manages all server state. The shared query
client (`src/query/queryClient.js`) is configured with a 5-minute stale time, 30-minute
garbage-collection time, one retry on queries, and zero retries on mutations. Query keys
are centralized in `src/query/queryKeys.js` so components never hand-write cache keys.
Mutations invalidate the relevant query-key prefixes (expenses, budgets, reports, charts)
on success so dependent views refetch automatically.

**SIA is deliberately outside this cache boundary.** `useSiaAskMutation` is a plain
mutation with no query key, no cached entry, and no invalidation of any other key —
asking SIA a question is a one-off, read-only exchange that changes no server state, so
nothing in the expense/budget/report/chart caches is affected. This is the same
no-invalidation pattern already used by the bill-upload mutation.

One read — the expense-edit-data fetch used to hydrate the edit form — is called
imperatively via `queryClient.fetchQuery` inside a `useEffect`, rather than through a
mounted `useQuery` hook, so it benefits from the shared cache but is not automatically
cancelled on unmount the way the other queries are.

## Expense creation and ML prediction workflow

1. The user types an expense name in the Add Expense form.
2. After a 500ms debounce and a minimum of 3 characters, the frontend calls the
   backend's prediction proxy (`POST /ml/predict-category`), which forwards to the ML
   service.
3. The predicted category and confidence are shown, but the category field is a normal
   text/select input — never disabled, and there is no confidence threshold that blocks
   submission.
4. If the prediction request fails or times out, the category field is simply left
   unfilled; the user can still type a category manually and submit normally.
5. On submit, if the final category differs from what the user was shown, the backend
   records that as training feedback (see the backend and ML-service READMEs for what
   happens to it).

## Bill scanning / OCR UI

Implemented. The bill-scan screen (`src/components/billScanner/`) uploads a photo to the
backend, which runs OCR and returns a best-effort merchant name, amount, and date. These
three values prefill the Add Expense form; every field remains editable and nothing is
persisted until the user explicitly submits the form.

## SIA: feature-flagged entry point and panel

SIA's UI lives in `src/components/sia/` and is **disabled by default**.

**Feature flag.** `SiaEntryPoint` renders nothing at all unless
`REACT_APP_SIA_ENABLED` is the exact lowercase string `true`. Any other value — `TRUE`,
`1`, `yes`, whitespace-padded, or unset — keeps the launcher hidden. Because Create React
App inlines `REACT_APP_*` variables at build time, this flag is fixed for a given build.
It is a **visibility control only**; the backend's own `SIA_ENABLED` is the authoritative
server-side gate regardless of what the frontend build says.

**Placement.** `SiaEntryPoint` is rendered inside `LandingPage`, which only exists in the
authenticated tree — so the component never inspects auth state, tokens, or
`localStorage` itself. Authenticated placement is guaranteed by where it is mounted.

**Workflow.**

1. When enabled, a single "Ask SIA" launcher button appears.
2. Clicking it replaces the launcher with `SiaPanel` — never both at once, so every open
   is a **fresh mount** with no state carried over from a previous session.
3. The user types a question and submits. Submission is blocked while a request is in
   flight and for blank or whitespace-only input; the question itself is sent unmodified.
4. While pending, an accessible status line is shown and the submit control is disabled.
5. On success, SIA's answer is rendered.
6. On error, an accessible alert shows the backend's message when one is available, or a
   fixed generic fallback otherwise, alongside a **Retry** control that resends the exact
   previous question unchanged.
7. Closing the panel unmounts it and returns to the launcher.

**Rendering guarantees.**

- The answer is rendered as **plain React text**. It is not parsed as Markdown, and it is
  never inserted as HTML — an answer containing markup appears as literal characters.
- Only the `answer` field is displayed. The response's server-owned `basedOn` grounding
  metadata and `intent` are **never surfaced in the UI**.
- The "not enough data" response is a normal success from the frontend's perspective and
  renders as an ordinary answer, not as an error.
- Error display reads only a plain string message from the response body — never the raw
  error object, Axios config, or stack trace.

**What the SIA UI does not do:** it stores no conversation history, renders no Markdown,
streams nothing, has no voice input, and holds no state between opens. Each open is a
single question-and-answer exchange, matching the stateless backend.

## Folder structure

```
frontend/src/
├── api/               Axios instance + one file per backend resource (expenseApi.js, budgetApi.js, siaApi.js, ...)
├── components/
│   ├── loginSignUp/    Auth screens
│   ├── landingPage/    Authenticated home
│   ├── expensesHandling/  Add/Edit expense, ML prediction trigger
│   ├── billScanner/    Receipt upload/scan UI
│   ├── IncomeHandling/ Income CRUD screens
│   ├── charts/         Line/bar/pie chart components
│   ├── insights/, monthlyInsights/  Rule-based insight cards
│   ├── sia/            SIA launcher, panel, and styles
│   ├── contexts/       ThemeContext and related providers
│   └── hooks/          Push-notification hooks (useWebPush, useMobilePush)
├── hooks/
│   ├── queries/        TanStack useQuery hooks
│   └── mutations/      TanStack useMutation hooks (incl. useSiaAskMutation)
├── query/              queryClient + centralized queryKeys
├── insights-engine/    Rule-based insight calculation logic
├── firebase.js, pushNotification.js  Push notification setup
└── App.js              App shell, auth-state gate, global providers
```

## Environment variables

Values below are placeholders. No secret values are included here or in any tracked file.

| Variable | Required | Purpose |
|---|---|---|
| `REACT_APP_BACKEND_URL` | Yes | Base URL the frontend calls for all backend requests (and the health-check ping) |
| `REACT_APP_SIA_ENABLED` | No | Set to exactly `true` to show the SIA launcher. Any other value or unset hides it entirely. Default: hidden. |

Both are inlined at build time by Create React App, so changing either requires a
rebuild. No provider key, model name, or other SIA secret is ever read by the frontend.

## Installation and commands

```bash
npm install
npm start      # Create React App dev server (default port 3000)
npm run build  # Production build
npm test       # react-scripts test (Jest + React Testing Library)
```

To run only the SIA suites:

```bash
npm test -- --testPathPattern="sia" --watchAll=false
```

SIA's tests mock the API client, the mutation hook, or the shared Axios instance —
no test issues a real network request.

## Current limitations

- No URL-based routing — the app is not deep-linkable or bookmarkable to a specific
  screen.
- Two push-registration calls and the health-check ping bypass the shared Axios
  instance, so they don't get its centralized error handling.
- A failed ML prediction is silent — the field just stays empty, with no visible error
  state.
- The imperative edit-data fetch is not cancelled on unmount, unlike the app's other
  queries.
- The SIA feature flag is build-time, not runtime — toggling it requires a rebuild.
- No end-to-end or browser-level integration test suite; testing is component- and
  unit-level.

## Implemented versus planned

| Capability | Status |
|---|---|
| Auth screens, expense/income/budget UI, charts, insights | Implemented |
| ML-assisted category suggestion with manual override | Implemented |
| Receipt scan prefill | Implemented |
| TanStack Query caching and invalidation | Implemented |
| SIA launcher, panel, loading/success/no-data/error/retry states | Implemented (feature-flagged, hidden by default) |
| SIA conversation history, Markdown rendering, streaming, or voice input | Not implemented — no such code exists |
| Displaying SIA's `basedOn` grounding metadata in the UI | Not implemented, and intentionally out of scope |
| URL-based routing and client-side route guards | Planned |
| Consistent use of the shared Axios instance for every network call | Planned |
| Visible error/retry affordances for failed ML predictions and edit-data loads | Planned |
