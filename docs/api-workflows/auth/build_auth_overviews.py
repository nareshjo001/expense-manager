"""
Level 1 overviews for the Authentication module — one file, ten outputs.

Corrected classification: every real HTTP endpoint under /auth is its own API
workflow (six total) — verify-otp, resend-otp, forgot-password and reset-password no
longer live only inside combined flow documents. Four genuinely internal/frontend
flows remain, renumbered AUTH-FLOW-01..04: protected-request JWT validation, frontend
session restoration, client-side logout, and 401/force-reauth handling.

Confirmed, not assumed: there is no AuthContext/provider, no protected-route
component, no JWT decoding anywhere on the frontend, no refresh token, and no expiry
on the login JWT at all (jwt.sign is called with no options).

Run:  python3 build_auth_overviews.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from workflow_diagram import Overview, load_tokens   # noqa: E402


def new(title, subtitle):
    return Overview(load_tokens(), title=title, subtitle=subtitle)


def error_card(o, x, y, w, title, lines):
    d, ep = o.d, o.d.pal("error")
    body = "".join(d._text(x + 13, y + 44 + i * 13, ln, 9.8, d.n["inkMuted"], 400)
                   for i, ln in enumerate(lines))
    d.mid.append('<g><rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="%s" '
                 'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s</g>'
                 % (x, y, w, 34 + len(lines) * 13 + 12, ep["fill"], ep["border"],
                    d._icon("alert", x + 13, y + 12, ep["line"], 0.78),
                    d._text(x + 34, y + 25, title, 10.8, ep["ink"], 700), body))


def save(o, svg, name):
    open(os.path.join(HERE, name), "w", encoding="utf-8").write(svg)
    print("wrote", name, len(svg))


# ===========================================================================
# AUTH-API-01 — Register
# ===========================================================================
o = new("POST /auth/signup — registering a new account",
        "Quick overview · follow 01 → 09 · full detail in auth-api-01-register-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /auth/signup",                              "auth"),
    ("Rate limit", "authLimiter · 20 req / 15 min, shared with 5 other auth routes", "auth"),
    ("Session issued", "None — signup never returns a token",        "error"),
    ("Password",   "bcrypt, 10 salt rounds",                         "database"),
    ("Unverified accounts", "Auto-deleted by Mongo after 10 minutes (TTL index)", "database"),
])
d.note_box(882, 276, 516, 168, "Not create-only", [
    "An email that already exists but is unverified is reused, not rejected — its "
    "name, password and OTP are overwritten and a fresh code is sent.",
    "409 'User Already Exists' is returned only when the existing account is already "
    "verified.",
], "insights")

t = [
    o.card(0, R1, "ui", "layout", "01", "Signup Form", "SignUp.js",
           "Name/email/password, client-checked."),
    o.card(1, R1, "auth", "shield", "02", "Rate Limiter", "authLimiter",
           "IP-keyed, shared across all 6 auth routes."),
    o.card(2, R1, "backend", "gears", "03", "Joi Validation", "signupValidation",
           "Extra fields allowed; email/password shape checked."),
    o.card(3, R1, "database", "database", "04", "Existing-user Lookup", "findOne(email)",
           "No case normalization — see the note below."),
    o.card(4, R1, "database", "key", "05", "Password Hashed", "bcrypt · 10 rounds",
           "Computed before the document is written."),
    o.card(5, R1, "database", "save", "06", "OTP + User Saved", "UserModel",
           "Hashed OTP, 5 min expiry, isVerified: false."),
    o.card(6, R1, "backend", "send", "07", "OTP Emailed", "Brevo transactional API",
           "Plaintext OTP, 5 minute validity."),
    o.card(7, R1, "response", "send", "08", "201 Created", "No token",
           "\"Verify OTP to continue\"."),
    o.card(8, R1, "ui", "layout", "09", "OTP Screen", "Not logged in",
           "Hands off to AUTH-API-03 (verify-otp)."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "Not auto-authenticated",
           ["A successful signup never", "stores a token — the user", "must verify, then log in."])
d.path([(t[8].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Duplicate-click protection is the submit button's disabled state while "
                  "isFetching is true — no server-side idempotency key exists."],
                 "AUTH-API-01"),
     "auth-api-01-register-overview.svg")


# ===========================================================================
# AUTH-API-02 — Login
# ===========================================================================
o = new("POST /auth/login — establishing a session",
        "Quick overview · follow 01 → 10 · full detail in auth-api-02-login-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /auth/login",                                "auth"),
    ("Rate limit", "authLimiter · 20 req / 15 min",                   "auth"),
    ("JWT expiry", "NONE — jwt.sign is called with no options",       "error"),
    ("Token storage", "localStorage, plaintext, key \"token\"",       "frontend"),
    ("Refresh token", "Does not exist",                               "error"),
])
d.note_box(882, 276, 516, 168, "Distinguishable error paths", [
    "404 \"User not found\", 401 \"Invalid Password\", 403 \"Account not verified\" are "
    "three different, user-revealing messages for three different failure reasons — "
    "confirmed user enumeration, not a hypothetical.",
], "error")

t = [
    o.card(0, R1, "ui", "layout", "01", "Login Form", "Login.js",
           "Raw fetch, not the shared axios instance."),
    o.card(1, R1, "auth", "shield", "02", "Rate Limiter", "authLimiter",
           "Shared budget with signup and OTP routes."),
    o.card(2, R1, "backend", "gears", "03", "Joi Validation", "loginValidation",
           "Email format + 8-25 char password."),
    o.card(3, R1, "database", "database", "04", "User Lookup", "findOne(email)",
           "Case-sensitive — no normalization."),
    o.card(4, R1, "database", "key", "05", "Password Compared", "bcrypt.compare",
           "Against the stored hash."),
    o.card(5, R1, "backend", "gears", "06", "Verified Check", "isVerified",
           "403 if the account never completed OTP."),
    o.card(6, R1, "auth", "key", "07", "JWT Signed", "jwt.sign — no expiresIn",
           "Payload: { email, _id }. Never expires."),
    o.card(7, R1, "response", "send", "08", "200 OK, Token Stored", "localStorage, plaintext",
           "token + email + firstname; no HttpOnly cookie option."),
    o.card(8, R1, "ui", "layout", "09", "Protected App", "isLoggedIn = true",
           "App.js re-renders past the gate."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "One session, forever",
           ["No refresh, no rotation, no", "server-side revocation — logout", "is purely client-side (AUTH-FLOW-03)."])
d.path([(t[8].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Login has no client-side duplicate-submit guard at all — no disabled state, "
                  "no spinner-only interception like other forms in this codebase."],
                 "AUTH-API-02"),
     "auth-api-02-login-overview.svg")


# ===========================================================================
# AUTH-API-03 — Verify OTP
# ===========================================================================
o = new("POST /auth/verify-otp — confirming a 6-digit code",
        "Quick overview · follow 01 → 09 · full detail in auth-api-03-verify-otp-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /auth/verify-otp",                            "auth"),
    ("Two callers", "signup verification (AUTH-API-01) and password reset (AUTH-API-05)", "insights"),
    ("Hashing",    "sha256, compared as hex strings — not bcrypt",     "database"),
    ("Session issued", "None, either branch",                         "error"),
])
d.note_box(882, 276, 516, 168, "One endpoint, two branches", [
    "isPasswordReset on the user document — not a separate route or param — decides "
    "whether this call finishes email verification or opens a password-reset window.",
], "insights")

t = [
    o.card(0, R1, "ui", "layout", "01", "OTP Entry", "OTPForm.js or ForgotPassword.js",
           "6-box grid (signup) or single field (reset)."),
    o.card(1, R1, "auth", "shield", "02", "Rate Limiter", "authLimiter",
           "Shared budget with all 5 other auth routes."),
    o.card(2, R1, "database", "database", "03", "User Lookup", "findOne(email)",
           "404 if no account."),
    o.card(3, R1, "database", "key", "04", "Hash + Expiry Checked", "sha256 compare",
           "400 on either failure, distinguished."),
    o.card(4, R1, "backend", "gears", "05", "Branch", "isPasswordReset?",
           "Decides which of the two outcomes below runs."),
    o.card(5, R1, "database", "save", "06", "Verified or Windowed", "isVerified / passwordResetExpiry",
           "Signup: verified + OTP cleared. Reset: 10-min window granted."),
    o.card(6, R1, "response", "send", "07", "200 OK", "No token",
           "\"Email verified successfully\"."),
    o.card(7, R1, "ui", "layout", "08", "Frontend Branch", "two different next screens",
           "Back to Login, or forward to Reset Password."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "Never issues a session",
           ["Neither branch signs a JWT.", "A real login or reset-password", "call still has to follow."])
d.path([(t[7].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["A failed attempt does not consume or extend the OTP's own 5-minute expiry "
                  "— only the shared authLimiter budget and that expiry bound retries."],
                 "AUTH-API-03"),
     "auth-api-03-verify-otp-overview.svg")


# ===========================================================================
# AUTH-API-04 — Resend OTP
# ===========================================================================
o = new("POST /auth/resend-otp — reissuing a signup verification code",
        "Quick overview · follow 01 → 08 · full detail in auth-api-04-resend-otp-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /auth/resend-otp",                            "auth"),
    ("Signup verification only", "Password reset re-sends via forgot-password instead", "insights"),
    ("Server cooldown", "120 s, enforced by canResendOtp()",           "auth"),
    ("Client timer", "A separate, unsynced 120 s countdown in OTPForm.js", "error"),
])
d.note_box(882, 276, 516, 168, "Two independent clocks", [
    "A page refresh resets OTPForm's client countdown to 120 s even if the server's "
    "own cooldown has nearly elapsed.",
], "error")

t = [
    o.card(0, R1, "ui", "refresh", "01", "Countdown Expires", "OTPForm.js, 120 s",
           "Enables the \"Resend OTP\" link."),
    o.card(1, R1, "backend", "send", "02", "Resend Request", "POST /auth/resend-otp",
           "{ email }."),
    o.card(2, R1, "auth", "shield", "03", "Rate Limiter", "authLimiter",
           "Shared budget with all 5 other auth routes."),
    o.card(3, R1, "database", "database", "04", "User Lookup", "findOne(email)",
           "404 if no account."),
    o.card(4, R1, "backend", "gears", "05", "Verified Guard", "400 if already verified",
           "Resend only makes sense pre-verification."),
    o.card(5, R1, "auth", "gauge", "06", "Cooldown Checked", "canResendOtp()",
           "429 with seconds remaining if too soon."),
    o.card(6, R1, "database", "save", "07", "Fresh OTP Issued", "new code + expiry",
           "lastOtpSent and the TTL field both refresh."),
    o.card(7, R1, "response", "send", "08", "200 OK", "cooldown value returned",
           "Resets the client's own countdown."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "Not a reset-flow endpoint",
           ["forgot-password.js's own handler", "resends the reset OTP directly", "— it never calls this route."])
d.path([(t[7].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Only reachable from OTPForm.js, which only renders during signup verification "
                  "— confirmed by tracing every caller of this endpoint."],
                 "AUTH-API-04"),
     "auth-api-04-resend-otp-overview.svg")


# ===========================================================================
# AUTH-API-05 — Forgot Password
# ===========================================================================
o = new("POST /auth/forgot-password — starting a password reset",
        "Quick overview · follow 01 → 09 · full detail in auth-api-05-forgot-password-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /auth/forgot-password",                       "auth"),
    ("Requires",   "An already-verified account",                     "auth"),
    ("Server cooldown", "120 s, same helper as resend-otp",            "auth"),
    ("Hands off to", "AUTH-API-03 (verify-otp, reset branch)",         "insights"),
])
d.note_box(882, 276, 516, 168, "Enumerates verified accounts", [
    "404 (no account), 403 (unverified) and 200 (OTP sent) are three distinct "
    "responses — the same enumeration pattern as login.",
], "error")

t = [
    o.card(0, R1, "ui", "layout", "01", "Forgot Password Form", "email only",
           "Reached from Login's \"Forgot Password?\" link."),
    o.card(1, R1, "backend", "send", "02", "Request", "POST /auth/forgot-password",
           "{ email }."),
    o.card(2, R1, "auth", "shield", "03", "Rate Limiter", "authLimiter",
           "Shared budget with all 5 other auth routes."),
    o.card(3, R1, "database", "database", "04", "User Lookup", "findOne(email)",
           "404 if none."),
    o.card(4, R1, "backend", "gears", "05", "Verified Check", "403 if false",
           "Reset is only offered to verified accounts."),
    o.card(5, R1, "auth", "gauge", "06", "Cooldown Checked", "canResendOtp()",
           "429 with seconds remaining if too soon."),
    o.card(6, R1, "database", "save", "07", "Reset OTP Saved", "isPasswordReset: true",
           "Same OTP shape as signup's."),
    o.card(7, R1, "backend", "send", "08", "OTP Emailed", "Brevo transactional API",
           "Same helper as signup."),
    o.card(8, R1, "response", "send", "09", "200 OK", "cooldown returned",
           "Frontend advances to OTP entry."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "Reused OTP field",
           ["Overwrites any pending signup-", "verification OTP on the same", "document — see AUTH-API-03."])
d.path([(t[8].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["The old password is never required or checked anywhere in this flow — "
                  "mailbox possession is the sole factor once the OTP window opens."],
                 "AUTH-API-05"),
     "auth-api-05-forgot-password-overview.svg")


# ===========================================================================
# AUTH-API-06 — Reset Password
# ===========================================================================
o = new("POST /auth/reset-password — setting a new password",
        "Quick overview · follow 01 → 08 · full detail in auth-api-06-reset-password-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /auth/reset-password",                        "auth"),
    ("Requires",   "A live passwordResetExpiry window (10 min)",       "auth"),
    ("Old password", "Never required or checked",                     "error"),
    ("Auto-login", "None — the user must log in again",                "error"),
])
d.note_box(882, 276, 516, 168, "Window can lapse mid-flow", [
    "A user who verifies the OTP but is slow to submit the new password is bounced "
    "back to Forgot Password with a generic \"Verification expired\" message.",
], "error")

t = [
    o.card(0, R1, "ui", "layout", "01", "New Password Form", "ResetPassword.js",
           "Length >= 8 and match, checked live."),
    o.card(1, R1, "backend", "send", "02", "Request", "POST /auth/reset-password",
           "{ email, password }."),
    o.card(2, R1, "auth", "shield", "03", "Rate Limiter", "authLimiter",
           "Shared budget with all 5 other auth routes."),
    o.card(3, R1, "database", "database", "04", "User Lookup + Verified", "404 / 403",
           "Same guards as every other auth route."),
    o.card(4, R1, "auth", "gauge", "05", "Window Checked", "isPasswordReset + expiry",
           "403 if missing or lapsed."),
    o.card(5, R1, "database", "key", "06", "Password Hashed", "bcrypt · 10 rounds",
           "Same helper as signup."),
    o.card(6, R1, "database", "save", "07", "Flags Cleared", "isPasswordReset: false",
           "The window is single-use."),
    o.card(7, R1, "response", "send", "08", "200 OK", "back to Login",
           "No token — a fresh login is required."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "No auto-login",
           ["A successful reset does not", "sign the user in — see", "AUTH-API-02 for the next step."])
d.path([(t[7].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Depends entirely on AUTH-API-03's reset branch having already granted the "
                  "10-minute passwordResetExpiry window."],
                 "AUTH-API-06"),
     "auth-api-06-reset-password-overview.svg")


# ===========================================================================
# AUTH-FLOW-01 — JWT validation on protected requests
# ===========================================================================
o = new("Validating a JWT on a protected request",
        "Quick overview · follow 01 → 08 · full detail in auth-flow-01-protected-request-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Applies to", "Every /api, /expense, /bills, /ml, /report, /chart, /income route", "auth"),
    ("Not applied to", "/auth itself — those 6 routes carry no token",                 "error"),
    ("DB re-check", "None — the middleware never queries MongoDB",                     "error"),
    ("Identity source", "req.userId, set once from the token's _id claim",             "auth"),
])
d.note_box(882, 276, 516, 168, "Decoded claims are trusted, not re-verified", [
    "A deleted user's still-unexpired token verifies successfully here — user "
    "existence is never re-checked. Downstream queries simply match nothing.",
], "error")

t = [
    o.card(0, R1, "frontend", "refresh", "01", "Frontend API Call", "shared axios instance",
           "Any query or mutation hook."),
    o.card(1, R1, "frontend", "key", "02", "Token Attached", "request interceptor",
           "Authorization: Bearer <token>, if present."),
    o.card(2, R1, "auth", "shield", "03", "Header Checked", "verifyToken",
           "Missing/malformed header → 401 immediately."),
    o.card(3, R1, "auth", "key", "04", "Signature + Expiry", "jwt.verify",
           "Wrong secret or bad shape → 401."),
    o.card(4, R1, "auth", "gauge", "05", "Payload Checked", "decoded._id required",
           "401 \"Invalid token payload\" if absent."),
    o.card(5, R1, "backend", "user-check", "06", "Identity Set", "req.userId = decoded._id",
           "No database lookup at this step."),
    o.card(6, R1, "database", "database", "07", "Scoped Query", "e.g. { userId: req.userId }",
           "Every controller filters by this value."),
    o.card(7, R1, "response", "send", "08", "200 OK", "user-owned data only",
           "Same shape as an unprotected response."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "One middleware, every module",
           ["The same verifyToken function", "is reused unmodified across", "all seven protected routers."])
d.path([(t[7].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["This is an internal flow, not an endpoint — it runs inside every "
                  "protected request already documented in the other six modules."],
                 "AUTH-FLOW-01"),
     "auth-flow-01-protected-request-overview.svg")


# ===========================================================================
# AUTH-FLOW-02 — Frontend session restoration
# ===========================================================================
o = new("Session restoration on app startup",
        "Quick overview · follow 01 → 07 · full detail in auth-flow-02-session-restoration-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Checked",    "Only whether a \"token\" key exists in localStorage",              "frontend"),
    ("Not checked", "The token is never decoded, never expiry-checked, locally",       "error"),
    ("No AuthContext", "Auth state is plain useState in App.js — no provider exists",  "error"),
    ("No route guards", "One boolean gates the entire authenticated app tree",         "error"),
])
d.note_box(882, 276, 516, 168, "\"Logged in\" means only \"a token string exists\"", [
    "Frontend-considered-authenticated and backend-verified identity are two different "
    "things here — the first protected request is the first real check.",
], "error")

t = [
    o.card(0, R1, "ui", "layout", "01", "App Mounts", "2 s splash screen",
           "SplashScreen renders first, unconditionally."),
    o.card(1, R1, "frontend", "database", "02", "Token Lookup", "localStorage.getItem",
           "Presence check only — no parsing."),
    o.card(2, R1, "error", "alert", "03", "No Local Decode", "confirmed absent",
           "No jwt-decode or equivalent anywhere in the frontend."),
    o.card(3, R1, "frontend", "gauge", "04", "isLoggedIn Set", "token ? true : false",
           "The entire authenticated-state decision."),
    o.card(4, R1, "ui", "layout", "05", "Render Gate", "App.js conditional",
           "Login/SignUp vs BrowserRouter + LandingPage."),
    o.card(5, R1, "frontend", "refresh", "06", "First Protected Call", "any query hook",
           "The real identity check happens here, not earlier."),
    o.card(6, R1, "auth", "shield", "07", "Backend Accepts or Rejects", "verifyToken",
           "A 401 here routes to AUTH-FLOW-04, not back to restoration."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "Stale token still \"restores\"",
           ["An expired or deleted-user", "token still flips isLoggedIn", "true until the first request."])
d.path([(t[6].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["No route in this app is individually guarded. Everything past the "
                  "isLoggedIn boolean is equally reachable or equally hidden."],
                 "AUTH-FLOW-02"),
     "auth-flow-02-session-restoration-overview.svg")


# ===========================================================================
# AUTH-FLOW-03 — Logout
# ===========================================================================
o = new("Logout — client-only session teardown",
        "Quick overview · follow 01 → 06 · full detail in auth-flow-03-logout-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Backend endpoint", "None — logout is entirely client-side",                     "error"),
    ("Server-side revocation", "Does not exist — the JWT remains valid until secret rotation", "error"),
    ("localStorage.clear()", "Wipes everything, not just the token",                  "frontend"),
    ("queryClient.clear()",  "Empties the whole TanStack cache — prevents the next login on this tab from seeing stale data", "insights"),
])
d.note_box(882, 276, 516, 168, "State change, not a page reload", [
    "Unlike AUTH-FLOW-04's forced reauth, manual logout does not call "
    "window.location.replace — it flips React state and lets App.js re-render.",
], "insights")

t = [
    o.card(0, R1, "ui", "cursor", "01", "Logout Clicked", "LandingPage.js",
           "Header and mobile-menu both call the same handler."),
    o.card(1, R1, "frontend", "database", "02", "localStorage Cleared", "localStorage.clear()",
           "Removes the token and any other stored keys."),
    o.card(2, R1, "frontend", "refresh", "03", "Query Cache Cleared", "queryClient.clear()",
           "No user-scoped data survives in memory."),
    o.card(3, R1, "ui", "alert", "04", "Toast Shown", "\"Logged out successfully\"",
           "Confirms the action to the user."),
    o.card(4, R1, "frontend", "gauge", "05", "State Flipped", "isLoggedIn = false",
           "setIsLogout(true) also guards the restoration effect."),
    o.card(5, R1, "ui", "layout", "06", "Login Screen", "no reload",
           "App.js re-renders past the gate the other direction."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "No server call at all",
           ["If a backend logout endpoint", "existed, this is where it", "would be invoked — none does."])
d.path([(t[5].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Logout cannot fail because the backend is unavailable — every step is "
                  "local, so there is nothing to retry or time out."],
                 "AUTH-FLOW-03"),
     "auth-flow-03-logout-overview.svg")


# ===========================================================================
# AUTH-FLOW-04 — Expired / invalid token handling
# ===========================================================================
o = new("401 handling — forced reauth after a rejected token",
        "Quick overview · follow 01 → 07 · full detail in auth-flow-04-expired-token-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Trigger", "Any 401 response, from any of the seven protected routers",           "error"),
    ("Handler", "api.js response interceptor → handleApiError → forceReauth",          "frontend"),
    ("Cleanup", "localStorage.clear() + queryClient.clear() — identical to AUTH-FLOW-03", "frontend"),
    ("Navigation", "window.location.replace(\"/\") — a hard reload, not a React route change", "error"),
])
d.note_box(882, 276, 516, 168, "Every 401 redirects independently", [
    "Several protected calls can fail 401 at once (e.g. on a slow reconnect); each one "
    "independently calls forceReauth, which is idempotent but can fire more than once.",
], "error")

t = [
    o.card(0, R1, "database", "alert", "01", "401 Returned", "any protected route",
           "Expired token, bad signature, or missing header."),
    o.card(1, R1, "frontend", "refresh", "02", "Response Interceptor", "api.js",
           "Runs for every axios call through the shared instance."),
    o.card(2, R1, "frontend", "gears", "03", "handleApiError", "status === 401",
           "Routes to forceReauth; returns true to short-circuit callers."),
    o.card(3, R1, "frontend", "database", "04", "Storage Wiped", "localStorage.clear()",
           "Same call as manual logout."),
    o.card(4, R1, "frontend", "refresh", "05", "Cache Wiped", "queryClient.clear()",
           "No previous user's data persists."),
    o.card(5, R1, "ui", "layout", "06", "Hard Redirect", "location.replace(\"/\")",
           "Full remount, not a client-side route change."),
    o.card(6, R1, "ui", "layout", "07", "Login Shown", "isLoggedIn starts false",
           "The remounted App.js finds no token."),
]
o.chain(t, o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "No distinction by cause",
           ["Expired, malformed, wrong-", "secret and missing-token 401s", "all trigger the identical path."])
d.path([(t[6].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["A raw fetch call bypassing the shared axios instance (as Login.js, SignUp.js "
                  "and the password-reset forms all do) would not trigger this path at all — but "
                  "none of those forms sends a token, so none can receive an auth-related 401."],
                 "AUTH-FLOW-04"),
     "auth-flow-04-expired-token-overview.svg")
