# OPS-004-T07 — Deploy, rollback and smoke test

**Target:** Render (backend web + worker, ML service) · MongoDB Atlas · Upstash Redis · Vercel (frontend)

## What this document is for

`render.yaml` describes the services. This describes the *procedure* — the
order things must happen in, what to check before you believe a deploy
worked, and how to get back if it did not.

It is written to be followed by someone who did not write it, at a bad time.
Every check below has a stated pass condition, because "looks fine" is how a
half-deployed environment gets signed off.

**A note on scope, stated plainly:** completing OPS-004 does not create a
running staging environment. It produces the definitions and the procedure
that make one possible. DAT-003-T07, OBS-001-T07 and TST-001-T07 close only
after someone has actually run the steps below against a real staging deploy
and recorded the results.

---

## 0. Before the first deploy — one-time setup

These are prerequisites, not deploy steps. Doing them under time pressure
during a deploy is how secrets end up wrong.

| # | Thing | Where | Pass condition |
|---|-------|-------|----------------|
| 0.1 | Atlas cluster for the environment | Atlas | Cluster exists; a dedicated database user with `readWrite` on the app database only — not `atlasAdmin` |
| 0.2 | Atlas network access | Atlas → Network Access | Render's outbound IPs allowlisted. `0.0.0.0/0` is **not** acceptable for production; it is tolerable for staging only if the database contains no real user data |
| 0.3 | Upstash Redis database | Upstash | Exists in the **same region** as the Render services. A cross-region Redis turns every cache read into a round trip that is slower than the Mongo query it was meant to avoid |
| 0.4 | Region agreement | Render / Atlas / Upstash | All three in one region. `render.yaml` currently says `singapore` as an *assumption* — confirm it before applying |
| 0.5 | Secrets generated | — | `JWT_SECRET` and `REFRESH_TOKEN_SECRET` each ≥32 chars, **different from each other**, and different per environment. Staging and production must not share secrets, or a staging token is a production token |
| 0.6 | Backup verified | OPS-002 | For production only: a restore has been drilled at least once (`docs/runbooks/OPS-002-T06-restoration-drill.md`). A deploy that can migrate data with no proven restore is a one-way door |

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## 1. Deploy

### 1.1 Pre-flight

```bash
# From a clean checkout of the commit you intend to deploy.
git status --porcelain        # must be empty
git log --oneline -1          # note this SHA — it is your rollback target

cd backend
npm ci
npm test                      # full suite must be green
npm run lint:ci               # 0 errors
```

**Pass condition:** all green, working tree clean, and you have written the
current SHA down somewhere you can find it in a hurry. The single most
common reason a rollback goes badly is not knowing what to roll back *to*.

### 1.2 Apply the blueprint (first time only)

Render → **Blueprints** → **New Blueprint Instance** → point at this repo.

Render will create `balenisa-backend` and `balenisa-worker` and prompt for
every `sync: false` variable. Fill them all — the backend will refuse to
start without the required ones and will tell you which are missing
(OPS-004-T06), which is the intended behaviour, not a failure to work
around.

> **Do not sync the blueprint against the existing production service on
> your first run.** Stand staging up from it, confirm the resulting services
> match what production actually has, then adopt production afterwards. A
> blueprint sync can rewrite env vars and restart a live service, and the
> first run is the worst time to discover which fields differ.

### 1.3 Migrations

Run migrations **before** the new code serves traffic, and from one place
only.

```bash
# In a Render Shell on the web service, or locally with the environment's
# MONGO_CONN and REDIS_URL exported.
node migrations/run.js --dry-run     # read the plan; confirm it is what you expect
node migrations/run.js               # apply
```

The runner takes a Redis-backed lock (DAT-003) so two concurrent deploys
cannot apply the same migration twice. If Redis is unreachable the run
**refuses** rather than proceeding unlocked — that refusal is correct, and
the fix is to restore Redis, not to bypass it.

`--allow-no-backup-check` exists for CI and throwaway databases. Never pass
it against an environment with data you would miss.

**Pass condition:** exit code 0, and the printed result shows the migrations
you expected and no failures.

### 1.4 Deploy the services

Deploy `balenisa-backend` first, then `balenisa-worker`.

That order matters in one direction only: the worker writes (recurring
expenses, push retries) using the same models as the web tier, so the web
tier should already be on the schema the migration produced before jobs
start running against it.

**Pass condition:** both services reach "Live", and Render's health check on
`balenisa-backend` is passing against `/health/ready`.

### 1.5 Frontend

`frontend/vercel.json` rewrites `/backend/*` to a hard-coded Render
hostname. If this deploy created a *new* backend hostname, that file must be
updated and the frontend redeployed, or the frontend will keep talking to
the old backend — which will look like "the deploy did nothing".

