# API workflow documentation

Visual documentation for the BALENISA APIs, module by module. Diagrams are generated from
code, not drawn by hand, so the whole set stays consistent as it grows.

Covered so far: **expense** (API-01, API-02, API-04, API-05 … API-09 plus one non-API
branch document, BRANCH-01, plus two combined flows — the four retrieval APIs, the edit-
form hydration read, and the complete CRUD mutation side), **budget**
(BUDGET-01 … BUDGET-03), **income** (INCOME-01 … INCOME-06), **charts**
(CHARTS-01 … CHARTS-09 plus one frontend-only flow), **bills** (BILLS-01 plus one
combined Bills–Expense flow), **report** (REPORT-01 plus two internal engine/refresh
flows), **auth** (AUTH-API-01 … AUTH-API-06 — every `/auth` endpoint gets its own
document — plus four internal/frontend flows covering protected-request validation,
session restoration, logout and expired-token handling), **ml-service**
(ML-API-01 … ML-API-11 — every FastAPI route gets its own document, including the three
health checks and the two operational status endpoints with no confirmed caller, plus
ML-API-11 for the Express backend's own prediction-proxy route — plus nine
internal/combined flows covering prediction, startup model loading, dataset
construction, training/evaluation, validation, persistence/activation, the retraining
lifecycle as a whole, startup reconciliation, and the backend↔ML categorization
integration) and **system** (SYSTEM-01 … SYSTEM-03 — two backend infrastructure
endpoints declared directly on the Express `app`, plus one push-notification
registration endpoint with no other module home; found during a repository-wide API
coverage gate run after the ML Service audit, not during an earlier module pass). Every
module has its own folder and index; the shared design system sits at this level.

Each endpoint gets **two diagrams that share one token set**:

- **Level 1 — overview.** Readable in 10–15 seconds at ~1200 px wide. Twelve numbered
  stages, no file paths, no code expressions, one secondary error path.
- **Level 2 — detailed.** The engineering reference. Real functions, middleware, models
  and query keys. Errors live in a dedicated band at the bottom rather than inside the
  primary flow.

Level 2 card badges reuse the Level 1 stage numbers, so the two views cross-reference.

Final repository-wide consolidation report (endpoint coverage, per-module/per-service
totals, findings roll-up, full validation results):
[FINAL_CONSOLIDATION_REPORT.md](FINAL_CONSOLIDATION_REPORT.md).

## Corpus status

