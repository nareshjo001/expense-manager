import { FaExclamationTriangle } from "react-icons/fa";
import "./AnomalyInsights.css";

// Anomaly Detection Layer V1 -- product surfacing only.
//
// This component is a pure, read-only renderer over `report.anomalies`,
// which backend/analytics/analyzers/expenseAnomalyAnalyzer.js already
// computes and backend/analytics/reportGenerator.js already stores on the
// SAME report every other Monthly Insights section reads (see
// MonthlyInsightPage.js). There is deliberately no second fetch, no new
// query key, and no useReport() call here -- exactly the pattern
// SpendingForecast.js already established for this page.
//
// This is a BEHAVIOURAL observation against the user's own history, never a
// fraud, wrongdoing, or "incorrect expense" signal -- the wording below is
// chosen carefully to never imply otherwise.
//
// Contract read here (see backend/analytics/analyzers/expenseAnomalyAnalyzer.js
// and backend/analytics/analyzers/scores/expenseAnomalyRules.js):
//   report.anomalies = {
//     hasData, reasonCode, flaggedCount, insufficientHistoryCategoryCount, ...
//     anomalies: [{
//       expenseId, expenseName, category, amount, expenseDate, severity,
//       reasonCode,
//       baseline: { scope, sampleCount, medianAmount },
//       detection: { method, score, threshold, thresholdMultiple, amountRatio },
//     }]
//   }
// The flagged list lives at report.anomalies.anomalies -- NOT
// report.anomalies.records (that key only exists inside SIA's own bounded
// context copy, never on the stored report itself).

const SEVERITY_LABELS = {
  moderate: "Moderate",
  high: "High",
  very_high: "Very high",
};

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const isNonBlankString = (value) => typeof value === "string" && value.trim() !== "";

// Whole rupees only, explicit "en-IN" locale so the grouping is identical on
// every machine regardless of runtime default locale (same lesson already
// applied in SpendingForecast.js's own formatMoney).
const formatMoney = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

