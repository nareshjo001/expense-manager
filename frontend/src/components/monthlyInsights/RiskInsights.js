import { FaShieldHalved } from "react-icons/fa6";
import "./RiskInsights.css";

// Risk Intelligence V1 -- Financial Risk Signals section.
//
// Pure, read-only renderer over `report.risk`, which
// backend/analytics/analyzers/riskAnalyzer.js already computes and
// backend/analytics/reportGenerator.js already stores on the SAME report
// every other Monthly Insights section reads (see MonthlyInsightPage.js).
// There is deliberately no second fetch, no new query key, and no
// client-side risk calculation here -- exactly the pattern
// SpendingForecast.js and AnomalyInsights.js already established for this
// page. Every threshold, severity, and evidence value below is copied
// verbatim from the backend's own frozen contract
// (backend/analytics/analyzers/scores/riskRules.js); nothing here
// recalculates a threshold, invents a probability/confidence percentage, or
// attributes a cause.
//
// Product classification (do not describe this feature any other way in
// future edits): forecast-assisted, DETERMINISTIC, rule-based financial
// risk ASSESSMENT -- never "AI risk prediction" or "ML-based risk scoring".
// Five of the six possible signals describe something already true about
// the user's CURRENT data; only FORECASTED_FINANCIAL_PRESSURE looks
// forward, and even that reads the LEGACY `report.forecast.nextMonthForecast`
// horizon (confirmed via backend/analytics/analyzers/riskAnalyzer.js's own
// `evaluateForecastedPressure`), which projects the CURRENT, in-progress
// month -- never the next calendar month (see forecastAnalyzer.js's own
// documented distinction between `nextMonthForecast` and
// `nextCalendarMonthForecast`). This component's copy is therefore
// deliberately more conservative than a backend reason-code NAME alone
// might suggest:
//   - PERSISTENT_SPENDING_GROWTH is backed by exactly ONE month-over-month
//     comparison (trendAnalyzer.js's `monthlyTrend`, itself just
//     `comparePeriods(currentMonthExpenses, previousMonthExpenses)`), not a
//     multi-period trend -- so this component's own copy never uses the
//     word "persistent" or "sustained", only "compared to last month".
//   - DETERIORATING_HEALTH is a THRESHOLD on the CURRENT health score only
//     (riskAnalyzer.js's `evaluateDeterioratingHealth` reads only
//     `financialHealth.overall`, with no historical comparison at all) --
//     so this component says the score is "currently low", never
//     "declining" or "deteriorating".
//   - FORECASTED_FINANCIAL_PRESSURE's copy says "projected spending for
//     this month", never "next month".

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isNonBlankString = (value) => typeof value === "string" && value.trim() !== "";
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Whole rupees only, explicit "en-IN" locale -- same convention already
// established by SpendingForecast.js's/AnomalyInsights.js's own formatMoney.
const formatMoney = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;
const formatPercent = (value) => `${Math.round(value)}%`;

const SEVERITY_LABELS = { low: "Low", moderate: "Moderate", high: "High" };
const RISK_LEVEL_LABELS = { none: "None", low: "Low", moderate: "Moderate", high: "High" };

// Plain-language titles -- the raw backend reasonCode is never rendered.
const SIGNAL_TITLES = {
  BUDGET_ALREADY_OVERSPENT: "Budget already exceeded",
  LOW_REMAINING_BUDGET: "Low remaining budget",
  PERSISTENT_SPENDING_GROWTH: "Spending is up compared to last month",
  ABNORMAL_HIGH_VALUE_EXPENSES: "Unusually high-value expenses detected",
  FORECASTED_FINANCIAL_PRESSURE: "Projected spending pressure",
  DETERIORATING_HEALTH: "Financial health score is currently low",
};

// Each builder returns a description string, or null when the evidence it
// needs is missing/invalid -- in which case the safe generic fallback below
// is shown instead of a broken or partially-numeric sentence (same pattern
// AnomalyInsights.js's own toDisplayRecord already established).
const SIGNAL_DESCRIPTIONS = {
  BUDGET_ALREADY_OVERSPENT: (evidence) => {
    if (!isFiniteNumber(evidence.exceededBy) || !isFiniteNumber(evidence.utilization)) return null;
    return `This month's budget has already been exceeded by ${formatMoney(evidence.exceededBy)} (${formatPercent(
      evidence.utilization
    )} used).`;
  },
  LOW_REMAINING_BUDGET: (evidence) => {
    if (!isFiniteNumber(evidence.utilization) || !isFiniteNumber(evidence.remainingBudget)) return null;
    return `${formatPercent(evidence.utilization)} of this month's budget has been used, leaving about ${formatMoney(
      evidence.remainingBudget
    )} remaining.`;
  },
  PERSISTENT_SPENDING_GROWTH: (evidence) => {
    if (!isFiniteNumber(evidence.percentageChange)) return null;
    return `Spending this month is up ${formatPercent(evidence.percentageChange)} compared to last month.`;
  },
  ABNORMAL_HIGH_VALUE_EXPENSES: (evidence) => {
    if (!isFiniteNumber(evidence.flaggedCount) || evidence.flaggedCount <= 0) return null;
    return `${evidence.flaggedCount} recent ${
      evidence.flaggedCount === 1 ? "expense was" : "expenses were"
    } unusually high compared to your own spending history. See Unusual Spending for details.`;
  },
  FORECASTED_FINANCIAL_PRESSURE: (evidence) => {
    if (!isFiniteNumber(evidence.forecastedAmount) || !isFiniteNumber(evidence.configuredBudget)) return null;
    return `Projected spending for this month (${formatMoney(
      evidence.forecastedAmount
    )}) is at or above this month's configured budget of ${formatMoney(evidence.configuredBudget)}.`;
  },
  DETERIORATING_HEALTH: (evidence) => {
    if (!isFiniteNumber(evidence.overall)) return null;
    return `Your financial health score is currently low (${Math.round(evidence.overall)}/100).`;
  },
};