---

## 2. Smoke test

Run every check. `$BACKEND` is the service's base URL.

### 2.1 The process is up

```bash
curl -si "$BACKEND/health/live"
```

**Pass:** `200`, body `status: "live"`, and `role` is `"web"`.

If `role` says `"all"` on the web service, `PROCESS_ROLE` did not get set —
that instance is also running the cron jobs, and if you scale it you will
have several instances doing so.

### 2.2 It should receive traffic

```bash
curl -si "$BACKEND/health/ready"
```

**Pass:** `200`, `mongo: "up"`.

`503` here means MongoDB is unreachable. Check `MONGO_CONN` and Atlas
network access (0.2) before anything else — those two account for nearly
every occurrence.

### 2.3 Dependencies are what you think they are

```bash
curl -s "$BACKEND/health/deps" | python -m json.tool
```

**Pass:** `mongo: "up"`. Then read the rest deliberately:

- `redis: "down"` — the app still serves, but caching is off and the
  fail-closed jobs will skip. Not an outage; **do** fix it before calling
  the deploy done, or you will find out weeks later when someone asks why
  recurring expenses stopped.
- `ml: "not_configured"` — `ML_ROUTE` is unset. Intentional or not, decide
  which.
- `ml: "down"` — the ML service is unreachable. Category prediction degrades;
  nothing else does.
- `push: "not_configured"` — no Firebase credentials; notifications are off.

This endpoint returns `200` regardless. That is deliberate — it is a report,
not a gate. Do not attach automation to it.

### 2.4 The worker is alive and owns the jobs

```bash
curl -s "$WORKER/health/live"
```

**Pass:** `200`, `role: "worker"`.

Then, in the worker's logs, confirm the startup line:

```
"event":"server_started" ... "role":"worker","schedulesJobs":true
```

And confirm the web service's equivalent line says `"schedulesJobs":false`.
**If both say `true`, the split did not take effect** and you have two
processes scheduling every job.

### 2.5 Configuration was validated

In either service's logs, near the top of the boot sequence:

```
"event":"config_validated" ... "environment":"production"
```

Immediately after it, `optional_capability_disabled` lists every integration
that is off. Read that list. It is the cheapest possible check that a deploy
has the credentials you meant to give it, and it is printed exactly once per
boot.

### 2.6 The application actually works

```bash
curl -si "$BACKEND/report"            # expect 401 — auth is enforced
curl -si "$BACKEND/ping"              # composite; 503 here only means ML is down
```

Then, in a browser, against the deployed frontend:

1. Log in.
2. Add an expense. Confirm the amount renders as `₹1,234.50` — grouped, two
   decimals, no floating-point tail (DAT-001-T06).
3. Open the monthly report. Confirm it returns `200` and not a 500 — this is
   the divide-by-zero path that used to fail for a user whose first and only
   expense was today.
4. Load a long expense list and page it. Confirm `hasMore`/`nextCursor`
   behave (EXP-003).

**Pass:** all four. If the report 500s, capture the response and the
correlated `requestId` from the logs before rolling back — that error is
much harder to reproduce after the fact.

### 2.7 CORS

From the deployed frontend origin, in the browser console, confirm requests
succeed. A CORS misconfiguration presents as "the app loads but nothing
works", and `CORS_ALLOWED_ORIGINS` is required in production precisely so
this fails loudly at boot rather than quietly in a browser.

---

## 3. Rollback

### 3.1 Decide quickly, and by symptom

| Symptom | Action |
|---|---|
| `/health/ready` returning 503 across all instances | Roll back **now**; diagnose after |
| Errors on a specific route, rest of app fine | Do not roll back yet — capture the `requestId`, check the error aggregator, decide with data |
| Worker not running jobs | Not a rollback. Check `PROCESS_ROLE` and `/health/deps`'s `redis` field |
| Redis down | Not a rollback. The app degrades by design (ADR-0002) |
| ML service down | Not a rollback. Optional capability |

The two rows worth internalising: **a dependency being down is not a reason
to roll back the application**, because the previous version depended on it
too.

### 3.2 Roll back the code

Render → service → **Events** → find the previous deploy → **Rollback**.

Roll back the **web tier first**, then the worker — the reverse of the
deploy order, so the tier that writes on a schedule is never running ahead
of the tier that serves.

**Pass condition:** `/health/live` and `/health/ready` both `200`, and the
running commit matches the SHA you recorded in 1.1.

### 3.3 Migrations do not roll back with the code

This is the part that bites.

A rollback reverts the *code*. It does not revert the *database*. If the
deploy applied a migration, the old code is now running against a newer
schema.