// Matches the project's established absolute-date style already used for
// expense dates elsewhere (see ExpenseItem.js's formatDate: en-GB,
// DD Mon YYYY). Returns null -- never the string "Invalid Date" -- when the
// value cannot be parsed.
const formatExpenseDate = (value) => {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// A multiple like 7.02 reads as "7x"; 7.4 stays "7.4x". Never shows more
// than one decimal place, and never a raw z-score or method name.
const formatMultiple = (ratio) => {
  const rounded = Math.round(ratio * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

// Builds one safely-displayable card from a raw backend anomaly record, or
// null when the record is too malformed to show at all (missing amount or
// category -- the two fields every other piece of the card depends on).
// Never mutates `raw`.
function toDisplayRecord(raw, index) {
  if (!isPlainObject(raw)) return null;

  const amount = isFiniteNumber(raw.amount) && raw.amount > 0 ? raw.amount : null;
  const category = isNonBlankString(raw.category) ? raw.category : null;
  if (amount === null || category === null) return null;

  const name = isNonBlankString(raw.expenseName) ? raw.expenseName : null;
  const dateLabel = formatExpenseDate(raw.expenseDate);
  const severityKey = isNonBlankString(raw.severity) && SEVERITY_LABELS[raw.severity]
    ? raw.severity
    : null;

  const baseline = isPlainObject(raw.baseline) ? raw.baseline : null;
  const detection = isPlainObject(raw.detection) ? raw.detection : null;
  const medianAmount =
    baseline && isFiniteNumber(baseline.medianAmount) && baseline.medianAmount > 0
      ? baseline.medianAmount
      : null;
  const sampleCount =
    baseline && isFiniteNumber(baseline.sampleCount) && baseline.sampleCount >= 0
      ? baseline.sampleCount
      : null;
  const amountRatio =
    detection && isFiniteNumber(detection.amountRatio) && detection.amountRatio > 0
      ? detection.amountRatio
      : null;

  // The full, specific explanation is only ever built from real numbers
  // already on the contract -- no jargon (method/score/threshold) is ever
  // surfaced here. When any one of the three supporting numbers is missing
  // or malformed, a concise, still-honest fallback is shown instead of a
  // broken or partially-numeric sentence.
  const explanation =
    medianAmount !== null && sampleCount !== null && amountRatio !== null
      ? `${formatMoney(amount)} was ${formatMultiple(amountRatio)}× your typical ${category} expense of ${formatMoney(medianAmount)}, based on ${sampleCount} previous ${sampleCount === 1 ? "expense" : "expenses"}.`
      : `${formatMoney(amount)} is unusual compared with your recent ${category} spending.`;

  return {
    key: isNonBlankString(raw.expenseId) ? raw.expenseId : `anomaly-${index}`,
    name,
    category,
    amountLabel: formatMoney(amount),
    dateLabel,
    severityKey,
    explanation,
  };
}

function AnomalyShell({ children }) {
  return (
    <section className="anomaly-container" aria-labelledby="anomaly-heading">
      <div className="anomaly-heading-row">
        <div className="anomaly-heading-icon">
          <FaExclamationTriangle size={16} color="#FFFFFF" />
        </div>
        <h1 id="anomaly-heading" className="anomaly-h-text">
          Unusual Spending
        </h1>
      </div>
      <div className="anomaly-panel">{children}</div>
    </section>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="anomaly-empty">
      <p className="anomaly-empty-title">{title}</p>
      <p className="anomaly-empty-text">{text}</p>
    </div>
  );
}

export default function AnomalyInsights({ report }) {
  const anomalies = report?.anomalies;

  // The anomalies block is missing or not shaped like a real result at all
  // (e.g. an older cached report, or the analytics layer could not produce
  // this section this time). This is deliberately NOT the same message as
  // "no unusual expenses" -- an unavailable check is never presented as a
  // clean bill of health.
  if (!isPlainObject(anomalies) || typeof anomalies.hasData !== "boolean") {
    return (
      <AnomalyShell>
        <EmptyState
          title="Unusual-spending insights are unavailable right now."
          text="We could not check this month's expenses against your history just now. Your expenses and budgets are unaffected — please try again shortly."
        />
      </AnomalyShell>
    );
  }

  if (anomalies.hasData === false) {
    const reasonCode = anomalies.reasonCode;

    if (reasonCode === "NO_ELIGIBLE_CURRENT_EXPENSES") {
      return (
        <AnomalyShell>
          <EmptyState
            title="No expenses to check yet this month"
            text="There are no eligible expenses recorded this month to compare against your spending history."
          />
        </AnomalyShell>
      );
    }

    if (reasonCode === "NO_BASELINE_YET") {
      return (
        <AnomalyShell>
          <EmptyState
            title="Still building your spending history"
            text="BALENISA needs at least 10 earlier expenses in the same category before it can make a reliable comparison."
          />
        </AnomalyShell>
      );
    }

    // An explicit hasData:false with a reason code this component does not
    // recognise -- treated the same as "unavailable", never as "normal
    // spending", since no real evaluation is confirmed to have happened.
    return (
      <AnomalyShell>
        <EmptyState
          title="Unusual-spending insights are unavailable right now."
          text="We could not check this month's expenses against your history just now. Your expenses and budgets are unaffected — please try again shortly."
        />
      </AnomalyShell>
    );
  }

  // hasData === true: a genuine evaluation happened. Build safely-displayable
  // cards from whatever the backend supplied, without ever reordering the
  // backend's own ranking and without mutating the source array.
  const rawList = Array.isArray(anomalies.anomalies) ? anomalies.anomalies : [];
  const records = rawList.map(toDisplayRecord).filter(Boolean);

  if (records.length === 0) {
    return (
      <AnomalyShell>
        <EmptyState
          title="No unusual expenses were detected this month."
          text="Unusual does not necessarily mean incorrect—it only differs from your recent spending pattern."
        />
      </AnomalyShell>
    );
  }

  return (
    <AnomalyShell>
      <p className="anomaly-summary-line">
        {records.length} unusual {records.length === 1 ? "expense" : "expenses"} found this
        month, based on your own spending history.
      </p>
      <p className="anomaly-clarification">
        Unusual does not necessarily mean incorrect—it only differs from your recent spending pattern.
      </p>
      <ul className="anomaly-list">
        {records.map((record) => (
          <li className="anomaly-item" key={record.key}>
            <div className="anomaly-item-head">
              <span className="anomaly-item-name">{record.name ?? record.category}</span>
              {record.severityKey && (
                <span className={`anomaly-severity-badge ${record.severityKey}`}>
                  {SEVERITY_LABELS[record.severityKey]}
                </span>
              )}
            </div>
            <p className="anomaly-item-meta">
              {record.category}
              {record.dateLabel ? ` · ${record.dateLabel}` : ""}
            </p>
            <p className="anomaly-item-amount">{record.amountLabel}</p>
            <p className="anomaly-item-explanation">{record.explanation}</p>
          </li>
        ))}
      </ul>
    </AnomalyShell>
  );
}
