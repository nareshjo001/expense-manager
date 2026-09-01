"""
Level 2 detailed diagrams for the Authentication module — one file, ten outputs.

Corrected classification: verify-otp, resend-otp, forgot-password and reset-password
are each their own API workflow now (AUTH-API-03..06), not folded into combined flow
documents. Four genuinely internal/frontend flows remain, renumbered AUTH-FLOW-01..04:
protected-request JWT validation, frontend session restoration, client-side logout,
and 401/force-reauth handling.

Every card is traced to source: backend/Routes/auth.routes.js, backend/Controllers/
AuthControllers/*, backend/Services/AuthServices/*, backend/Middlewares/Auth.js and
AuthValidation.js, backend/config/Schemas.js (userSchema), and on the frontend
App.js, Login.js, SignUp.js, OTPForm.js, the two passwordReset components,
LandingPage.js's handleLogout, api/axios.js, and api/handleApiError.js.

Nothing here draws a mechanism the repository doesn't have: no AuthContext, no
protected-route component, no frontend JWT decoding, no refresh token, no server-side
logout.

Run:  python3 build_auth_detailed.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH, CW = L["firstCardY"], L["cardPitch"], L["cardWidth"]
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]
GUTTER = (894, 902, 910, 918, 926, 934)

FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light "
        "arrows are steps inside a region. Absent mechanisms — a refresh token, a "
        "server session, frontend JWT decoding — are named in a note, never drawn as "
        "implemented steps.")


def base(title, subtitle, labels):
    d = Diagram(T, title=title, subtitle=subtitle)
    r = [d.region(x, w, lab, sub, accent=accent, step=i + 1)
         for i, (x, w, lab, sub, accent) in enumerate(labels)]
    return d, r


def col(region, i):
    return region.card_x, Y0 + i * PITCH


def stack(d, region, specs, start=0):
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(*col(region, start + i), kind, icon, kicker, stage, impl,
                           purpose, **extra))
    for a, b in zip(made, made[1:]):
        d.flow_down(a, b)
    return made


def band(d, cards):
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                     "Exceptions and Current Limitations")
    return [d.exception_card(BX[i], BY, BW, BH, *c) for i, c in enumerate(cards)]


def refs(d, pairs):
    for pt, rail, gi, tgt, enter in pairs:
        y = GUTTER[gi]
        if enter == "left":
            d.path([pt, (rail, pt[1]), (rail, y), (28, y), (28, tgt.cy), (tgt.x, tgt.cy)],
                   "error", dashed=True)
        elif enter == "top-offset":
            d.path([pt, (rail, pt[1]), (rail, y), (400, y), (400, tgt.y)],
                   "error", dashed=True)
        else:
            d.path([pt, (rail, pt[1]), (rail, y), (tgt.cx, y), (tgt.cx, tgt.y)],
                   "error", dashed=True)


def finish(d, out, api_id, tail):
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left="docs/api-workflows · %s · Level 2 detailed" % api_id,
                   footer_notes=[FOOT, tail])
    folders = {
        "auth-api-01": "signup", "auth-api-02": "login",
        "auth-api-03": "verify-otp", "auth-api-04": "reset-otp",
        "auth-api-05": "forgot-password", "auth-api-06": "reset-password",
        "auth-flow-01": os.path.join("flows", "protected-request-flow"),
        "auth-flow-02": os.path.join("flows", "frontend-session-restore-flow"),
        "auth-flow-03": os.path.join("flows", "logout-flow"),
        "auth-flow-04": os.path.join("flows", "expired-token-flow"),
    }
    folder = next(folder for prefix, folder in folders.items() if out.startswith(prefix))
    path = os.path.join(folder, out)
    open(os.path.join(HERE, path), "w", encoding="utf-8").write(svg)
    print("wrote", path, len(svg))


def final_region(d, region, title_specs, note):
    """A plain final region: up to 3 stacked cards plus a note box, no dual sub-columns."""
    made = stack(d, region, title_specs)
    ny = made[-1].bottom + 16
    nh = region.y + region.h - ny - 20
    d.note_box(region.card_x, ny, region.w - 2 * L["regionPaddingX"], max(nh, 120),
              *note)
    return made


# ===========================================================================
# AUTH-API-01 — Register
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /auth/signup — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 9 stages in "
    "auth-api-01-register-overview.svg",
    [(20, 272, "User & Signup Form", "Client-checked, not yet an account", "ui"),
     (306, 272, "Rate Limiter & Validation", "IP-keyed, shared with 5 routes", "auth"),
     (592, 272, "Existing-user Lookup", "Verified vs. unverified branch", "database"),
     (878, 272, "Password Hash & OTP", "Computed before any write", "database"),
     (1164, 496, "Save, Email & Response", "No session issued here", "response")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Signup Form", "SignUp.js",
     "fullName/email/password, controlled inputs.", {"step": "01"}),
    ("ui", "gauge", "VALIDATION", "Client Checks", "validateForm()",
     "Non-empty name, email regex, password >= 8 chars.", {"step": "01", "tag": "E4"}),
    ("ui", "cursor", "GUARD", "Submit Disabled", "isFetching",
     "The only duplicate-click protection on this form.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "RATE LIMIT", "authLimiter", "20 req / 15 min, IP-keyed",
     "Shared budget with login and all 4 OTP routes.", {"step": "02", "tag": "E1"}),
    ("backend", "gears", "JOI SCHEMA", "signupValidation", ".unknown(true)",
     "Extra body fields pass through uninspected.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "database", "MONGODB", "findOne({ email })", "case-sensitive",
     "No .toLowerCase() or schema lowercase anywhere.", {"step": "03", "tag": "E2"}),
    ("backend", "gears", "BRANCH", "Verified?", "user && user.isVerified",
     "True -> 409. False/absent -> continue.", {"step": "03"}),
])
e = stack(d, r4, [
    ("database", "key", "BCRYPT", "hashPassword()", "10 salt rounds",
     "Computed before the document is touched.", {"step": "04"}),
    ("database", "sigma", "OTP", "generateOTP() + hashOTP()", "crypto.randomInt, sha256",
     "6 digits, 5-minute expiry, hashed at rest.", {"step": "04"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "either branch writes",
                   [("new UserModel(...)", "brand-new signup"),
                    ("user.save() (reused doc)", "unverified re-registration")])
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0 = d.card(r5.card_x, Y0, "database", "save", "TTL WRITE", "verificationExpiresAt",
            "MongoDB TTL index, expireAfterSeconds: 0",
            "The whole document self-deletes if unverified past 10 min.",
            w=r5.w - 2 * L["regionPaddingX"], step="05", tag="E5")
f1 = d.card(r5.card_x, f0.bottom + 14, "backend", "send", "EMAIL", "sendOTPEmail()",
            "Brevo transactional API",
            "Plaintext OTP in the email body; failure here throws to the catch-all 500.",
            w=r5.w - 2 * L["regionPaddingX"], step="06")
f2 = d.card(r5.card_x, f1.bottom + 14, "response", "send", "RESPONSE", "201 Created",
            "No token in the body",
            "\"Registered successfully. Verify OTP to continue.\"",
            w=r5.w - 2 * L["regionPaddingX"], step="07")
d.flow_down(f0, f1); d.flow_down(f1, f2)
d.handoff(e[0], f0, e[0].right + 14, entry_x=f0.right - 26)

x = band(d, [
    ("E1", "Shared Rate Budget", "authLimiter, one bucket",
     "All 6 auth routes draw from the same 20-per-15-min IP bucket. A burst of OTP "
     "resends can exhaust the budget a legitimate login attempt would have used."),
    ("E2", "Case-variant Duplicates Possible", "no lowercase/trim",
     "\"User@Test.com\" and \"user@test.com\" are different Mongo documents — the "
     "unique index is case-sensitive and nothing normalizes either side."),
    ("E3", "Concurrent Signup Race", "findOne then save, not atomic",
     "Two simultaneous signups for the same new email can both pass the findOne "
     "check; the loser's save() throws a Mongo E11000 duplicate-key error, caught "
     "generically as a 500 rather than a clear 409."),
    ("E4", "Frontend/Backend Validation Mismatch", "SignUp.js vs. signupValidation",
     "The client only checks fullName is non-empty; Joi requires 4-15 characters. A "
     "1-3 character name passes the client and is rejected server-side."),
    ("E5", "Unverified Accounts Self-delete", "verificationExpiresAt TTL",
     "Confirmed by reading the schema: an account that never completes OTP "
     "verification within 10 minutes is deleted by MongoDB itself, not by app code."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((b[0].right, b[0].cy), 580, 0, "left"),
    ((c[0].right, c[0].cy), 866, 1, "top-offset"),
    ((f0.right, f0.cy), 1584, 2, "top"),
    ((a[1].right, a[1].cy), 852, 3, "left"),
    ((f0.cx, f0.y), f0.cx, 4, "top"),
])])
finish(d, "auth-api-01-register-detailed.svg", "AUTH-API-01",
       "A successful signup never signs the user in — see AUTH-API-03 for what "
       "happens next, and AUTH-API-02 for the first real login.")


# ===========================================================================
# AUTH-API-02 — Login
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /auth/login — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 9 stages in "
    "auth-api-02-login-overview.svg",
    [(20, 272, "User & Login Form", "No client validation, no disabled state", "ui"),
     (306, 272, "Rate Limiter & Validation", "Shared authLimiter budget", "auth"),
     (592, 272, "Credential Verification", "Lookup, compare, verified-gate", "database"),
     (878, 272, "JWT Signing", "Bounded expiry, no refresh token", "auth"),
     (1164, 496, "Response, Storage & App Gate", "The entire session in one field", "response")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Login Form", "Login.js",
     "email + password, raw fetch (not the axios instance).", {"step": "01"}),
    ("error", "alert", "NO GUARD", "No Disabled State", "handleSubmit",
     "Nothing blocks a second click while a request is in flight.", {"step": "01", "tag": "E5"}),
])
b = stack(d, r2, [
    ("auth", "shield", "RATE LIMIT", "authLimiter", "20 req / 15 min, IP-keyed",
     "Same shared bucket as signup and OTP routes.", {"step": "02"}),
    ("backend", "gears", "JOI SCHEMA", "loginValidation", "email format, 8-25 char password",
     ".unknown(true) — extra fields pass through.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "database", "MONGODB", "findOne({ email })", "case-sensitive",
     "404 \"User not found\" if no match.", {"step": "03", "tag": "E1"}),
    ("database", "key", "BCRYPT", "comparePassword()", "bcrypt.compare",
     "401 \"Invalid Password\" on mismatch.", {"step": "04", "tag": "E1"}),
    ("backend", "gears", "GATE", "isVerified check", "403 if false",
     "\"Account not verified. Sign Up Again.\"", {"step": "05", "tag": "E1"}),
])
e = stack(d, r4, [
    ("auth", "key", "JWT", "issueAccessToken(payload)", "JWT_EXPIRES_IN / 15m default",
     "Payload is { email, _id }; jwt.sign always receives expiresIn.", {"step": "06", "tag": "E2"}),
    ("auth", "gauge", "EXPIRY", "exp claim", "bounded token lifetime",
     "Invalid or non-positive configuration fails closed; no non-expiring fallback.",
     {"step": "06", "tag": "E2"}),
])

f0 = d.card(r5.card_x, Y0, "response", "send", "RESPONSE", "200 OK",
            "token, email, firstname",
            "The entire authenticated session is this one JSON body.",
            w=r5.w - 2 * L["regionPaddingX"], step="07")
f1 = d.card(r5.card_x, f0.bottom + 14, "frontend", "database", "STORAGE", "localStorage.setItem",
            "key \"token\", plaintext",
            "No HttpOnly cookie option exists in this codebase.",
            w=r5.w - 2 * L["regionPaddingX"], step="08", tag="E3")
f2 = d.card(r5.card_x, f1.bottom + 14, "ui", "layout", "APP GATE", "isLoggedIn = true",
            "App.js re-renders",
            "BrowserRouter + LandingPage replace the Login/SignUp screens.",
            w=r5.w - 2 * L["regionPaddingX"], step="09")
d.flow_down(f0, f1); d.flow_down(f1, f2)
d.handoff(e[0], f0, e[0].right + 14, entry_x=f0.right - 26)
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

x = band(d, [
    ("E1", "Three Distinguishable, User-revealing Errors", "404 / 401 / 403",
     "\"User not found\", \"Invalid Password\" and \"Account not verified\" each say "
     "something different — an attacker can enumerate which emails exist and which "
     "are verified without ever guessing a password."),
    ("E2", "No Refresh, Rotation, or Revocation", "bounded expiry only",
     "issueAccessToken always supplies an expiry (JWT_EXPIRES_IN, 15m by default). "
     "There is still no refresh token, rotation, or server-side revocation list."),
    ("E3", "Plaintext Token in localStorage", "no HttpOnly cookie",
     "Any script that can execute in this origin (e.g. via a future XSS bug) can "
     "read the token directly. This is a real exposure only if such a bug exists "
     "elsewhere — it is not itself an exploit."),
    ("E4", "Deleted User's Token Still Verifies", "no DB re-check downstream",
     "See AUTH-FLOW-01 — the middleware that accepts this token on every later "
     "request never re-queries Mongo for the user's continued existence."),
    ("E5", "No Duplicate-submit Protection", "no disabled state on the button",
     "Unlike SignUp's isFetching-disabled button, Login's submit can be clicked "
     "repeatedly, firing one authLimiter-counted request per click."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 866, 0, "top-offset"),
    ((e[1].right, e[1].cy), 1146, 1, "top"),
    ((f1.right, f1.cy), 1584, 2, "top"),
    ((f1.cx, f1.bottom), f1.cx, 3, "top"),
    ((a[1].right, a[1].cy), 852, 4, "left"),
])])
finish(d, "auth-api-02-login-detailed.svg", "AUTH-API-02",
       "Every later protected request trusts this token's claims without re-checking "
       "them against the database — see AUTH-FLOW-01.")


# ===========================================================================
# AUTH-API-03 — Verify OTP
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /auth/verify-otp — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 8 stages in "
    "auth-api-03-verify-otp-overview.svg",
    [(20, 272, "OTP Entry", "Two different UIs, one endpoint", "ui"),
     (306, 272, "Rate Limiter & Lookup", "Shared authLimiter budget", "auth"),
     (592, 272, "Hash & Expiry Check", "sha256 compare, 400 on failure", "database"),
     (878, 272, "Branch", "isPasswordReset decides the outcome", "backend"),
     (1164, 496, "Outcome & Response", "Neither branch issues a session", "response")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "OTPForm.js", "signup verification, 6 boxes",
     "Auto-advances focus; paste distributes across boxes.", {"step": "01"}),
    ("ui", "layout", "COMPONENT", "ForgotPassword.js", "password reset, single field",
     "Same endpoint, reached from a different screen.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "RATE LIMIT", "authLimiter", "shared 20/15min budget",
     "Same bucket as signup, login and the other OTP routes.", {"step": "02"}),
    ("database", "database", "MONGODB", "findOne({ email })", "404 if absent",
     "Same lookup shape as every other auth route.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "key", "HASH COMPARE", "hashOTP(otp) === user.otp", "sha256, hex string",
     "400 \"Invalid OTP\" on mismatch.", {"step": "03"}),
    ("auth", "gauge", "EXPIRY", "user.otpExpiry < now", "5-minute window",
     "400 \"OTP has expired\" — distinguished from a wrong code.", {"step": "03"}),
])
e = stack(d, r4, [
    ("backend", "gears", "BRANCH", "isPasswordReset", "boolean on the user document",
     "The sole thing distinguishing the two callers.", {"step": "04", "tag": "E1"}),
])

note = final_region(d, r5, [
    ("database", "save", "SIGNUP BRANCH", "isVerified: true", "clearOtpFields()",
     "otp/otpExpiry/lastOtpSent/verificationExpiresAt all cleared — TTL delete disarmed.",
     {"step": "05"}),
    ("auth", "gauge", "RESET BRANCH", "passwordResetExpiry", "getVerificationExpiry(10)",
     "Opens a 10-minute window for AUTH-API-06 instead.", {"step": "05"}),
    ("response", "send", "RESPONSE", "200 OK", "\"Email verified successfully\"",
     "Identical message text for both branches — no token either way.",
     {"step": "06", "tag": "E2"}),
], ("Never issues a session", [
    "Neither branch signs a JWT. Successful signup verification returns the user to "
    "Login (AUTH-API-02 must still be called); successful reset verification only "
    "unlocks AUTH-API-06.",
], "response"))

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.handoff(e[-1], note[0], e[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "One Endpoint, Two Callers", "isPasswordReset flag",
     "Reused unmodified by both AUTH-API-01's verification step and AUTH-API-05's "
     "reset step — only a boolean on the User document tells the controller which "
     "journey it's serving."),
    ("E2", "sha256, Not bcrypt, for OTPs", "otp.service.js hashOTP",
     "A deliberate difference from password hashing — appropriate for a short-lived, "
     "6-digit, single-use code rather than a long-term secret."),
    ("E3", "No Per-attempt Counter", "bounded only by expiry and authLimiter",
     "A wrong guess does not consume or shorten the OTP's own 5-minute validity — "
     "only the shared rate-limit budget and that expiry bound repeated attempts."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((e[0].right, e[0].cy), 1146, 0, "top"),
    ((note[2].right, note[2].cy), 1584, 1, "top"),
    ((c[0].right, c[0].cy), 866, 2, "top-offset"),
])])
finish(d, "auth-api-03-verify-otp-detailed.svg", "AUTH-API-03",
       "Gates AUTH-API-02: login returns 403 until the signup branch of this endpoint "
       "sets isVerified to true.")


# ===========================================================================
# AUTH-API-04 — Resend OTP
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "POST /auth/resend-otp — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 8 stages in "
    "auth-api-04-resend-otp-overview.svg",
    [(20, 340, "Client Countdown & Request", "Independent of the server's own timer", "ui"),
     (374, 340, "Rate Limiter & Lookup", "Shared authLimiter budget", "auth"),
     (728, 340, "Guards", "Verified check, then cooldown", "backend"),
     (1082, 578, "Reissue & Response", "New code, same 5-min expiry", "response")])

a = stack(d, r1, [
    ("ui", "refresh", "TIMER", "120 s client countdown", "OTPForm.js, unsynced",
     "Independent of the server's own cooldown — see E1.", {"step": "01"}),
    ("backend", "send", "REQUEST", "POST /auth/resend-otp", "{ email }",
     "Only reachable from OTPForm.js's signup-verification screen.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "RATE LIMIT", "authLimiter", "shared 20/15min budget",
     "Same bucket as all 5 other auth routes.", {"step": "02"}),
    ("database", "database", "MONGODB", "findOne({ email })", "404 if absent",
     "Same lookup shape as every other auth route.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "gears", "GUARD", "user.isVerified", "400 if already verified",
     "Resend only makes sense pre-verification.", {"step": "03"}),
    ("auth", "gauge", "COOLDOWN", "canResendOtp()", "120 s server-enforced",
     "429 with the exact seconds remaining if too soon.", {"step": "04", "tag": "E1"}),
])

note = final_region(d, r4, [
    ("database", "save", "REISSUE", "new OTP + expiry", "lastOtpSent updated",
     "verificationExpiresAt TTL is also refreshed.", {"step": "05"}),
    ("backend", "send", "EMAIL", "sendOTPEmail()", "same Brevo helper as signup",
     "Failure here throws to the catch-all 500.", {"step": "06"}),
    ("response", "send", "RESPONSE", "200 OK", "cooldown value returned",
     "Resets the client's own 120 s countdown.", {"step": "07"}),
], ("Signup verification only", [
    "Password reset re-sends never call this route — ForgotPassword.js's own "
    "\"Resend\" action calls POST /auth/forgot-password again instead (see "
    "AUTH-API-05), confirmed by tracing every caller of this endpoint.",
], "insights"))

d.handoff(a[-1], b[0], a[-1].right + 14, entry_x=b[0].right - 26)
d.handoff(b[-1], c[0], b[-1].right + 14, entry_x=c[0].right - 26)
d.handoff(c[-1], note[0], c[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "Two Independent Clocks", "client 120 s vs. server 120 s",
     "A page refresh resets OTPForm's visible countdown to 120 s even if the "
     "server's own cooldown has nearly elapsed — the button can appear disabled "
     "longer than actually required."),
    ("E2", "Shared Rate Budget", "authLimiter, one bucket",
     "Counts against the same 20-per-15-min IP budget as signup, login and every "
     "other OTP/reset route."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((a[0].right, a[0].cy), 690, 0, "left"),
    ((b[0].right, b[0].cy), 690, 1, "left"),
])])
finish(d, "auth-api-04-resend-otp-detailed.svg", "AUTH-API-04",
       "A fresh OTP fully replaces the previous one — the old code stops working "
       "the moment this succeeds, not just after its original expiry.")


# ===========================================================================
# AUTH-API-05 — Forgot Password
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /auth/forgot-password — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 9 stages in "
    "auth-api-05-forgot-password-overview.svg",
    [(20, 272, "Forgot Password Form", "Entry point, from the login screen", "ui"),
     (306, 272, "Rate Limiter & Lookup", "Shared authLimiter budget", "auth"),
     (592, 272, "Guards", "Verified check, then cooldown", "backend"),
     (878, 272, "Reset OTP Issued", "Same shape as signup's OTP", "database"),
     (1164, 496, "Email & Response", "Hands off to AUTH-API-03", "response")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "ForgotPassword.js", "email only, first step",
     "Reachable from Login's \"Forgot Password?\" link.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "RATE LIMIT", "authLimiter", "shared 20/15min budget",
     "Same bucket as every other auth route.", {"step": "02"}),
    ("database", "database", "MONGODB", "findOne({ email })", "404 if absent",
     "Same lookup shape as every other auth route.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "gears", "GUARD", "user.isVerified", "403 if false",
     "Reset is only offered to verified accounts.", {"step": "03", "tag": "E1"}),
    ("auth", "gauge", "COOLDOWN", "canResendOtp()", "120 s server-enforced",
     "429 with seconds remaining if too soon.", {"step": "04"}),
])
e = stack(d, r4, [
    ("database", "sigma", "OTP", "generateOTP() + hashOTP()", "same shape as signup",
     "6 digits, 5-minute expiry, hashed at rest.", {"step": "05"}),
    ("database", "save", "FLAG SET", "isPasswordReset: true", "overwrites any pending signup OTP",
     "Both flows share one otp field on the user document.", {"step": "05", "tag": "E2"}),
])

note = final_region(d, r5, [
    ("backend", "send", "EMAIL", "sendOTPEmail(..., \"reset\")", "same Brevo helper",
     "Distinct subject line from the signup email.", {"step": "06"}),
    ("response", "send", "RESPONSE", "200 OK", "cooldown value returned",
     "Frontend advances to OTP entry (AUTH-API-03).", {"step": "07"}),
], ("Old password never required", [
    "Nothing in this flow asks for or checks the previous password — once the OTP "
    "window opens via AUTH-API-03's reset branch, mailbox possession is the sole "
    "factor for AUTH-API-06.",
], "insights"))

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.handoff(e[-1], note[0], e[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "Enumerates Verified Accounts", "404 vs. 403 vs. 200",
     "Three distinct responses (no account / unverified account / OTP sent) let a "
     "caller determine whether a given email is a verified account on this system — "
     "the same pattern as AUTH-API-02's login errors."),
    ("E2", "Shared OTP Field With Signup Verification", "one otp field, two purposes",
     "A user cannot have a pending signup-verification code and a pending reset "
     "code at the same time — whichever request ran most recently wins."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 866, 0, "top-offset"),
    ((e[1].right, e[1].cy), 1146, 1, "top"),
])])
finish(d, "auth-api-05-forgot-password-detailed.svg", "AUTH-API-05",
       "Depends on AUTH-API-03 for OTP verification and hands off to AUTH-API-06 for "
       "the actual password change.")


# ===========================================================================
# AUTH-API-06 — Reset Password
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /auth/reset-password — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 8 stages in "
    "auth-api-06-reset-password-overview.svg",
    [(20, 272, "New Password Form", "Client length/match check, live", "ui"),
     (306, 272, "Rate Limiter & Lookup", "Shared authLimiter budget", "auth"),
     (592, 272, "Window Check", "isPasswordReset + expiry", "auth"),
     (878, 272, "Password Hash", "Same bcrypt helper as signup", "database"),
     (1164, 496, "Cleanup & Response", "No auto-login", "response")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "ResetPassword.js", "new + confirm password",
     "Length >= 8 and match, re-validated on every keystroke.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "RATE LIMIT", "authLimiter", "shared 20/15min budget",
     "Same bucket as every other auth route.", {"step": "02"}),
    ("database", "database", "MONGODB", "findOne({ email })", "404 / 403 guards",
     "Same lookup + verified-check shape as every other route.", {"step": "02"}),
])
c = stack(d, r3, [
    ("auth", "gauge", "WINDOW CHECK", "isPasswordReset && passwordResetExpiry > now",
     "403 if either is missing or lapsed",
     "\"Password reset not authorized. Please verify OTP again.\"",
     {"step": "03", "tag": "E1"}),
])
e = stack(d, r4, [
    ("database", "key", "BCRYPT", "hashPassword()", "10 salt rounds",
     "Same helper as signup and used nowhere else.", {"step": "04"}),
])

note = final_region(d, r5, [
    ("database", "save", "CLEANUP", "flags cleared", "isPasswordReset: false",
     "passwordResetExpiry unset — the window is single-use.", {"step": "05"}),
    ("response", "send", "RESPONSE", "200 OK, back to Login", "no token",
     "The user must log in again with the new password (AUTH-API-02).",
     {"step": "06", "tag": "E2"}),
], ("Window can lapse mid-flow", [
    "A user who verifies via AUTH-API-03 but is slow to submit here is bounced back "
    "to Forgot Password with a generic \"expired\" message — the OTP itself cannot "
    "be reused to retry; the whole journey restarts from AUTH-API-05.",
], "error"))

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.handoff(e[-1], note[0], e[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "Window Is the Only Authorization", "no password re-entry",
     "Possession of a live passwordResetExpiry window (opened by AUTH-API-03) is "
     "the sole factor — the previous password is never asked for or checked."),
    ("E2", "No Auto-login After Reset", "same pattern as AUTH-API-01",
     "A successful reset never signs the user in — consistent with signup and OTP "
     "verification, none of which issue a session."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 1146, 0, "top"),
    ((note[1].right, note[1].cy), 1584, 1, "top"),
])])
finish(d, "auth-api-06-reset-password-detailed.svg", "AUTH-API-06",
       "The last step of the password-reset journey: AUTH-API-05 opens it, "
       "AUTH-API-03 authorizes it, this endpoint completes it.")


# ===========================================================================
# AUTH-FLOW-01 — JWT validation on protected requests
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "JWT validation on protected requests — detailed implementation workflow",
    "Level 2 · internal middleware, no endpoint of its own · badges map to the 8 "
    "stages in auth-flow-01-protected-request-overview.svg",
    [(20, 272, "Frontend API Call", "Any TanStack Query hook", "frontend"),
     (306, 272, "Token Attachment", "Request interceptor, unconditional", "frontend"),
     (592, 272, "Header & Signature", "Bearer format, then jwt.verify", "auth"),
     (878, 272, "Payload & Identity", "req.userId, no database check", "auth"),
     (1164, 496, "Scoped Query & Response", "Every module reuses this exact chain", "response")])

a = stack(d, r1, [
    ("frontend", "refresh", "HOOK", "any query/mutation", "e.g. useReport, useAddExpenseMutation",
     "All seven protected routers are called this way.", {"step": "01"}),
])
b = stack(d, r2, [
    ("frontend", "key", "INTERCEPTOR", "api.js request interceptor", "unconditional",
     "Attaches Authorization: Bearer <token> if one exists in localStorage.",
     {"step": "02"}),
])
c = stack(d, r3, [
    ("auth", "shield", "FORMAT CHECK", "verifyToken", "authHeader.startsWith(\"Bearer \")",
     "401 \"Authorization token missing\" if absent or wrong scheme.", {"step": "03"}),
    ("auth", "key", "SIGNATURE", "jwt.verify(token, JWT_SECRET)", "throws on bad sig/shape",
     "\"none\" algorithm is rejected by the library's default allow-list.",
     {"step": "04", "tag": "E4"}),
])
e = stack(d, r4, [
    ("auth", "gauge", "PAYLOAD CHECK", "decoded._id required", "401 if absent",
     "\"Invalid token payload\" — the only shape validation performed.",
     {"step": "05", "tag": "E1"}),
    ("backend", "user-check", "IDENTITY SET", "req.userId = decoded._id", "no DB call",
     "Mongo is never queried here — see E2.", {"step": "06", "tag": "E2"}),
])

note = final_region(d, r5, [
    ("database", "database", "SCOPED QUERY", "e.g. { userId: req.userId }", "every controller",
     "Confirmed by grep: no controller reads a body/query-supplied userId instead.",
     {"step": "07", "tag": "E3"}),
    ("response", "send", "RESPONSE", "200 OK", "user-owned data only",
     "Identical response shape to an unprotected endpoint would produce.",
     {"step": "08"}),
], ("One middleware, every module", [
    "The same verifyToken function (backend/Middlewares/Auth.js) is imported "
    "unmodified by api.routes.js, expense.routes.js, bill.routes.js, income.routes.js, "
    "chart.routes.js, report.routes.js and ml.router.js.",
    "No module defines its own auth middleware or checks a different claim.",
], "auth"))

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.handoff(e[-1], note[0], e[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "No Type Validation on the Identity Claim", "decoded._id truthy-checked only",
     "Verified by execution: a forged token (which requires already knowing "
     "JWT_SECRET) with _id as a non-string value still passes this check and is "
     "assigned to req.userId as-is — bounded in practice because only the server's "
     "own signing code ever produces a token, and it always signs a real ObjectId."),
    ("E2", "Identity Is Never Re-verified Against the Database", "no findById here",
     "A deleted user's still-unexpired token verifies successfully. Downstream "
     "queries scoped by that userId simply match zero documents — not a cross-"
     "account read, but the token itself is never invalidated."),
    ("E3", "Consistent Ownership Scoping Confirmed", "28 controller files grepped",
     "No controller anywhere reads req.body.userId, req.query.userId or "
     "req.params.userId in place of req.userId — recorded as a positive finding."),
    ("E4", "Algorithm Confusion Correctly Rejected", "jsonwebtoken default allow-list",
     "Verified by execution: a hand-crafted alg:\"none\" token is rejected, not "
     "accepted — this codebase relies on the library's default behaviour rather "
     "than an explicit algorithms: [\"HS256\"] option."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((e[0].right, e[0].cy), 1146, 0, "top"),
    ((e[1].right, e[1].cy), 1146, 1, "top"),
    ((note[0].right, note[0].cy), 1584, 2, "top"),
    ((c[1].right, c[1].cy), 866, 3, "top-offset"),
])])
finish(d, "auth-flow-01-protected-request-detailed.svg", "AUTH-FLOW-01",
       "This internal flow underlies every protected endpoint already documented in "
       "the Expense, Budget, Income, Charts, Bills and Report modules.")


# ===========================================================================
# AUTH-FLOW-02 — Frontend session restoration
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "Session restoration on app startup — detailed implementation workflow",
    "Level 2 · no AuthContext, no local decode · badges map to the 7 stages in "
    "auth-flow-02-session-restoration-overview.svg",
    [(20, 272, "App Mounts", "Splash screen first, unconditionally", "ui"),
     (306, 272, "Token Presence Check", "localStorage only, no parsing", "frontend"),
     (592, 272, "Auth State Decision", "A single boolean, no provider", "frontend"),
     (878, 272, "Render Gate", "App.js conditional JSX", "ui"),
     (1164, 496, "First Real Check", "Backend acceptance or 401 cleanup", "response")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "SplashScreen", "2-second timer",
     "Renders unconditionally before any auth check runs.", {"step": "01"}),
])
b = stack(d, r2, [
    ("frontend", "database", "LOOKUP", "localStorage.getItem(\"token\")", "presence only",
     "The value is never parsed, decoded or type-checked.", {"step": "02", "tag": "E1"}),
    ("error", "alert", "ABSENT STEP", "No local decode", "confirmed absent",
     "No jwt-decode or equivalent import exists anywhere in the frontend.",
     {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("frontend", "gauge", "STATE", "isLoggedIn = !!token && !isLogout", "plain useState",
     "No AuthContext or provider exists — this lives in App.js directly.",
     {"step": "03", "tag": "E2"}),
])
e = stack(d, r4, [
    ("ui", "layout", "GATE", "App.js JSX branch", "Login/SignUp vs. LandingPage",
     "One boolean gates the entire authenticated app tree.", {"step": "04", "tag": "E3"}),
])

note = final_region(d, r5, [
    ("frontend", "refresh", "FIRST CALL", "any protected query hook", "e.g. dashboard data",
     "The real identity check happens here — see AUTH-FLOW-01.", {"step": "05"}),
    ("auth", "shield", "BACKEND VERDICT", "verifyToken", "accept or 401",
     "A 401 here hands off to AUTH-FLOW-04, not back to this flow.", {"step": "06"}),
], ("\"Logged in\" here means only \"a token string exists\"", [
    "Frontend-considered-authenticated and backend-verified-identity are two "
    "different facts. An expired, malformed, or deleted-user token still flips "
    "isLoggedIn to true — this flow cannot detect any of those cases.",
    "No individual route inside LandingPage carries its own guard.",
], "error"))

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.handoff(e[-1], note[0], e[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "No Local Validation of Any Kind", "presence check only",
     "Confirmed by grep: no jwt-decode dependency, no manual base64 decode, no "
     "expiry comparison exists on the frontend at all."),
    ("E2", "No AuthContext or Provider", "plain useState in App.js",
     "The prompt's suggested \"auth context/provider\" structure does not exist in "
     "this repository — documented as absent rather than assumed present."),
    ("E3", "No Per-route Protection", "one boolean, no route guards",
     "There is no ProtectedRoute/PrivateRoute component anywhere in the frontend "
     "source — every route inside LandingPage is equally reachable once isLoggedIn "
     "is true, and equally hidden when it is false."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((b[1].right, b[1].cy), 866, 0, "top-offset"),
    ((c[0].right, c[0].cy), 866, 1, "top-offset"),
    ((e[0].right, e[0].cy), 1146, 2, "top"),
])])
finish(d, "auth-flow-02-session-restoration-detailed.svg", "AUTH-FLOW-02",
       "This flow explains application startup; it does not perform authentication "
       "by itself — only AUTH-FLOW-01's first request does.")


# ===========================================================================
# AUTH-FLOW-03 — Logout
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Logout — detailed implementation workflow",
    "Level 2 · client-only, no backend endpoint · badges map to the 6 stages in "
    "auth-flow-03-logout-overview.svg",
    [(20, 340, "Logout Trigger", "Header and mobile menu, same handler", "ui"),
     (374, 340, "Storage Cleanup", "Everything, not just the token", "frontend"),
     (728, 340, "Cache Cleanup", "The whole TanStack cache", "frontend"),
     (1082, 578, "State Update & Render", "No backend call, no reload", "response")])

a = stack(d, r1, [
    ("ui", "cursor", "TRIGGER", "handleLogout()", "LandingPage.js",
     "Bound to two buttons: header and mobile-settings panel.", {"step": "01"}),
])
b = stack(d, r2, [
    ("frontend", "database", "WIPE", "localStorage.clear()", "entire storage",
     "Removes the token along with any other stored keys.", {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("frontend", "refresh", "WIPE", "queryClient.clear()", "every query family",
     "Prevents the next login on this tab from seeing the previous user's cached data.",
     {"step": "03"}),
])

note = final_region(d, r4, [
    ("ui", "alert", "FEEDBACK", "signUpSuccessToast()", "\"Logged out successfully\"",
     "Confirms the action before the state change takes effect.", {"step": "04"}),
    ("frontend", "gauge", "STATE", "setIsLogout(true); setIsLoggedIn(false)", "React state",
     "isLogout also suppresses App.js's restoration effect on the next render.",
     {"step": "05"}),
    ("ui", "layout", "RENDER", "Login screen shown", "no reload",
     "App.js re-renders in place — a soft transition, not a hard navigation.",
     {"step": "06", "tag": "E2"}),
], ("No backend endpoint exists", [
    "There is no POST /auth/logout route anywhere in auth.routes.js. If one "
    "existed, this is the step that would call it — none does, so the JWT itself "
    "remains valid on another client until its configured expiry or a JWT_SECRET "
    "rotation invalidates it.",
    "Because every step is local, logout cannot fail due to the backend being "
    "unavailable — there is nothing here to retry or time out.",
], "error"))

d.handoff(a[-1], b[0], a[-1].right + 14, entry_x=b[0].right - 26)
d.handoff(b[-1], c[0], b[-1].right + 14, entry_x=c[0].right - 26)
d.handoff(c[-1], note[0], c[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "Clears More Than the Token", "localStorage.clear(), not removeItem",
     "Any other localStorage-backed feature (device-push registration state, "
     "theme preference persisted there, etc.) is wiped alongside the token."),
    ("E2", "Two Different Teardown Mechanisms", "state flip vs. hard reload",
     "This manual logout flips React state and re-renders — no page reload. "
     "AUTH-FLOW-04's forced reauth instead calls window.location.replace(\"/\"), a "
     "full remount. Both reach the same visible end state by different means."),
    ("E3", "No Server-side Revocation", "no logout endpoint",
     "If the same JWT is also stored or cached anywhere else (a second device, a "
     "compromised copy), logging out on this tab has no effect on it."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((b[0].right, b[0].cy), 690, 0, "left"),
    ((note[2].right, note[2].cy), 1584, 1, "top"),
    ((note[2].right, note[2].cy), 1598, 2, "top"),
])])
finish(d, "auth-flow-03-logout-detailed.svg", "AUTH-FLOW-03",
       "Compare directly with AUTH-FLOW-04 — the cleanup steps are nearly identical; "
       "only the trigger and the navigation mechanism differ.")


# ===========================================================================
# AUTH-FLOW-04 — Expired / invalid token handling
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "401 handling — detailed implementation workflow",
    "Level 2 · forced reauth after any rejected token · badges map to the 7 stages "
    "in auth-flow-04-expired-token-overview.svg",
    [(20, 272, "Any Protected Call", "Origin: AUTH-FLOW-01's own middleware", "database"),
     (306, 272, "Response Interceptor", "Runs for every axios call", "frontend"),
     (592, 272, "handleApiError", "Status-code branching", "frontend"),
     (878, 272, "forceReauth Cleanup", "Identical to manual logout", "frontend"),
     (1164, 496, "Hard Redirect & Remount", "Not a client-side route change", "response")])

a = stack(d, r1, [
    ("database", "alert", "401 ORIGIN", "verifyToken", "any of the 7 protected routers",
     "Expired-shaped, malformed, wrong-signature or missing-header token.",
     {"step": "01"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "INTERCEPTOR", "api.js response interceptor", "every call",
     "Registered once on the shared axios instance.", {"step": "02", "tag": "E3"}),
])
c = stack(d, r3, [
    ("frontend", "gears", "DISPATCH", "handleApiError(response)", "status === 401",
     "Also handles 429 (toast) and 409 (conflict callback) — not shown here.",
     {"step": "03"}),
])
e = stack(d, r4, [
    ("frontend", "database", "WIPE", "localStorage.clear()", "entire storage",
     "Same call as AUTH-FLOW-03's manual logout.", {"step": "04"}),
    ("frontend", "refresh", "WIPE", "queryClient.clear()", "every query family",
     "No previous user's cached data survives.", {"step": "05"}),
])

note = final_region(d, r5, [
    ("ui", "layout", "REDIRECT", "window.location.replace(\"/\")", "hard reload",
     "A full browser navigation, not a React Router push/navigate.",
     {"step": "06", "tag": "E1"}),
    ("ui", "layout", "REMOUNT", "App.js from scratch", "isLoggedIn starts false",
     "The remounted instance finds no token and renders Login.", {"step": "07"}),
], ("No distinction by cause", [
    "Expired, malformed, wrong-signature and missing-token 401s all trigger this "
    "identical path — the client cannot tell the user why they were signed out.",
    "A raw fetch call (Login.js, SignUp.js, both password-reset forms) never "
    "carries a token and so can never trigger this path — it is reachable only "
    "through the shared axios instance's protected calls.",
], "error"))

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.handoff(e[-1], note[0], e[-1].right + 14, entry_x=note[0].right - 26)

x = band(d, [
    ("E1", "Hard Reload, Not a Route Change", "window.location.replace",
     "Discards all in-memory React state, not just auth state — any unsaved form "
     "input elsewhere on the page is lost too."),
    ("E2", "Multiple 401s Can Fire Concurrently", "no de-duplication",
     "Several protected calls failing around the same moment (e.g. a slow "
     "reconnect after a token already expired) each independently call "
     "forceReauth; the function is idempotent but the redirect can be invoked more "
     "than once in quick succession."),
    ("E3", "Applies Only to the Shared Axios Instance", "api.js only",
     "Login, SignUp, OTP verification and both password-reset requests use the "
     "browser's raw fetch, bypassing this interceptor entirely — consistent with "
     "the fact that none of those calls carries a token to reject."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((note[0].right, note[0].cy), 1584, 0, "top"),
    ((c[0].right, c[0].cy), 866, 1, "top-offset"),
    ((b[0].right, b[0].cy), 580, 2, "left"),
])])
finish(d, "auth-flow-04-expired-token-detailed.svg", "AUTH-FLOW-04",
       "Shares its cleanup steps with AUTH-FLOW-03 but reaches them from a "
       "completely different, backend-driven trigger.")