Migrations in this repo follow ADR-0006's **up / verify / forward-fix**
convention: they are written to be additive and backward-compatible, so the
previous version of the code should tolerate the newer schema. "Should" is
doing real work in that sentence — verify it rather than assuming it:

1. Check which migrations this deploy applied (the ledger,
   `backend/migrations/ledger.js`).
2. Read each one. Ask specifically: does the *previous* code still work
   against this schema?
3. If yes — you are done; the rollback stands.
4. If no — **do not hand-edit the database**. Write a forward-fix migration
   and deploy forward. ADR-0006 exists because ad-hoc repair under pressure
   is how data gets lost.

If the migration touched money fields, run the reconciliation script before
declaring the environment healthy:

```bash
node scripts/verifyMoneyMinorFields.js
```

### 3.4 Restore from backup

Last resort, production only, and a different procedure with its own
document: `docs/runbooks/OPS-002-backup-restore-operations.md`. Recovery
objectives are in `docs/decisions/ADR-0005-backup-rpo-rto.md`. Do not
improvise this from memory.

---

## 4. After the deploy

- [ ] Record the deployed SHA and the time.
- [ ] Confirm `optional_capability_disabled` lists only capabilities you
      intended to leave off.
- [ ] Watch `/health/deps` for the first few minutes — `redis` in particular,
      since a cold Upstash connection is the most likely first-hour surprise.
- [ ] Confirm the first scheduled job runs on the **worker** and not on the
      web tier (`retryPush` is the soonest — every 15 minutes).
- [ ] If this was a staging deploy, the T07 verifications
      (DAT-003-T07, OBS-001-T07, TST-001-T07) can now proceed against it.

---

## Environment variable reference

Validated at startup by `backend/config/env.js`. The process refuses to start
if a required variable is missing or malformed, and reports **all** problems
at once rather than one per restart.

### Required in every environment

| Variable | Rule |
|---|---|
| `MONGO_CONN` | `mongodb://` or `mongodb+srv://` URL |
| `JWT_SECRET` | ≥32 characters |
| `REFRESH_TOKEN_SECRET` | ≥32 characters, **must differ from `JWT_SECRET`** |

### Required when `NODE_ENV=production`

| Variable | Rule |
|---|---|
| `CORS_ALLOWED_ORIGINS` | Non-empty. Without it production CORS fails closed and the app is unusable |
| `REDIS_URL` | `redis://` or `rediss://` URL |

### Topology

| Variable | Values | Notes |
|---|---|---|
| `PROCESS_ROLE` | `web` · `worker` · `all` | Unset means `all` — behaviour-preserving for a single-process deploy. A value that is set but unrecognised **fails validation**, because the alternative is a fleet where nothing runs the jobs and every instance looks healthy |
| `PORT` | integer | Defaults to 8080 |
| `NODE_ENV` | | `production` turns on the production-only rules above |

### Optional — absence disables a capability, reported once at startup

`FIREBASE_SERVICE_ACCOUNT` (push) · `BREVO_API_KEY` (email) · `ML_ROUTE` +
`ML_OPERATIONS_TOKEN` (ML) · `SENTRY_DSN` + `ERROR_AGGREGATION_PROVIDER`
(error aggregation) · `BACKUP_ENCRYPTION_KEY` (encrypted backups) ·
`OBS_ALERT_OWNER_EMAIL` (alert routing)

### Tunable, with defaults in code

| Variable | Default | Set in |
|---|---|---|
| `APP_TIME_ZONE` | `Asia/Kolkata` | `backend/sia/config.js` |
| `JWT_EXPIRES_IN` | `15m` | `backend/Services/AuthServices/token.service.js` |
| `REFRESH_SESSION_DAYS` | `30` | `backend/Services/AuthServices/session.service.js` |
| `MONEY_MINOR_DUAL_WRITE_ENABLED` | `false` | `backend/utils/moneyMinorSync.js` — keep false until DAT-001-T06 has soaked and reconciliation agrees |

---

## Health endpoints

| Endpoint | Question | Depends on | Non-200 when | Point automation at it? |
|---|---|---|---|---|
| `/health/live` | Is the process alive? | nothing | never | **Yes** — restart checks |
| `/health/ready` | Should it get traffic? | MongoDB | Mongo unreachable | **Yes** — load balancer, deploy gate |
| `/health/deps` | What is the state of everything? | all, reported | never | **No** — it is a report |
| `/ping` | Are backend *and* ML both up? | ML service | ML unreachable | **No** — see below |

`/ping` returns **503 when the ML service is down**. It predates this work
and is kept unchanged because the frontend and existing monitoring read that
status code. But a platform health check pointed at it will restart a
perfectly healthy backend because an optional service is unavailable — and
restarting the backend cannot bring the ML service back. That is one
degraded dependency turned into two outages. Use `/health/live` and
`/health/ready`.
