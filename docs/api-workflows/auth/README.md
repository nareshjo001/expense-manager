# Authentication module — workflow documentation

Six backend routes, all under `/auth`, each documented as its own API workflow — no
real HTTP endpoint is folded into a combined document. Four internal/frontend flows
explain the parts of the system with no endpoint of their own: protected-request JWT
validation, startup session restoration, client-side logout, and 401/force-reauth
handling. Discovered by reading `backend/Routes/auth.routes.js` and
`frontend/src/App.js` outward — nothing here was assumed from the audit prompt's
suggested names before being confirmed in the repository.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py). No new shared components were
required — every region, card style, and exception-band pattern already existed.

## Module purpose

Everything in this module either issues the one credential the rest of the app runs on
(a JWT with no expiry) or reacts to that credential being presented, missing, or
rejected. There is no authorization layer, no roles, and no server-side session beyond
the token itself.

## Confirmed APIs

| ID | Method | Endpoint | Document |
|---|---|---|---|
| AUTH-API-01 | POST | `/auth/signup` | [auth-api-01-register.md](auth-api-01-register.md) |
| AUTH-API-02 | POST | `/auth/login` | [auth-api-02-login.md](auth-api-02-login.md) |
| AUTH-API-03 | POST | `/auth/verify-otp` | [auth-api-03-verify-otp.md](auth-api-03-verify-otp.md) |
| AUTH-API-04 | POST | `/auth/resend-otp` | [auth-api-04-resend-otp.md](auth-api-04-resend-otp.md) |
| AUTH-API-05 | POST | `/auth/forgot-password` | [auth-api-05-forgot-password.md](auth-api-05-forgot-password.md) |
| AUTH-API-06 | POST | `/auth/reset-password` | [auth-api-06-reset-password.md](auth-api-06-reset-password.md) |

