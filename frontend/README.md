# BALENISA — Frontend

The React single-page application for BALENISA: the UI for authentication, expense and
income entry, budgets, charts, and receipt scanning. It talks only to the BALENISA
backend — it never calls the ML service directly.

See the [root README](../README.md) for the overall system and the
[backend](../backend/README.md) / [ML service](../ml-service/README.md) READMEs for the
other two services.

## Responsibilities

- Render the authenticated app shell and all user-facing screens
- Collect and validate form input client-side before sending it to the backend
- Own client-side server-state caching (TanStack Query) so repeat views don't always
  re-fetch
- Trigger the ML category-prediction call while the user types an expense name, and let
  the user override the suggestion at any time
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
check in `App.js`. Every other API call goes through `src/api/*.js`.

## Server-state management and caching

TanStack Query (`@tanstack/react-query`) manages all server state. The shared query
client (`src/query/queryClient.js`) is configured with a 5-minute stale time, 30-minute
garbage-collection time, one retry on queries, and zero retries on mutations. Query keys
are centralized in `src/query/queryKeys.js` so components never hand-write cache keys.
Mutations invalidate the relevant query-key prefixes (expenses, budgets, reports, charts)
on success so dependent views refetch automatically.

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

## Folder structure

```
frontend/src/
├── api/               Axios instance + one file per backend resource (expenseApi.js, budgetApi.js, ...)
├── components/
│   ├── loginSignUp/    Auth screens
│   ├── landingPage/    Authenticated home
│   ├── expensesHandling/  Add/Edit expense, ML prediction trigger
│   ├── billScanner/    Receipt upload/scan UI
│   ├── IncomeHandling/ Income CRUD screens
│   ├── charts/         Line/bar/pie chart components
│   ├── insights/, monthlyInsights/  Rule-based insight cards
│   ├── contexts/       ThemeContext and related providers
│   └── hooks/          Push-notification hooks (useWebPush, useMobilePush)
├── hooks/
│   ├── queries/        TanStack useQuery hooks
│   └── mutations/      TanStack useMutation hooks
├── query/              queryClient + centralized queryKeys
├── insights-engine/    Rule-based insight calculation logic
├── firebase.js, pushNotification.js  Push notification setup
└── App.js              App shell, auth-state gate, global providers
```

## Environment variables

| Variable | Purpose |
|---|---|
| `REACT_APP_BACKEND_URL` | Base URL the frontend calls for all backend requests (and the health-check ping) |

No other environment variables are read by this frontend. No secret values are included
here.

## Installation and commands

```bash
npm install
npm start      # Create React App dev server (default port 3000)
npm run build  # Production build
npm test       # react-scripts test (Jest + React Testing Library)
```

## Current limitations

- No URL-based routing — the app is not deep-linkable or bookmarkable to a specific
  screen.
- Two push-registration calls and the health-check ping bypass the shared Axios
  instance, so they don't get its centralized error handling.
- A failed ML prediction is silent — the field just stays empty, with no visible error
  state.
- The imperative edit-data fetch is not cancelled on unmount, unlike the app's other
  queries.
- No end-to-end or integration test suite beyond the default Create React App test
  setup.

## Planned frontend work

- A proper client-side route guard and/or URL-based routing, if the app grows beyond a
  single authenticated screen tree.
- Consistent use of the shared Axios instance for every network call.
- Visible error/retry affordances for failed ML predictions and failed edit-data loads.
