# OBS-001 alert runbook

Referenced by every alert the backend can raise (`backend/utils/alerts.js`,
OBS-001-T06). Alerts are always emitted as a distinct structured log event
(`scope: "alert"`, from `backend/utils/logger.js`) and, only when
`OBS_ALERT_OWNER_EMAIL` is configured, also sent as an email through the
already-approved Brevo integration (`backend/Services/AuthServices/email.service.js`).

There is no third-party error-aggregation/APM vendor wired in --
OBS-001-T04 is intentionally deferred pending an architecture/privacy
decision on adopting one (see the OBS-001 feature spec, section 7,
"External services"). Until that decision is made, this file is the
runbook link every alert points to.

## high_error_rate

**What it means:** more than `OBS_ALERT_ERROR_RATE_THRESHOLD` (default
`0.05`, i.e. 5%) of requests in a metrics window (default ~5 minutes,
`backend/utils/metrics.js`) returned a 5xx status, and the window had at
least `MIN_SAMPLE_SIZE` (5) requests. Below that sample size the ratio is
too noisy to act on -- a single failed request out of 2 would otherwise
read as a 50% error rate.

**Immediate steps:**
1. Check the most recent `metrics_snapshot` and structured `error` log
   lines for the affected window to identify which route(s) are failing.
2. Check whether a dependency (MongoDB, Redis, the ML service, Firebase,
   Brevo, Groq) is degraded or unreachable.
3. If a recent deploy correlates with the spike, roll it back.

**Owner:** on-call maintainer -- currently the app owner, until this
project has more than one maintainer.

## high_latency

**What it means:** average request latency in a metrics window exceeded
`OBS_ALERT_LATENCY_MS_THRESHOLD` (default `2000` ms).

**Immediate steps:**
1. Check for a slow downstream dependency (DB, Redis, ML service) or a
   recent change to a hot path.
2. Check `requestCount` / `distinctRoutes` in the snapshot for an unusual
   traffic spike.
3. If sustained, consider scaling or degrading a non-critical feature, per
   the feature spec's documented-degradation requirement.

**Owner:** on-call maintainer.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `OBS_ALERT_ERROR_RATE_THRESHOLD` | `0.05` | Fraction of 5xx responses (of requests in one window) that triggers `high_error_rate`. |
| `OBS_ALERT_LATENCY_MS_THRESHOLD` | `2000` | Average latency (ms) in one window that triggers `high_latency`. |
| `OBS_ALERT_OWNER_EMAIL` | unset | If set, alerts are also emailed here. If unset, alerts stay structured-log-only -- this is a valid, supported configuration, not a degraded one. |

## Why no new vendor

OBS-001-T04 flagged that a dedicated error-aggregation/APM vendor (Sentry,
Datadog, Rollbar, etc.) needs an explicit architecture/privacy decision
before this financial-data application sends error/request data to it.
T06 deliberately stays within already-approved infrastructure (structured
stdout logs, plus the existing Brevo transactional-email integration) so
alerting and runbook links do not have to wait on that decision. If a
vendor is later approved for T04, this runbook's alert list should be
re-pointed at that vendor's alerting instead of, or in addition to, this
file.
