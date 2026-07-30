# Authentication consumption map

What the Authentication module actually contains, what it calls, and — equally
important — which layers it does not have. Traced from `backend/Routes/auth.routes.js`,
`backend/Middlewares/Auth.js`, and `frontend/src/App.js` outwards.

There is no AuthContext, no protected-route component, no refresh token, and no
frontend JWT decoding anywhere in this repository. Each is confirmed absent below
rather than assumed present.

## A. Backend API inventory

| AUTH API ID | Method | Endpoint | Route mount | Middleware order | Handler | Frontend caller | Consumer | Status |
|---|---|---|---|---|---|---|---|---|
| [AUTH-API-01](auth-api-01-register.md) | POST | `/auth/signup` | `app.use("/auth", authRouter)` | `authLimiter` → `signupValidation` → `signup` | `Controllers/AuthControllers/signup.js` | raw `fetch` in `SignUp.js` | `SignUp.js` → `OTPForm.js` | Actively used |
| [AUTH-API-02](auth-api-02-login.md) | POST | `/auth/login` | same mount | `authLimiter` → `loginValidation` → `login` | `Controllers/AuthControllers/login.js` | raw `fetch` in `Login.js` | `Login.js` → `App.js` | Actively used |
| [AUTH-API-03](auth-api-03-verify-otp.md) | POST | `/auth/verify-otp` | same mount | `authLimiter` → `verifyOTP` | `Controllers/AuthControllers/verifyOTP.js` | raw `fetch` in `OTPForm.js` and `ForgotPassword.js` | both signup and password-reset journeys | Actively used |
| [AUTH-API-04](auth-api-04-resend-otp.md) | POST | `/auth/resend-otp` | same mount | `authLimiter` → `resendOTP` | `Controllers/AuthControllers/resendOTP.js` | raw `fetch` in `OTPForm.js` | signup verification only | Actively used |
| [AUTH-API-05](auth-api-05-forgot-password.md) | POST | `/auth/forgot-password` | same mount | `authLimiter` → `forgotPassword` | `Controllers/AuthControllers/forgotPassword.js` | raw `fetch` in `ForgotPassword.js` | password-reset journey | Actively used |
| [AUTH-API-06](auth-api-06-reset-password.md) | POST | `/auth/reset-password` | same mount | `authLimiter` → `resetPassword` | `Controllers/AuthControllers/resetPassword.js` | raw `fetch` in `ResetPassword.js` | password-reset journey | Actively used |

**Every real HTTP endpoint under `/auth` is documented as its own API workflow** — six
in total, none folded into a combined document. Two of them (`verify-otp` and
`reset-password`) are shared by, or gate, more than one user journey; that sharing is
described in their own documents and in the ownership notes below, not by merging them
into a flow document.

**That is the complete backend Authentication surface — six routes, all declared in
`auth.routes.js`.** There is no logout endpoint, no current-user/session-validation
endpoint, no token-refresh endpoint, no password-change-while-logged-in endpoint, no
email/username-availability endpoint, and no account-deletion endpoint anywhere in the
repository. Each absence was confirmed by grep across `backend/Routes/`, not assumed.

