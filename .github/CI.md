# Continuous integration

The workflow at `.github/workflows/ci.yml` runs on every push, pull request, and manual dispatch.

| Job | Purpose |
|---|---|
| Frontend validation | Clean install, lint, React tests, production build, and build artifact retention. |
| Backend unit validation | Clean install, lint, and the default Jest suite. |
| Backend integration validation | Isolated MongoDB and Redis services with the protected integration suite. |
| End-to-end user journeys | Playwright journeys against a real frontend and backend. |
| ML validation | Clean Python dependency install, dependency consistency check, isolated MongoDB, and the full pytest suite. |
| Dependency audit | Fails on critical production dependency advisories in either Node application. |
| Secret scan | Pinned gitleaks over the checked-out tree and the commits this change introduces. |
| CI required checks | Aggregate gate; the single check to require in branch protection. |

## Static analysis (OPS-001-T06)

**Backend** (`backend/eslint.config.js`) is a correctness gate, not a style
gate. Rules that can only fire on genuinely broken code -- `no-undef`,
`no-unreachable`, `no-dupe-keys`, `no-unsafe-*` and friends -- are errors
and fail the build. Style and legacy-hygiene rules are warnings, because
this codebase predates any linter and promoting them would mean rewriting
~200 files in the same change that introduces the tool.

Warnings are not unbounded: `npm run lint:ci` also fails if the warning
count rises above `backend/scripts/lint-baseline.json`, so the list can
only shrink. Lower the baseline after cleaning warnings up:

```bash
cd backend
npx eslint . --format json | node scripts/lintBaseline.js --update
```

Raising it must be a deliberate, reviewed edit to that file.

**Frontend** blocks on application source at zero tolerance
(`npm run lint:ci`). Test files are linted separately and
non-blockingly (`npm run lint`): the `react-app/jest` preset enables
`testing-library/*` rules that CRA's own build never applies, and the
existing suites predate them. Application source is currently clean.

## Secret scanning (OPS-001-T06)

`.gitleaks.toml` extends gitleaks' default ruleset. The job installs a
**pinned** release binary and verifies its SHA-256 before executing it,
rather than using a third-party Action -- the version is auditable in the
workflow, and there is no licence question about running it here.

Two blocking scans run:

1. **The checked-out tree** -- every tracked file, which is exactly what a
   fresh clone contains.
2. **The commits this push or pull request introduces** -- catches a secret
   that was added and then deleted within the same change, which the tree
   scan cannot see but which stays recoverable from history forever.

A third step fails the build if any `.env` file is ever tracked.

Full history is deliberately *not* scanned on every push: one legacy
finding in an old commit would block every unrelated change, and the fix
for that is a history rewrite plus credential rotation, not a red build.
Run a full audit on demand:

```bash
gitleaks git . --config .gitleaks.toml --redact
```

Two allowlist entries are worth knowing about, both allowlisted **by
value rather than by file path** so that a genuine secret added to the
same file is still caught:

- CI's own non-production test values.
- The Firebase **Web** API key. This is a public client identifier that
  ships in every browser bundle by design; SEC-001 section 14 records the
  exception. It is secured by Firebase API-key restrictions (HTTP
  referrer + allowed APIs), so those restrictions must stay in place --
  the allowlist entry is not a substitute for them.

The MongoDB and Redis services are disposable CI-only containers. Their credentials and test secrets are non-production values defined in the workflow; production values must remain in the hosting platforms' secret stores.

## Required status checks (OPS-001-T07)

Require exactly one check in branch protection: **`CI required checks`**.

That job (`ci-required`) depends on every other job and fails unless all
of them succeeded. Requiring the aggregate instead of each job keeps the
list of what must pass in this file, reviewed alongside the code -- with
per-job checks, adding a job means editing repository settings too, and a
job that is added but never required silently protects nothing.

It runs with `if: always()` and tests each dependency's result explicitly.
That is deliberate: a job that is skipped or cancelled would otherwise
leave the aggregate skipped, and GitHub reports a skipped required check
as *success*.

Enable it once, after the first successful run on `main`:

```bash
Applied 2026-09-09 via the GitHub settings UI (no `gh` CLI available on the
maintainer's machine); the equivalent API call is kept here for reference.

NOTE on the approval count below. It is deliberately 0, not 1. GitHub does not
let an author approve their own pull request, so on a single-maintainer
repository `required_approving_review_count=1` combined with
`enforce_admins=true` makes every PR permanently unmergeable. Raise it to 1
only when there is a second maintainer who can review, or drop
`enforce_admins` at the same time so an admin can still merge. The protection
that actually matters here is the required `CI required checks` context, which
gates merges regardless of the approval count.

WHEN SETTING THIS IN THE UI: creating the rule and binding the check are two
separate saves. A rule created with "Require status checks to pass before
merging" ticked but no check selected shows "No required checks" and enforces
nothing while looking configured. Always re-open the rule and confirm
`CI required checks` is listed before treating this as done.

gh api -X PUT repos/:owner/:repo/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=CI required checks' \
  -F 'enforce_admins=true' \
  -F 'required_pull_request_reviews[required_approving_review_count]=0' \
  -F 'restrictions=null'
```

Verify with:

```bash
gh api repos/:owner/:repo/branches/main/protection --jq '.required_status_checks.contexts'
```

Do not add deployment steps to this workflow until OPS-004 defines verified rollout and rollback controls.