// Unknown/future reason codes (or a record missing one entirely) fall back
// here -- never the raw code, never a crash.
const GENERIC_TITLE = "Additional risk signal";
const GENERIC_DESCRIPTION = "A risk signal was detected based on your financial data.";

// Builds one safely-displayable signal card from a raw backend record, or
// null when the record is too malformed to show at all. Never mutates
// `raw`.
function buildDisplaySignal(raw, index) {
  if (!isPlainObject(raw)) return null;

  const reasonCode = isNonBlankString(raw.reasonCode) ? raw.reasonCode : null;
  const severityKey = isNonBlankString(raw.severity) && SEVERITY_LABELS[raw.severity] ? raw.severity : null;
  const evidence = isPlainObject(raw.evidence) ? raw.evidence : {};

  const title = (reasonCode && SIGNAL_TITLES[reasonCode]) || GENERIC_TITLE;
  const descriptionBuilder = reasonCode ? SIGNAL_DESCRIPTIONS[reasonCode] : null;
  const description = (descriptionBuilder && descriptionBuilder(evidence)) || GENERIC_DESCRIPTION;

  return {
    key: reasonCode ? `${reasonCode}-${index}` : `signal-${index}`,
    title,
    description,
    severityKey,
  };
}

function RiskShell({ children }) {
  return (
    <section className="risk-container" aria-labelledby="risk-heading">
      <div className="risk-heading-row">
        <div className="risk-heading-icon">
          <FaShieldHalved size={16} color="#FFFFFF" />
        </div>
        <h1 id="risk-heading" className="risk-h-text">
          Financial Risk Signals
        </h1>
      </div>
      <div className="risk-panel">
        <p className="risk-disclosure">
          These are rule-based indicators derived from your financial data and available spending
          forecast -- not guarantees, and not investment or credit advice.
        </p>
        {children}
      </div>
    </section>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="risk-empty">
      <p className="risk-empty-title">{title}</p>
      <p className="risk-empty-text">{text}</p>
    </div>
  );
}

const UNAVAILABLE_TITLE = "Risk assessment unavailable right now";
const UNAVAILABLE_TEXT =
  "We could not evaluate financial risk signals just now. Your expenses and budgets are unaffected — please try again shortly.";

export default function RiskInsights({ report }) {
  const risk = report?.risk;

  // report.risk is missing entirely or not shaped like a real result at all
  // (e.g. an older cached report, or the analytics layer could not produce
  // this section this time). Deliberately the SAME "unavailable" wording as
  // the hasData:false branch below -- both mean "no evaluation happened",
  // which must never be presented as "no risk".
  if (!isPlainObject(risk) || typeof risk.hasData !== "boolean") {
    return (
      <RiskShell>
        <EmptyState title={UNAVAILABLE_TITLE} text={UNAVAILABLE_TEXT} />
      </RiskShell>
    );
  }

  if (risk.hasData === false) {
    return (
      <RiskShell>
        <EmptyState title={UNAVAILABLE_TITLE} text={UNAVAILABLE_TEXT} />
      </RiskShell>
    );
  }

  // hasData === true: a genuine evaluation happened. Build safely-displayable
  // cards from whatever the backend supplied, preserving the backend's own
  // ordering (never re-sorted here) and without mutating the source array.
  const rawSignals = Array.isArray(risk.signals) ? risk.signals : [];
  const signals = rawSignals.map(buildDisplaySignal).filter(Boolean);

  if (signals.length === 0) {
    return (
      <RiskShell>
        <EmptyState
          title="No active risk signals were detected from the currently available data."
          text="This reflects the checks currently available and is not a guarantee that no financial risk exists."
        />
      </RiskShell>
    );
  }

  const riskLevelLabel =
    isNonBlankString(risk.riskLevel) && RISK_LEVEL_LABELS[risk.riskLevel] ? RISK_LEVEL_LABELS[risk.riskLevel] : null;
  const signalCount = isFiniteNumber(risk.signalCount) ? risk.signalCount : signals.length;

  return (
    <RiskShell>
      <p className="risk-summary-line">
        {riskLevelLabel && (
          <>
            Overall level: <strong>{riskLevelLabel}</strong> ·{" "}
          </>
        )}
        {signalCount} active {signalCount === 1 ? "signal" : "signals"}
      </p>
      <ul className="risk-signal-list">
        {signals.map((signal) => (
          <li className="risk-signal-item" key={signal.key}>
            <div className="risk-signal-head">
              <span className="risk-signal-title">{signal.title}</span>
              {signal.severityKey && (
                <span className={`risk-severity-badge ${signal.severityKey}`}>
                  {SEVERITY_LABELS[signal.severityKey]}
                </span>
              )}
            </div>
            <p className="risk-signal-description">{signal.description}</p>
          </li>
        ))}
      </ul>
    </RiskShell>
  );
}