| Candidate feature (per the audit's core scope) | Confirmed? |
|---|---|
| Registration/signup | Yes — `POST /auth/signup` ([AUTH-API-01](auth-api-01-register.md)) |
| Login/signin | Yes — `POST /auth/login` ([AUTH-API-02](auth-api-02-login.md)) |
| Logout | **No backend endpoint** — client-only, see [AUTH-FLOW-03](auth-flow-03-logout.md) |
| Current-user/session validation | **Does not exist** — session restoration never calls the backend (see [AUTH-FLOW-02](auth-flow-02-session-restoration.md)) |
| Token refresh | **Does not exist** |
| Password reset | Yes — 3 endpoints: [AUTH-API-05](auth-api-05-forgot-password.md) (start), [AUTH-API-03](auth-api-03-verify-otp.md) (authorize), [AUTH-API-06](auth-api-06-reset-password.md) (complete) |
| Password change (while logged in) | **Does not exist** — only the OTP-gated reset flow can change a password |
| Email verification | Yes — [AUTH-API-03](auth-api-03-verify-otp.md) (verify) / [AUTH-API-04](auth-api-04-resend-otp.md) (resend) |
| Username/email availability check | **Does not exist** |
| Account deletion | **Does not exist** |
| Auth-related endpoint mounted under another router | **No** — all 6 auth endpoints live under `/auth`; nothing auth-related is mounted under `/api`, `/expense`, etc. |

Only one of the six routes — `login` — ever issues a JWT. The other five
(`signup`, `verify-otp`, `resend-otp`, `forgot-password`, `reset-password`) never sign
a token and never log the user in — confirmed by reading every controller's response
body.

## B. Backend component inventory

| Component ID | File | Function/export | Inputs | Outputs | Called by | Side effects |
|---|---|---|---|---|---|---|
| Router | `Routes/auth.routes.js` | route table | — | — | `server.js` | mounts all 6 routes under `/auth`, no `apiLimiter` |
| Controller | `Controllers/AuthControllers/signup.js` | `signup` | `{fullName, email, password}` | 201/409/500 | route | writes/overwrites a `UserModel` doc, sends an OTP email |
| Controller | `Controllers/AuthControllers/login.js` | `login` | `{email, password}` | 200 + JWT / 404 / 401 / 403 / 500 | route | signs a JWT (no expiry) |
| Controller | `Controllers/AuthControllers/verifyOTP.js` | `verifyOTP` | `{email, otp}` | 200/404/400/500 | route | sets `isVerified`, clears OTP fields, or opens a reset window |
| Controller | `Controllers/AuthControllers/resendOTP.js` | `resendOTP` | `{email}` | 200/404/400/429/500 | route | reissues OTP, resets `lastOtpSent` and TTL |
| Controller | `Controllers/AuthControllers/forgotPassword.js` | `forgotPassword` | `{email}` | 200/404/403/429/500 | route | sets `isPasswordReset`, sends reset OTP |
| Controller | `Controllers/AuthControllers/resetPassword.js` | `resetPassword` | `{email, password}` | 200/404/403/500 | route | rehashes and saves the password, clears reset flags |
| Validation | `Middlewares/AuthValidation.js` | `signupValidation`, `loginValidation` | `req.body` | 400 or `next()` | route, before controller | Joi schemas, `.unknown(true)` on both |
| Middleware | `Middlewares/Auth.js` | `verifyToken` (default export) | `req.headers.authorization` | `req.userId` or 401 | every protected router (7 of them) | **credential validation is NOT this — this is identity verification of an already-issued token, see the distinction below** |
| Rate limiter | `utils/rateLimiter.js` | `authLimiter` | `req.ip` (default key) | pass or 429 | all 6 `/auth` routes | 20 req / 15 min, one shared bucket |
| Rate limiter | `utils/rateLimiter.js` | `apiLimiter` | `req.userId \|\| req.ip` | pass or 429 | all *other* protected routers | **not applied to `/auth`** — a deliberate, commented split in `server.js` |
| Password service | `Services/AuthServices/password.service.js` | `hashPassword`, `comparePassword` | plaintext / hash | hash / boolean | signup, login, resetPassword | bcrypt, 10 salt rounds, no pepper |
| OTP service | `Services/AuthServices/otp.service.js` | `generateOTP`, `hashOTP`, `getOtpExpiry`, `getVerificationExpiry`, `canResendOtp`, `clearOtpFields` | varies | varies | signup, verifyOTP, resendOTP, forgotPassword | sha256 hashing, no side effects beyond pure computation |
| Email service | `Services/AuthServices/email.service.js` | `sendOTPEmail` | `email, otp, purpose` | none (fire-and-await) | signup, resendOTP, forgotPassword | calls the Brevo (`sib-api-v3-sdk`) transactional API — external network dependency |
| Model | `config/Schemas.js` | `userSchema` / `UserModel` | — | — | every controller above | TTL index on `verificationExpiresAt` — see Finding D below |
| Config | `.env` via `process.env.JWT_SECRET`, `BREVO_API_KEY` | — | — | — | `login.js`, `Auth.js`, `email.service.js` | no explicit handling if either is undefined — see Findings |

**Distinguishing the five concepts the prompt asks to separate:**

- **Credential validation** = Joi's `signupValidation`/`loginValidation` — checks the
  *shape* of what was submitted (an email-looking string, a password of the right
  length), before any database or crypto work happens.
- **Identity verification** (of a claim) = `comparePassword` in `login.js` — proves the
  submitted password matches the stored hash for that email.
- **Authentication** (issuing/accepting a session token) = `jwt.sign` in `login.js`
  (issuing) and `jwt.verify` in `verifyToken` (accepting) — the JWT itself *is* the
  session; there is nothing else backing it.
- **Authorization** (deciding what an authenticated identity may do) = **does not exist
  as a separate concept in this codebase.** There are no roles, no admin flag, no
  permission checks anywhere. Every authenticated user can do everything the API
  surface allows for their own data.
- **User isolation** (scoping data to the right account) = every controller's Mongo
  query includes `{userId: req.userId}` (or `{user: req.userId}` for Report) — this is
  ownership scoping, not authorization in the RBAC sense.

## C. Frontend authentication inventory

| UI ID | Page/component/hook | Trigger | State owner | API/helper | Token access | Success behaviour | Failure behaviour |
|---|---|---|---|---|---|---|---|
| AUTH-UI-01 | `Login.js` | form submit | local `useState` | raw `fetch('/auth/login')` | writes `localStorage.token` | `setIsLoggedIn(true)`, toast | toast; 429 gets a friendlier message |
| AUTH-UI-02 | `SignUp.js` | form submit | local `useState` | raw `fetch('/auth/signup')` | none written | advances to `OTPForm` | toast; button disabled while `isFetching` |
| AUTH-UI-03 | `OTPForm.js` | 6-digit entry or paste | local `useState` | raw `fetch('/auth/verify-otp')`, `/auth/resend-otp` | none | toast, returns to Login | shake animation, clears boxes |
| AUTH-UI-04 | `ForgotPassword.js` | email submit, then OTP submit | local `useState` | raw `fetch('/auth/forgot-password')`, `/auth/verify-otp` | none | advances to `ResetPassword` | toast |
| AUTH-UI-05 | `ResetPassword.js` | new-password submit | local `useState` | raw `fetch('/auth/reset-password')` | none | toast, returns to prior screen | toast; 403 also returns to prior screen |
| AUTH-UI-06 | `App.js` (session restoration) | app mount | local `useState` (`isLoggedIn`) | none — reads `localStorage` directly | reads `localStorage.token` (presence only) | renders `LandingPage` | renders `Login`/`SignUp` |
| AUTH-UI-07 | `LandingPage.js` (`handleLogout`) | button click (2 locations) | local `useState`, lifted from `App.js` | none | clears `localStorage`, clears `queryClient` | returns to Login, no reload | — (cannot fail) |
| AUTH-UI-08 | `api/axios.js` (request interceptor) | every `api.*()` call | — | — | reads `localStorage.token`, attaches header | request proceeds | request proceeds without a header if none exists |
| AUTH-UI-09 | `api/handleApiError.js` (response interceptor + `forceReauth`) | any non-2xx via the shared instance | — | — | clears `localStorage`, clears `queryClient` | — | `window.location.replace("/")` on 401 |

**Confirmed absent, not just undocumented:**

- No `AuthContext`, `AuthProvider`, or `useAuth` hook exists anywhere (grep-confirmed).
- No `ProtectedRoute`/`PrivateRoute`/`RequireAuth` component exists (grep-confirmed).
- No JWT decoding library or manual decode exists on the frontend (grep-confirmed) —
  session restoration checks only whether a `token` string is present.
- No "remember me" checkbox or behaviour exists.
- No explicit multi-tab or `storage`-event synchronization exists — a logout in one tab
  does not notify another open tab; the other tab's next request simply gets its own
  401 and runs AUTH-FLOW-04 independently.
- Duplicate-submission protection is inconsistent: `SignUp.js` and the two
  password-reset forms disable their submit button while a request is pending;
  `Login.js` does not.

## D. Token lifecycle inventory

| Stage | Producer/consumer | Token location | Validation performed | Failure behaviour | Security observation |
|---|---|---|---|---|---|
| 1. Creation | `login.js` | — | none (this *is* the trust boundary) | — | `jwt.sign({email, _id}, JWT_SECRET)` — **no third `options` argument, so no `expiresIn`** |
| 2. Payload | `login.js` | — | — | — | Exactly `{email, _id, iat}` — no roles, no scopes |
| 3. Signing algorithm | `jsonwebtoken` default | — | — | — | HS256 (library default); no explicit `algorithm` option set |
| 4. Expiry configuration | — | — | — | — | **None set. Confirmed by decoding a real signed token: no `exp` claim.** |
| 5. API response | `login.js` | response body, field `token` | — | — | Plain JSON, not a cookie |
| 6. Frontend extraction | `Login.js` | `data.token` | none | — | No shape check before storing |
| 7. Storage | `Login.js` | `localStorage.setItem("token", ...)` | — | — | Plaintext; no `HttpOnly`/`Secure`/`SameSite` apply because it is not a cookie at all |
| 8. Attachment | `api/axios.js` request interceptor | `Authorization: Bearer <token>` header | presence check only | omitted if absent | Every call through the shared instance; raw-`fetch` calls (all 6 `/auth` routes) never attach it |
| 9. Backend extraction | `Middlewares/Auth.js` | `req.headers.authorization` | `startsWith("Bearer ")` | 401 | Case-sensitive scheme match |
| 10. Signature/expiry verification | `Middlewares/Auth.js` | — | `jwt.verify(token, JWT_SECRET)` | 401, generic message for every failure type | Confirmed by execution: expired/malformed/wrong-signature all collapse to the same 401 body |
| 11. Identity propagation | `Middlewares/Auth.js` | `req.userId = decoded._id` | truthy-check only, no type check | 401 if `_id` absent | No re-query of MongoDB at this step |
| 12. Expiry handling | — | — | — | — | **Moot — no token ever expires**, so this step never fires in practice |
| 13. Logout/removal | `LandingPage.js` `handleLogout`, or `handleApiError.forceReauth` | `localStorage.clear()` | — | — | Client-side only; the JWT itself is never told it's invalid |
| 14. After reload | `App.js` startup effect | `localStorage.getItem("token")` | presence only | — | A stale-but-unexpired token restores `isLoggedIn = true` with zero backend contact |
| 15. After switching users | manual logout, then a new login | — | — | — | `queryClient.clear()` runs on both logout and forced reauth, preventing account B from rendering account A's cached data on the same tab |

Direct answers to the prompt's specific determinations:

- **Response field:** `token` (top-level, alongside `message`, `success`, `email`, `firstname`).
- **Storage:** `localStorage`, not memory, not `sessionStorage`, not a cookie.
- **Cookie flags:** N/A — no cookie is used anywhere in this module.
- **Frontend decodes without server validation:** **No** — the frontend never decodes
  the JWT at all, not even without validation. It only checks the key's presence.
- **Backend trusts a user ID from the request:** **No** — `req.userId` always comes
  from the verified token's `_id` claim; no controller reads a client-supplied ID
  instead (confirmed by grep across 28 controller files).
- **Database queried after token verification:** **No**, not by the middleware itself.
  Individual controllers do query the database afterward, scoped by `req.userId`, but
  none of them re-confirms the user still exists before acting.
- **Disabled/deleted users remain authenticated:** **Yes, until the token would
  otherwise expire** — which, since no expiry is set, means indefinitely, or until the
  server's `JWT_SECRET` changes.
- **JWT secret/configuration failures handled:** **No explicit handling.** If
  `JWT_SECRET` is `undefined`, `jwt.sign`/`jwt.verify` throw inside `jsonwebtoken`,
  which `login.js`'s and `Auth.js`'s own `try/catch` turn into a generic 500/401 rather
  than a distinguishable configuration error.
- **Refresh tokens:** **Do not exist.**
- **Token rotation/revocation:** **Does not exist.**
- **Logout invalidates the token server-side:** **No** — there is no server-side
  logout at all.
- **Stale tokens usable until expiry:** **Usable forever**, since there is no expiry.

## E. Protected-route inventory

| Protected area | Backend or frontend | Protection mechanism | Identity source | Unauthorized behaviour | Confirmed weakness |
|---|---|---|---|---|---|
| `/api/*` (Budget, push, recurring) | Backend | `verifyToken` (first middleware, every route) | `req.userId` | 401 | None found — cross-linked in [Budget module](../budget/README.md) |
| `/expense/*` | Backend | `verifyToken` (first middleware, every route) | `req.userId` | 401 | None found — cross-linked in [Expense module](../expense/README.md) |
| `/bills/*` | Backend | `verifyToken` (first middleware) | `req.userId` | 401 | None found — cross-linked in [Bills module](../bills/README.md) |
| `/income/*` | Backend | `verifyToken` (first middleware, every route) | `req.userId` | 401 | None found — cross-linked in [Income module](../income/README.md) |
| `/chart/*` | Backend | `verifyToken` (first middleware, every route) | `req.userId` | 401 | None found — cross-linked in [Charts module](../charts/README.md) |
| `/report` | Backend | `verifyToken` | `req.userId` | 401 | None found — cross-linked in [Report module](../report/README.md) |
| `/ml/predict-category` | Backend | `verifyToken` | `req.userId` | 401 | None found |
| Every module listed above | Backend | *(none — see D)* | — | — | Deleted-user tokens still pass `verifyToken`; only downstream empty query results limit the impact |
| Entire authenticated app tree | Frontend | one boolean (`isLoggedIn`) in `App.js` | `localStorage` presence | falls back to `Login`/`SignUp` render | **Frontend-only** — this is a UI convenience, not a security boundary; the real boundary is the backend middleware above |
| Individual routes inside `LandingPage` (dashboard, charts, settings, etc.) | Frontend | **None individually** | — | — | No per-route guard exists; all are equally reachable once the one boolean is true |

**Confirmed: every user-scoped backend router uses `verifyToken` as its first
middleware, before any validation middleware, before the controller.** Verified by
reading `Routes/api.routes.js`, `Routes/expense.routes.js`, `Routes/bill.routes.js`,
`Routes/income.routes.js`, `Routes/chart.routes.js`, `Routes/report.routes.js`, and
`Routes/ml.router.js` directly — no route in any of the seven files omits it, and none
places `verifyToken` after another middleware that could short-circuit first.

## F. Cross-module ownership map

| Module | Reads `req.userId` how | Ownership filter | Cross-links |
|---|---|---|---|
| Expense | `req.userId` set by `verifyToken` | `{userId: req.userId}` on every query | [Expense consumption map](../expense/expense-consumption-map.md) |
| Budget | `req.userId` set by `verifyToken` | `{userId: req.userId}` on every query | [Budget README](../budget/README.md) |
| Income | `req.userId` set by `verifyToken` | `{userId: req.userId}` on every query | [Income README](../income/README.md) |
| Charts | `req.userId` set by `verifyToken` | scoped via the underlying Expense/Budget queries | [Charts consumption map](../charts/charts-consumption-map.md) |
| Bills | `req.userId` set by `verifyToken` | the extracted bill is never persisted; only the follow-up Expense save is scoped | [Bills consumption map](../bills/bills-consumption-map.md) |
| Report | `req.userId` set by `verifyToken` | `{user: req.userId}` (note the different field name) | [Report consumption map](../report/report-consumption-map.md) |

No module accepts a userId override from the request body, query string or path — this
was independently re-confirmed for this audit via `grep -rn "req.body.userId\|req.query.userId\|req.params.userId" Controllers/` across all 28 controller files, with zero matches.

## G. Dead, duplicate, or legacy implementations

**None found.** Unlike the Reports/Analytics Engine module (which had two dead
duplicate files), the Authentication module has no unused controllers, no duplicate
validation schemas, and no legacy routes. All 6 routes, all 6 controllers, all 3
services, and the single middleware are live and reachable.

## H. Findings summary

Full findings with consequences live in the per-workflow documents. The five worth
reading first:

1. **Login JWTs never expire.** `jwt.sign` is called with no `expiresIn` — verified by
   decoding a real token and finding no `exp` claim.
2. **Three distinguishable, user-revealing auth error messages** (`404` account
   missing, `401` wrong password, `403` unverified) enable email enumeration on both
   login and password reset.
3. **`verifyToken` never re-queries the database** — a deleted user's token remains
   accepted until it would otherwise expire, which is never.
4. **Email addresses are never normalized** (no lowercase, no trim) — case-variant
   duplicate accounts are possible, and login is case-sensitive against a
   case-sensitive unique index.
5. **Logout has no backend counterpart** — `localStorage.clear()` and
   `queryClient.clear()` are the entire session teardown; the JWT itself is never
   revoked server-side.