That is the complete backend Authentication surface. AUTH-API-03 and AUTH-API-06 are
each shared by, or dependent on, more than one user journey — AUTH-API-03 serves both
signup verification and password-reset authorization; AUTH-API-06 depends on a window
AUTH-API-03 opens. That sharing is documented within each endpoint's own file, per the
full inventory in
[auth-consumption-map.md, Table A](auth-consumption-map.md#a-backend-api-inventory).

## Internal / frontend flows

| ID | Type | Document |
|---|---|---|
| AUTH-FLOW-01 | Internal (middleware, no endpoint) | [auth-flow-01-protected-request.md](auth-flow-01-protected-request.md) |
| AUTH-FLOW-02 | Frontend (app startup) | [auth-flow-02-session-restoration.md](auth-flow-02-session-restoration.md) |
| AUTH-FLOW-03 | Frontend (client-only, no backend endpoint) | [auth-flow-03-logout.md](auth-flow-03-logout.md) |
| AUTH-FLOW-04 | Frontend (backend-triggered) | [auth-flow-04-expired-token.md](auth-flow-04-expired-token.md) |

## Token lifecycle summary

One JWT, issued only by `AUTH-API-02`, payload `{email, _id, iat}`, **signed with no
expiry** (verified by decoding a real token). Stored in `localStorage`, attached by an
axios request interceptor, verified by one shared `verifyToken` middleware across all
seven protected routers, and never re-checked against the database after signing.
There is no refresh token, no rotation, and no server-side revocation — the two
teardown flows (`AUTH-FLOW-03`, `AUTH-FLOW-04`) only ever clear the *client's copy*.
Full 15-stage lifecycle trace: [auth-consumption-map.md, Table D](auth-consumption-map.md#d-token-lifecycle-inventory).

## Protected module map

Every user-scoped backend router uses the same `verifyToken` middleware, first in its
chain, confirmed by direct inspection of all seven route files:

| Module | Router | Cross-linked in |
|---|---|---|
| Budget, push, recurring | `/api` | [Budget](../budget/README.md) |
| Expense | `/expense` | [Expense](../expense/README.md) |
| Bills | `/bills` | [Bills](../bills/README.md) |
| Income | `/income` | [Income](../income/README.md) |
| Charts | `/chart` | [Charts](../charts/README.md) |
| Report | `/report` | [Report](../report/README.md) |
| ML category prediction | `/ml` | *(not yet documented as its own module)* |

Full table with identity source and confirmed weaknesses per area:
[auth-consumption-map.md, Table E](auth-consumption-map.md#e-protected-route-inventory).

## Security boundary

The **real** security boundary is the backend `verifyToken` middleware — it alone
decides whether a request proceeds. The frontend's `isLoggedIn` boolean in `App.js` is
a UI convenience with no enforcement power of its own; nothing prevents a request from
reaching the backend regardless of what the frontend believes. Authorization (in the
RBAC sense) does not exist anywhere in this codebase — every authenticated user can do
everything the API surface allows, scoped only to their own `userId`.

## Documents and diagrams

| Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|
| AUTH-API-01 | [overview](auth-api-01-register-overview.svg) | [detailed](auth-api-01-register-detailed.svg) | [auth-api-01-register.md](auth-api-01-register.md) |
| AUTH-API-02 | [overview](auth-api-02-login-overview.svg) | [detailed](auth-api-02-login-detailed.svg) | [auth-api-02-login.md](auth-api-02-login.md) |
| AUTH-API-03 | [overview](auth-api-03-verify-otp-overview.svg) | [detailed](auth-api-03-verify-otp-detailed.svg) | [auth-api-03-verify-otp.md](auth-api-03-verify-otp.md) |
| AUTH-API-04 | [overview](auth-api-04-resend-otp-overview.svg) | [detailed](auth-api-04-resend-otp-detailed.svg) | [auth-api-04-resend-otp.md](auth-api-04-resend-otp.md) |
| AUTH-API-05 | [overview](auth-api-05-forgot-password-overview.svg) | [detailed](auth-api-05-forgot-password-detailed.svg) | [auth-api-05-forgot-password.md](auth-api-05-forgot-password.md) |
| AUTH-API-06 | [overview](auth-api-06-reset-password-overview.svg) | [detailed](auth-api-06-reset-password-detailed.svg) | [auth-api-06-reset-password.md](auth-api-06-reset-password.md) |
| AUTH-FLOW-01 | [overview](auth-flow-01-protected-request-overview.svg) | [detailed](auth-flow-01-protected-request-detailed.svg) | [auth-flow-01-protected-request.md](auth-flow-01-protected-request.md) |
| AUTH-FLOW-02 | [overview](auth-flow-02-session-restoration-overview.svg) | [detailed](auth-flow-02-session-restoration-detailed.svg) | [auth-flow-02-session-restoration.md](auth-flow-02-session-restoration.md) |
| AUTH-FLOW-03 | [overview](auth-flow-03-logout-overview.svg) | [detailed](auth-flow-03-logout-detailed.svg) | [auth-flow-03-logout.md](auth-flow-03-logout.md) |
| AUTH-FLOW-04 | [overview](auth-flow-04-expired-token-overview.svg) | [detailed](auth-flow-04-expired-token-detailed.svg) | [auth-flow-04-expired-token.md](auth-flow-04-expired-token.md) |

Full inventory tables (backend API, backend components, frontend consumption, token
lifecycle, protected routes, cross-module ownership, dead/duplicate code, findings):
[auth-consumption-map.md](auth-consumption-map.md).

## Confirmed limitations

The five worth reading first (full list per-document):

1. **Login JWTs never expire** — `jwt.sign` has no `expiresIn`.
2. **User enumeration via distinguishable 404/401/403 responses** on both login and
   password reset.
3. **No database re-check in `verifyToken`** — a deleted user's token remains accepted.
4. **No email normalization** — case-variant duplicate accounts are possible; login is
   case-sensitive.
5. **No server-side logout** — the JWT is never revoked; only the client's local copy
   is ever cleared.

## Out-of-scope functionality

Confirmed **absent** from this repository, not merely undocumented:

- Password change while already logged in (only the OTP-gated reset exists).
- A current-user/session-validation (`/auth/me`-style) endpoint.
- Token refresh or rotation.
- Server-side logout/revocation.
- Username/email-availability checks.
- Account deletion.
- Roles, permissions, or any authorization concept beyond per-account data ownership.
- An `AuthContext`/provider or any `ProtectedRoute`/`PrivateRoute` component.
- Frontend JWT decoding of any kind.
- Multi-tab `storage`-event synchronization.
- "Remember me" behaviour.
- Cookie-based token storage of any kind (so no `HttpOnly`/`Secure`/`SameSite`
  question applies).

## Regenerating

```bash
cd docs/api-workflows/auth
python3 build_auth_overviews.py
python3 build_auth_detailed.py
```

Both scripts are cwd-independent (verified by running from `/tmp`) and were rasterized
with the same `librsvg`/`cairo` bridge used for every other module in this corpus.