Derived from the corrected manifest, not assumed — verified by grepping every document
heading and counting files directly (see [the coverage-gate note](#repository-wide-api-coverage-gate)
for the reconciliation this reflects).

67 total documented workflows: **48 API workflows** (single-endpoint, one document per
source endpoint, bijective — see the coverage gate) + **19 combined/frontend/internal
flows** (Expense FLOW-01/02, Charts FLOW-01, Bills FLOW-01, Report FLOW-01/02, Auth
FLOW-01…04, ML Service FLOW-01…09) = 67. Plus **1 non-API branch document** (BRANCH-01 —
a response branch of API-02, not a source endpoint of its own, explicitly excluded from
the workflow and API counts). 68 narrative documents total, 136 workflow/branch diagrams
(68 × 2 levels), 136 SVG files, 136 PNG files, 87 Markdown files, 43 Python build
scripts, 1 shared JSON token file — 403 total files under `docs/api-workflows/`,
including this README and the
[final consolidation report](FINAL_CONSOLIDATION_REPORT.md).

The System module (SYSTEM-01…03, 19 files) and, later, API-09, ML-API-11 and the
BRANCH-01 reclassification (5 files added, 0 removed, several files edited) were added
to close a repository-wide API coverage gate: `GET /`, `GET /ping`,
`POST /api/device-token`, `GET /expense/expense-edit-data` and
`POST /ml/predict-category` (backend proxy) are real, mounted, reachable,
application-defined endpoints that either had no documentation anywhere in this corpus,
or — in `GET /expense/by-category`'s case — had two documents for one endpoint. The
gate's bijective checks are all zero/equal as of this correction — see
[the coverage-gate note](#repository-wide-api-coverage-gate) below.

## Contents

| File | Role |
|---|---|
| `diagram-tokens.json` | Design tokens — colours, type, spacing, layout grids, conventions. Single source of truth for both levels. |
| `workflow_diagram.py` | Reusable diagram engine. Owns *how* diagrams look. |
| `_template_spec.py` | Skeleton to copy when documenting the next endpoint. |
| `expense/` | Expense module — index, consumption map, eight API documents, one non-API branch document (BRANCH-01), two flow documents, twenty-two diagrams, twelve specs. |
| `budget/` | Budget module — index, three API documents, six diagrams, six specs. |
| `income/` | Income module — index, six API documents, twelve diagrams, specs. |
| `charts/` | Charts module — index, consumption map, nine API documents, one flow document, twenty diagrams, specs. |
| `bills/` | Bills module — index, consumption map, one API document, one flow document, four diagrams, specs. |
| `report/` | Report / Analytics Engine module — index, consumption map, one API document, two flow documents, six diagrams, two specs. |
| `auth/` | Authentication module — index, consumption map, six API documents, four flow documents, twenty diagrams, two specs. |
| `ml-service/` | ML Service module — index, consumption map, lifecycle narrative, eleven API documents, nine flow documents, forty diagrams, four specs. |
| `system/` | System module — index, consumption map, three API documents, six diagrams, two specs. |
| `*-overview.svg` / `.png` | Level 1 outputs (1600 × 645; PNG at 2×). |
| `*-detailed.svg` / `.png` | Level 2 outputs (1680 × 1210; PNG at 2×). |

## Regenerating

```bash
cd docs/api-workflows
for s in */build_*.py; do python3 "$s"; done
```

Every spec resolves the shared engine with `sys.path.insert(0, os.path.dirname(HERE))` and
writes its outputs with `os.path.join(HERE, …)`, so the loop needs no `cd` and works from
any working directory.

PNGs are 2× rasterisations of the SVGs. Any rasteriser works:

```bash
rsvg-convert -w 3200 expense/api-01-last-week-overview.svg -o expense/api-01-last-week-overview.png
rsvg-convert -w 3360 expense/api-01-last-week-detailed.svg -o expense/api-01-last-week-detailed.png
```

The SVGs are pure vector — no embedded raster, no `<image>` elements — so they stay
editable in Figma, Illustrator or Inkscape.

## Semantic colour map

| Layer | Colour |
|---|---|
| Frontend / request | blue |
| Authentication / security | amber |
| Backend processing | purple |
| Database / cache operations | green |
| Analytics / insights | teal |
| Response / data transfer | cyan |
| UI / output | pink |
| Errors / alternate paths | red |

## Conventions

- **Direction.** Flow runs left to right. Level 1 uses a nine-column grid in which one
  column is deliberately left empty so the cache-hit short-circuit travels *forward*
  rather than doubling back. Level 2 runs left to right across five regions, and top to
  bottom inside one.
- **Region hand-off (Level 2).** Out of the source card's right edge, up through the lane
  above the containers, along past a direction chevron, then down into the next region's
  first card — entering toward its right corner so connectors never cross a region title.
- **Arrow weight.** Region hand-offs are heavier than steps inside a region. The `200 OK`
  hand-off is cyan and heaviest.
- **Errors.** Level 1 shows one secondary red path only. Level 2 collects every exception
  in an "Exceptions and Current Limitations" band, linked back by thin red dashed
  references routed through the gutter between the regions and the band, so no reference
  crosses a card, an icon or a title. `E1`–`E6` tags mark the originating cards.
- **Caches are never interchangeable.** Redis (server, 300 s), MongoDB (primary data) and
  TanStack Query (client, 5 min) each carry their own icon and kicker.
- **Card text.** A stage name, the real implementation identifier, and at most two short
  lines. Anything longer belongs in the markdown beneath the diagram.

## Adding the next endpoint

1. `cp _template_spec.py build_<endpoint>_detailed.py` and fill in the real cards.
2. Copy `build_overview.py` for the Level 1 view; keep the nine-column grid.
3. Read every value from `diagram-tokens.json` — never hardcode a colour or size.
4. Run both scripts, rasterise, then check the output at full size **and** at ~1200 px.

## Set status

### Expense — retrieval

| # | Endpoint | Stages | Document |
|---|---|---|---|
| API-01 | `GET /expense/last-week` | 12 | [api-01-last-week.md](expense/api-01-last-week.md) |
| API-02 | `GET /expense/by-category` (both branches; see below) | 12 | [api-02-category-thismonth.md](expense/api-02-category-thismonth.md) |
| API-04 | `GET /expense/search?startDate&endDate` | 10 | [api-04-custom-range.md](expense/api-04-custom-range.md) |
| API-09 | `GET /expense/expense-edit-data` | 9 | [api-09-edit-data.md](expense/api-09-edit-data.md) |
| BRANCH-01 *(not an API workflow)* | `GET /expense/by-category` else branch | 12 | [api-03-category-thisyear.md](expense/api-03-category-thisyear.md) |

**Corrected during the repository-wide API coverage gate.** `GET /expense/by-category`
previously had two API documents (API-02 and API-03) for one route, violating the
exactly-one-document-per-endpoint rule. API-02 is now that route's sole API document;
the else-branch document is reclassified as BRANCH-01, a non-API branch document
cross-linked from API-02 and excluded from the API-workflow count. API-09
(`GET /expense/expense-edit-data`) previously had no document of its own — only a
cross-link from FLOW-02, which does not count as coverage for a real endpoint under the
binding rule that a combined/internal flow cannot substitute for an API workflow. Both
issues were confirmed and closed; see [expense/README.md](expense/README.md) for full
rationale.

### Expense — mutation

| # | Endpoint | Stages | Document |
|---|---|---|---|
| API-05 | `POST /expense/add-expense` | 11 | [api-05-create-expense.md](expense/api-05-create-expense.md) |
| API-06 | `PUT /expense/update-expense` | 11 | [api-06-update-expense.md](expense/api-06-update-expense.md) |
| API-07 | `DELETE /expense/delete-expense` | 11 | [api-07-delete-expense.md](expense/api-07-delete-expense.md) |
| API-08 | `PATCH /api/recurring` | 11 | [api-08-toggle-recurring.md](expense/api-08-toggle-recurring.md) |
| FLOW-01 | *(combined prediction → review → save, two requests)* | 10 | [flow-01-ml-assisted-entry.md](expense/flow-01-ml-assisted-entry.md) |
| FLOW-02 | *(combined read → edit → save, two requests)* | 10 | [flow-02-retrieval-assisted-edit.md](expense/flow-02-retrieval-assisted-edit.md) |

Module index: [expense/README.md](expense/README.md) · consumption map:
[expense-consumption-map.md](expense/expense-consumption-map.md)

Those four are the complete expense **write** surface — there is no bulk endpoint, no
restore and no archive. `PATCH /api/recurring` mutates an `Expense` document even though it
is mounted on the shared `/api` router beside the budget routes, so it is documented here
rather than under Budget.

### Budget

| # | Endpoint | Stages | Document |
|---|---|---|---|
| BUDGET-01 | `GET /api/getbudgets` | 10 | [budget-api-01-get-budgets.md](budget/budget-api-01-get-budgets.md) |
| BUDGET-02 | `POST /api/setbudget` | 11 | [budget-api-02-set-budget.md](budget/budget-api-02-set-budget.md) |
| BUDGET-03 | `PUT /api/update-budget` | 11 | [budget-api-03-update-budget.md](budget/budget-api-03-update-budget.md) |

Module index: [budget/README.md](budget/README.md)

### Income

| # | Endpoint | Stages | Document |
|---|---|---|---|
| INCOME-01 | `GET /income/get` | 9 | [income-api-01-list-income.md](income/income-api-01-list-income.md) |
| INCOME-02 | `POST /income/add` | 10 | [income-api-02-add-income.md](income/income-api-02-add-income.md) |
| INCOME-03 | `PUT /income/edit` | 10 | [income-api-03-edit-income.md](income/income-api-03-edit-income.md) |
| INCOME-04 | `DELETE /income/delete` | 10 | [income-api-04-delete-income.md](income/income-api-04-delete-income.md) |
| INCOME-05 | `POST /income/insights-header` | 10 | [income-api-05-insights-header.md](income/income-api-05-insights-header.md) |
| INCOME-06 | `POST /income/insights-card` | 10 | [income-api-06-insights-card.md](income/income-api-06-insights-card.md) |

Module index: [income/README.md](income/README.md)

### Charts

| # | Endpoint | Stages | Document |
|---|---|---|---|
| CHARTS-01 | `GET /chart/getloggedyears` | 9 | [charts-api-01-logged-years.md](charts/charts-api-01-logged-years.md) |
| CHARTS-02 | `GET /chart/linechartbyweek` | 10 | [charts-api-02-trend-by-week.md](charts/charts-api-02-trend-by-week.md) |
| CHARTS-03 | `GET /chart/linechartbymonth` | 10 | [charts-api-03-trend-by-month.md](charts/charts-api-03-trend-by-month.md) |
| CHARTS-04 | `GET /chart/linechartbyyear` | 9 | [charts-api-04-trend-by-year.md](charts/charts-api-04-trend-by-year.md) |
| CHARTS-05 | `GET /chart/linechartbetweenyears` | 10 | [charts-api-05-trend-between-years.md](charts/charts-api-05-trend-between-years.md) |
| CHARTS-06 | `GET /chart/barchartbycategory` | 10 | [charts-api-06-bar-by-category.md](charts/charts-api-06-bar-by-category.md) |
| CHARTS-07 | `GET /chart/barchartbymonth` | 10 | [charts-api-07-bar-budget-vs-spend.md](charts/charts-api-07-bar-budget-vs-spend.md) |
| CHARTS-08 | `GET /chart/getPieCategoryData` | 11 | [charts-api-08-pie-category.md](charts/charts-api-08-pie-category.md) |
| CHARTS-09 | `GET /chart/getcomparisonforpie` | 11 | [charts-api-09-pie-budget-comparison.md](charts/charts-api-09-pie-budget-comparison.md) |
| FLOW-01 | *(no endpoint — frontend only)* | 9 | [charts-flow-01-chart-insights.md](charts/charts-flow-01-chart-insights.md) |

Module index: [charts/README.md](charts/README.md) · consumption map:
[charts-consumption-map.md](charts/charts-consumption-map.md)

### Bills

| # | Endpoint | Stages | Document |
|---|---|---|---|
| BILLS-01 | `POST /bills/bill-upload` | 11 | [bills-api-01-upload-and-extract.md](bills/bills-api-01-upload-and-extract.md) |
| FLOW-01 | *(combined Bills–Expense, two requests)* | 10 | [bills-flow-01-scan-to-expense.md](bills/bills-flow-01-scan-to-expense.md) |

Module index: [bills/README.md](bills/README.md) · consumption map:
[bills-consumption-map.md](bills/bills-consumption-map.md)

Bills has exactly one endpoint. It stores nothing — no Bill model exists — and persistence
happens through `POST /expense/add-expense`, which the user triggers separately.

> **Resolved.** `POST /expense/add-expense`, the persistence step of the bill-scan flow, is
> now documented as [API-05](expense/api-05-create-expense.md). `AddExpense.js` — not Bills
> — is its primary consumer, so it lives in the expense set and Bills cross-links it rather
> than holding a second copy under a Bills API ID.

### Report / Analytics Engine

| # | Endpoint | Stages | Document |
|---|---|---|---|
| REPORT-01 | `GET /report` | 11 | [report-api-01-get-report.md](report/report-api-01-get-report.md) |
| FLOW-01 | *(no endpoint — internal Analytics Engine)* | 9 | [report-flow-01-analytics-engine.md](report/report-flow-01-analytics-engine.md) |
| FLOW-02 | *(combined Expense/Budget mutation → refresh, no endpoint of its own)* | 9 | [report-flow-02-mutation-refresh.md](report/report-flow-02-mutation-refresh.md) |

Module index: [report/README.md](report/README.md) · consumption map:
[report-consumption-map.md](report/report-consumption-map.md)

Report has exactly one endpoint — a cache-first read of one document per user. The
Analytics Engine that produces it (FLOW-01) and the mutation-triggered refresh that keeps
it current (FLOW-02) are both internal flows with no HTTP boundary of their own, so
neither is counted under a Report API ID. Six Expense/Budget mutations call the refresh
synchronously; Income never triggers it, and neither the ML Service nor SIA is called
anywhere in the engine.

### Authentication

| # | Endpoint | Stages | Document |
|---|---|---|---|
| AUTH-API-01 | `POST /auth/signup` | 9 | [auth-api-01-register.md](auth/auth-api-01-register.md) |
| AUTH-API-02 | `POST /auth/login` | 9 | [auth-api-02-login.md](auth/auth-api-02-login.md) |
| AUTH-API-03 | `POST /auth/verify-otp` | 8 | [auth-api-03-verify-otp.md](auth/auth-api-03-verify-otp.md) |
| AUTH-API-04 | `POST /auth/resend-otp` | 8 | [auth-api-04-resend-otp.md](auth/auth-api-04-resend-otp.md) |
| AUTH-API-05 | `POST /auth/forgot-password` | 9 | [auth-api-05-forgot-password.md](auth/auth-api-05-forgot-password.md) |
| AUTH-API-06 | `POST /auth/reset-password` | 8 | [auth-api-06-reset-password.md](auth/auth-api-06-reset-password.md) |
| FLOW-01 | *(no endpoint — internal JWT middleware)* | 8 | [auth-flow-01-protected-request.md](auth/auth-flow-01-protected-request.md) |
| FLOW-02 | *(no endpoint — frontend session restoration)* | 7 | [auth-flow-02-session-restoration.md](auth/auth-flow-02-session-restoration.md) |
| FLOW-03 | *(no endpoint — client-only logout)* | 6 | [auth-flow-03-logout.md](auth/auth-flow-03-logout.md) |
| FLOW-04 | *(no endpoint — frontend 401 handling)* | 7 | [auth-flow-04-expired-token.md](auth/auth-flow-04-expired-token.md) |

Module index: [auth/README.md](auth/README.md) · consumption map:
[auth-consumption-map.md](auth/auth-consumption-map.md)

Six real endpoints exist under `/auth`, all declared in `auth.routes.js`, none behind
`verifyToken` (they issue or precede the credential it checks). Every one of the six
carries its own AUTH-API id — `verify-otp` and `reset-password` are each shared by, or
dependent on, more than one user journey, but that sharing is documented within each
endpoint's own file rather than by merging endpoints into a combined document. There is
no logout endpoint, no session-validation endpoint, and no refresh-token endpoint —
each confirmed absent, not merely undocumented. Login JWTs carry no expiry claim at
all, and the shared `verifyToken` middleware — reused unmodified across all seven
protected routers — never re-queries the database after verifying a signature.

### ML Service

| # | Endpoint | Stages | Document |
|---|---|---|---|
| ML-API-01 | `HEAD /` | 4 | [ml-api-01-health-head.md](ml-service/ml-api-01-health-head.md) |
| ML-API-02 | `GET /` | 5 | [ml-api-02-health.md](ml-service/ml-api-02-health.md) |
| ML-API-03 | `GET /health/live` | 4 | [ml-api-03-health-live.md](ml-service/ml-api-03-health-live.md) |
| ML-API-04 | `GET /health/ready` | 6 | [ml-api-04-health-ready.md](ml-service/ml-api-04-health-ready.md) |
| ML-API-05 | `GET /ml-status` | 6 | [ml-api-05-ml-status.md](ml-service/ml-api-05-ml-status.md) |
| ML-API-06 | `GET /training-runs` | 6 | [ml-api-06-training-runs-list.md](ml-service/ml-api-06-training-runs-list.md) |
| ML-API-07 | `GET /training-runs/{run_id}` | 6 | [ml-api-07-training-run-detail.md](ml-service/ml-api-07-training-run-detail.md) |
| ML-API-08 | `POST /predict-category` | 7 | [ml-api-08-predict-category.md](ml-service/ml-api-08-predict-category.md) |
| ML-API-09 | `POST /generate-description` | 6 | [ml-api-09-generate-description.md](ml-service/ml-api-09-generate-description.md) |
| ML-API-10 | `POST /retrain-model` | 8 | [ml-api-10-retrain-model.md](ml-service/ml-api-10-retrain-model.md) |
| ML-API-11 | `POST /ml/predict-category` (Express backend proxy, not FastAPI) | 8 | [ml-api-11-backend-predict-proxy.md](ml-service/ml-api-11-backend-predict-proxy.md) |
| FLOW-01 | *(no endpoint — in-memory prediction pipeline)* | 7 | [ml-flow-01-prediction-pipeline.md](ml-service/ml-flow-01-prediction-pipeline.md) |
| FLOW-02 | *(no endpoint — startup model loading)* | 6 | [ml-flow-02-startup-loading.md](ml-service/ml-flow-02-startup-loading.md) |
| FLOW-03 | *(no endpoint — training-data construction)* | 7 | [ml-flow-03-dataset-construction.md](ml-service/ml-flow-03-dataset-construction.md) |
| FLOW-04 | *(no endpoint — training + evaluation subprocess)* | 7 | [ml-flow-04-training-evaluation.md](ml-service/ml-flow-04-training-evaluation.md) |
| FLOW-05 | *(no endpoint — validation gates subprocess)* | 7 | [ml-flow-05-validation-promotion.md](ml-service/ml-flow-05-validation-promotion.md) |
| FLOW-06 | *(no endpoint — artifact persistence + activation)* | 7 | [ml-flow-06-persistence-activation.md](ml-service/ml-flow-06-persistence-activation.md) |
| FLOW-07 | *(umbrella — the full background retraining lifecycle)* | 8 | [ml-flow-07-retraining-lifecycle.md](ml-service/ml-flow-07-retraining-lifecycle.md) |
| FLOW-08 | *(no endpoint — startup reconciliation)* | 7 | [ml-flow-08-startup-reconciliation.md](ml-service/ml-flow-08-startup-reconciliation.md) |
| FLOW-09 | *(combined Node backend + FastAPI, no endpoint of its own)* | 8 | [ml-flow-09-backend-integration.md](ml-service/ml-flow-09-backend-integration.md) |

Module index: [ml-service/README.md](ml-service/README.md) · consumption map:
[ml-service-consumption-map.md](ml-service/ml-service-consumption-map.md) · lifecycle:
[ml-service-lifecycle.md](ml-service/ml-service-lifecycle.md)

Ten real FastAPI routes exist, confirmed by reading every `@app.get/post/head` decorator
in `app.py` — three health checks and two operational status endpoints have no confirmed
caller anywhere in this repository, but each is still its own API document per the binding
classification rule. Only four endpoints are confirmed called by the Node backend
(`predict-category`, `generate-description`, `retrain-model`, and the plain `GET /` health
check), and none of those four calls carries any service-to-service authentication. The
three token-gated operational endpoints are unconditionally 503 in this repository's
checked-out `.env`, since `ML_OPERATIONS_TOKEN` is never set.

An eleventh document, ML-API-11, was added during the repository-wide API coverage gate
for the Express backend's own `POST /ml/predict-category` proxy route — a distinct
endpoint on a distinct server from the FastAPI `POST /predict-category` above. It had
previously been described only inside ML-FLOW-09, which does not count as coverage for
an individual endpoint under this corpus's binding rules.

### System

| # | Endpoint | Stages | Document |
|---|---|---|---|
| SYSTEM-01 | `GET /` | 4 | [system-api-01-root.md](system/system-api-01-root.md) |
| SYSTEM-02 | `GET /ping` | 6 | [system-api-02-ping.md](system/system-api-02-ping.md) |
| SYSTEM-03 | `POST /api/device-token` | 9 | [system-api-03-device-token.md](system/system-api-03-device-token.md) |

Module index: [system/README.md](system/README.md) · consumption map:
[system-consumption-map.md](system/system-consumption-map.md)

Found during the repository-wide API coverage gate, not an earlier module pass.
SYSTEM-01 and SYSTEM-02 are declared directly on the Express `app` object in
`server.js`, above every router mount — neither has a frontend caller anywhere in
`frontend/src`; both exist for external tooling only. SYSTEM-03 shares a router file
with Budget (`api.routes.js`) but is an unrelated feature — push-notification device
registration — with its own model (`DeviceToken`) and two frontend callers
(`useWebPush.js`, `useMobilePush.js`), neither of which uses the shared axios client.

## Repository-wide API coverage gate

Run after the ML Service audit, to confirm every mounted, reachable,
application-defined HTTP endpoint across the Express backend and the FastAPI ML service
maps to **exactly one** API workflow document, and every API workflow document maps to
**exactly one** source endpoint — a bijective check, not simple set membership.

**Source endpoints discovered:** 48 total — 38 Express (2 app-level, 6 auth, 5 api, 7
expense, 1 bills, 1 ml-proxy, 1 report, 9 chart, 6 income) + 10 FastAPI. FastAPI's
`/docs`, `/redoc` and `/openapi.json` were excluded as framework-generated; SIA was
excluded as confirmed not implemented.

**First pass (incomplete).** An initial pass found Difference A (source → no document)
at zero and Difference B (document → no source) at zero using plain set membership, but
that check was insufficient: it missed that `GET /expense/by-category` had **two**
documents for **one** route (a cardinality violation, not a missing-coverage one), that
`GET /expense/expense-edit-data` was covered only by a flow cross-link rather than its
own document (which does not satisfy the coverage rule that a combined/internal flow
cannot substitute for an API workflow), and that `POST /ml/predict-category`'s
documentation inside ML-FLOW-09 was the same non-substitution problem. **All three were
corrected:**

1. `GET /expense/by-category` — API-02 remains the route's sole API document. The
   second document is reclassified as **BRANCH-01**, a non-API branch document
   (cross-linked from API-02, excluded from the API-workflow count).
2. `GET /expense/expense-edit-data` — now has its own API document, **API-09**.
3. `POST /ml/predict-category` (Express backend proxy, distinct from the FastAPI
   `POST /predict-category`) — now has its own API document, **ML-API-11**.
   ML-FLOW-09 continues to describe the wider round trip and cross-links ML-API-11, but
   is not counted as ML-API-11's coverage.

**Corrected bijective result:**

| Check | Result |
|---|---|
| Reachable source APIs = API workflow documents | 48 = 48 |
| Source endpoint → zero documents | 0 |
| Source endpoint → multiple documents | 0 |
| API document → no source endpoint | 0 |
| Combined/internal flows counted as APIs | 0 |

**Separately reported, not folded into the bijective check (by definition, since neither
is a distinct source endpoint or a second API document for one):**
- `GET /expense/by-category`'s else-branch behaviour — BRANCH-01, a non-API branch
  document of the route API-02 already covers, not a second endpoint.
- No unreachable/unmounted implementations or duplicate routes were found in either
  service during this gate.

No chart calls an Expense, Budget or Income endpoint. CHARTS-07 and CHARTS-09 read
`BudgetModel` directly; the others read `ExpenseModel` directly. Those modules are
cross-linked rather than re-documented.

These three are the complete budget surface — `api.routes.js` mounts no other budget
route. `BudgetModel` is also read directly by `chart.service.js` and
`analytics/dataProvider.js`, but neither goes through an HTTP endpoint.

Stage counts follow the implementation, not a template. API-04 has ten because it has no
Redis layer and no insights consumer — both are drawn as explicit absences rather than
omitted.

API-02 and BRANCH-01 share one route and one controller (`getByCategory`) — API-02 is the
route's sole API document; BRANCH-01 is a non-API branch document, not a second endpoint.
Stages 01–06 and 09–10 are the same code path; only the cache key, the date window, the
transform pass, the `pastThreeMonths` payload and the insight rules differ. BRANCH-01's
document tabulates exactly those five differences rather than repeating the shared
material.

`GET /expense/expense-edit-data` now has its own document, **API-09**. It backs the edit
form rather than the viewing experience, and it is a retrieval endpoint rather than a
mutation, which is why the module's original four-API index did not include it. Its full
behaviour remains cross-referenced from
[FLOW-02 §5](expense/flow-02-retrieval-assisted-edit.md#5-api-dependencies) as the
combined retrieval-then-edit journey; FLOW-02 is not API-09's coverage — API-09 is.

## Structural differences across the expense retrieval set

| | API-01 | API-02 | BRANCH-01 | API-04 | API-09 |
|---|---|---|---|---|---|
| Redis cache | yes | yes | yes | **none** | **none** |
| Cache read vs user check | cache **first** | user **first** | user **first** | n/a | user **first** |
| MongoDB reads per request | 1 (42 d) | 1 (~4 mo) | 1 (1 yr) | 1 (caller range) | 1 (single doc) |
| Datasets returned | 3 | 2 | 2 (one always empty) | 1 | 1 |
| Insights consumer | yes | yes | yes | **none** | **none** |
| Result ordering | newest first | newest first | newest first | **oldest first** | n/a (single doc) |

## Structural differences across the expense mutation set

| | API-05 | API-06 | API-07 | API-08 |
|---|---|---|---|---|
| Verb | `POST` | `PUT` | `DELETE` | `PATCH` |
| Joi validation | **yes** | no | no | no |
| ObjectId guard | n/a | yes | yes | **no** |
| Zero/negative amount | **rejected** | **accepted** | n/a | n/a |
| Collections written | 1–2 | 1 | 1 | 2 |
| Budget recalculated | always | only if amount/date changed | always | never |
| Redis cleared | yes | yes | yes | **no** |
| Query families invalidated | 4 | 4 | 4 | **0** |
| Update strategy | pessimistic | pessimistic | pessimistic | **optimistic + rollback** |
| Not-found status | n/a | 404 | 404 | **403** |

Create is the only mutation with a validation middleware. Update therefore accepts values
create rejects — an empty name, a zero, a negative or a `null` amount — because
`findOneAndUpdate` runs without `runValidators`.

## Structural differences across the budget set

| | BUDGET-01 | BUDGET-02 | BUDGET-03 |
|---|---|---|---|
| Verb | `GET` | `POST` | `PUT` |
| Redis for budget data | **none** | **none** | **none** |
| Other Redis touched | — | `report:<userId>` | `report:<userId>` |
| MongoDB operations | 1 read | 3 writes + 1 aggregate | 3 writes + 1 aggregate |
| Write semantics | — | **upsert** | **upsert** |
| Month targeted | all | current only | current only |
| Response body | full history | message only | message + document |
| Client error state | handled in `SetBudget`, not in `Header` | toast | toast |

Neither write route is create-only or update-only, and neither accepts a month parameter —
so a past month's budget cannot be set or edited through the API at all.

## Structural differences across the income set

| | 01 list | 02 add | 03 edit | 04 delete | 05 header | 06 card |
|---|---|---|---|---|---|---|
| Redis | **none** | **none** | **none** | **none** | **none** | **none** |
| Joi middleware | — | yes | yes | **no** | — | — |
| DB operations | 1 read | 1 insert | 1 scoped update | 1 scoped delete | 2 parallel reads | 2 parallel reads |
| Returns data | yes | no | no | no | yes | yes |
| Update strategy | — | invalidate + refetch | invalidate + refetch | invalidate + refetch | — | — |
| Error visible | toast | toast | toast | toast | toast | **console only** |

Income is the only module with **no Redis at any layer**. It is also absent from the report
and chart pipelines, so an income mutation's `reports.all` invalidation refetches data that
contains no income.
