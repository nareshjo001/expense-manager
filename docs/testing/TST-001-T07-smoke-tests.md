# TST-001-T07: backup/restore and deployment smoke tests

The task is "add backup/restore and deployment smoke tests". This is what
each half now is, and — more usefully — what each one would actually catch.

## Deployment smoke test

`backend/scripts/smokeTest.js`, run against any base URL:

```bash
node backend/scripts/smokeTest.js --expect-role=web https://your-backend
```

Exit 0 if every required check passed, 1 otherwise, 2 on a usage error.

### What it checks, and what each one catches

| Check | Catches |
|---|---|
| `health.live` | The process is not answering at all |
| `health.ready` | MongoDB unreachable — almost always `MONGO_CONN` or the database's network allowlist |
| `health.deps` | The dependency report itself is broken, so an operator is flying blind |
| `deps.redis` *(advisory)* | Caching off and fail-closed jobs skipping — silent, and usually noticed weeks later as "recurring expenses stopped" |
| `deps.ml` *(advisory)* | ML capability off or unreachable |
| `ping.compat` | `/ping`'s response shape changed, breaking the frontend and existing monitoring |
| `auth.enforced` | **A deploy serving user data without authentication.** If this fails, roll back before diagnosing |
| `obs.requestId.echo` | Correlation IDs not returned, so a user's report cannot be tied to its log lines |
| `obs.requestId.generated` | No ID minted for the majority of traffic that sends none |
| `obs.requestId.hostile` | The log-injection guard is not live in the deployed build |
| `sec.headers` | helmet is not in the middleware chain the code claims |
| `sec.cors` | `CORS_ALLOWED_ORIGINS` wildcarded or misconfigured — any site can call the API from a browser |
| `sec.hsts` *(advisory)* | `NODE_ENV` is not `production` on something you believe is production |
| `process.role` | `PROCESS_ROLE` unset, so a web instance is also running every scheduled job |

### Two design decisions worth knowing

**Read-only.** Every request is a GET against an endpoint that either needs
no authentication or is expected to refuse. Nothing is written, no account is
touched, no credentials are needed. That is what makes it safe to point at
production right after a deploy — which is when you most want to run it and
least want to stop and think about whether it is safe.

**Required vs advisory.** A required check failing sets the exit code; an
advisory reports a real degraded state that the app serves correctly through.
Redis being down is not grounds to roll back — the previous version depended
on Redis too, and ADR-0002 says caching falls through to MongoDB. Failing the
run on it would teach people to ignore a red smoke test, which is worse than
not having one.

### Why it runs in CI

`.github/workflows/ci.yml`'s `deployment-smoke` job starts the backend with
`npm start` against real Mongo and Redis containers, waits for readiness, and
runs the script — on every push and PR, under `NODE_ENV=production` so the
production-only config branches are the ones exercised.

Without that, the script's only execution would be during a deploy: untested
code running at the worst moment. And its failure mode is silent — a check
that can no longer detect anything still prints `PASS`, which everyone reads
as "the deploy is fine".

`backend/tests/smokeTest.test.js` covers it twice over. The healthy path runs
the real Express app — actual helmet, actual cors, actual `requestId`
middleware — on a real port, so the assertions are pinned to what the
application genuinely does; remove helmet from `app.js` and the suite goes
red. The failure paths use stub servers to prove each check *fails* on the
specific defect it exists to catch, because a check that cannot fail is
decoration.

## Backup/restore smoke test

`.github/workflows/backup-verify.yml` already did the substantive work: seed
fixtures, run a real `mongoBackup.js`, run a real isolated restore, and
compare per-collection document counts against the manifest. That was built
for OPS-002-T07 and ran **weekly, on a schedule, only**.

The gap was timing, not coverage. A change to the backup scripts merged on a
Tuesday went unverified until Sunday, and the failure then surfaced detached
from the change that caused it — a weekend alert nobody could immediately
attribute. And the thing it protects is the last resort: if backup is broken,
you want to find out on the pull request, not during the restore you are
attempting because something else already went wrong.

So the workflow now also runs on pull requests and pushes to `main` that
touch `backend/scripts/backup/**`, the backup tests, `utils/alerts.js`, or
the workflow itself.

Path-filtered deliberately: the job installs the MongoDB Database Tools from
apt on every run, and a slow check on every PR is a check people route
around. It is also deliberately **not** in `ci.yml`'s `ci-required`
aggregation — a path-filtered job does not run on most PRs, and branch
protection reads a required check that never reported as pending forever.

## What this does not cover

Stated plainly, because a smoke test's worst failure is someone believing it
covered more than it did:

- **No authenticated journeys.** Read-only by design. Logging in, adding an
  expense and reading a report are §2.6 of the OPS-004 runbook and stay
  manual, or belong to the Playwright e2e suite (TST-001-T05).
- **No log inspection.** `sec.headers` and the correlation-ID checks verify
  what crosses the wire. Whether logs are structured, redacted, and carry the
  ID on every line needs log access — OBS-001-T07 steps 1, 3, 4, 5, 6.
- **No production backup verification.** `backup-verify.yml` proves the
  backup/restore *pipeline* works, against its own throwaway Mongo. It has no
  access to a real production backup, and says so.
