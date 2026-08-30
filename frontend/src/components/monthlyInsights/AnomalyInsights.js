import { FaExclamationTriangle } from "react-icons/fa";
import "./AnomalyInsights.css";

// Material spending-review surfacing only.
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
//     hasData, reasonCode, flaggedCount, comparedExpenseCount,
//     uncomparableExpenseCount, ...
//     anomalies: [{
//       expenseId, expenseName, category, amount, expenseDate, severity,
//       reasonCode,
//       baseline: { scope, sampleCount, monthCount, medianAmount },
//       impact: { excessAmount, monthlyReferenceAmount,
//                 monthlyReferenceSource, percentage },
//       detection: { method, score, threshold, thresholdMultiple, amountRatio },
//     }]
//   }
// The flagged list lives at report.anomalies.anomalies -- NOT
// report.anomalies.records (that key only exists inside SIA's own bounded
// context copy, never on the stored report itself).

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
  const baseline = isPlainObject(raw.baseline) ? raw.baseline : null;
  const detection = isPlainObject(raw.detection) ? raw.detection : null;
  const impact = isPlainObject(raw.impact) ? raw.impact : null;
  const medianAmount =
    baseline && isFiniteNumber(baseline.medianAmount) && baseline.medianAmount > 0
      ? baseline.medianAmount
      : null;
  const sampleCount =
    baseline && isFiniteNumber(baseline.sampleCount) && baseline.sampleCount >= 0
      ? baseline.sampleCount
      : null;
  const monthCount =
    baseline && isFiniteNumber(baseline.monthCount) && baseline.monthCount > 0
      ? baseline.monthCount
      : null;
  const amountRatio =
    detection && isFiniteNumber(detection.amountRatio) && detection.amountRatio > 0
      ? detection.amountRatio
      : null;
  const excessAmount =
    impact && isFiniteNumber(impact.excessAmount) && impact.excessAmount > 0
      ? impact.excessAmount
      : null;
  const impactPercentage =
    impact && isFiniteNumber(impact.percentage) && impact.percentage > 0
      ? impact.percentage
      : null;
  const referenceSource = isNonBlankString(impact?.monthlyReferenceSource)
    ? impact.monthlyReferenceSource
    : null;
  const comparisonLabel = baseline?.scope === "expense_name" && name ? name : category;

  // The full, specific explanation is only ever built from real numbers
  // already on the contract -- no jargon (method/score/threshold) is ever
  // surfaced here. When any one of the three supporting numbers is missing
  // or malformed, a concise, still-honest fallback is shown instead of a
  // broken or partially-numeric sentence.
  const explanation = medianAmount !== null && excessAmount !== null
    ? `${formatMoney(amount)} was ${formatMoney(excessAmount)} above your usual ${formatMoney(medianAmount)} ${comparisonLabel} purchase.`
    : `${formatMoney(amount)} was meaningfully higher than your usual ${comparisonLabel} purchase.`;
  const evidence = sampleCount !== null
    ? `Compared with ${sampleCount} previous ${comparisonLabel} ${sampleCount === 1 ? "purchase" : "purchases"}${monthCount !== null ? ` across ${monthCount} ${monthCount === 1 ? "month" : "months"}` : ""}.`
    : null;
  const impactText = impactPercentage !== null
    ? `The extra amount equals about ${formatMultiple(impactPercentage)}% of ${referenceSource === "current_budget" ? "this month's budget" : "your usual monthly spending"}.`
    : null;

  return {
    key: isNonBlankString(raw.expenseId) ? raw.expenseId : `anomaly-${index}`,
    name,
    category,
    amountLabel: formatMoney(amount),
    dateLabel,
    ratioLabel: amountRatio !== null ? `${formatMultiple(amountRatio)}× usual` : null,
    explanation,
    evidence,
    impactText,
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
          Spending Worth Reviewing
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
          title="Spending review is unavailable right now."
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
            text="More matching purchase history is needed before this month's expenses can be compared reliably."
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
          title="Spending review is unavailable right now."
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
  const candidateCount = isFiniteNumber(anomalies.evaluatedExpenseCount)
    ? anomalies.evaluatedExpenseCount
    : null;
  const comparedCount = isFiniteNumber(anomalies.comparedExpenseCount)
    ? anomalies.comparedExpenseCount
    : null;
  const uncomparableCount = isFiniteNumber(anomalies.uncomparableExpenseCount)
    ? anomalies.uncomparableExpenseCount
    : candidateCount !== null && comparedCount !== null
      ? Math.max(0, candidateCount - comparedCount)
      : null;

  if (records.length === 0) {
    return (
      <AnomalyShell>
        <EmptyState
          title={comparedCount !== null
            ? `No material spending changes found among ${comparedCount} comparable ${comparedCount === 1 ? "expense" : "expenses"}.`
            : "No material spending changes found this month."}
          text={uncomparableCount > 0
            ? `${uncomparableCount} ${uncomparableCount === 1 ? "expense did" : "expenses did"} not yet have enough matching history for comparison.`
            : "Only purchases that are both unusual for you and meaningful to the month are shown here."}
        />
      </AnomalyShell>
    );
  }

  return (
    <AnomalyShell>
      <p className="anomaly-summary-line">
        {records.length} material spending {records.length === 1 ? "change" : "changes"} found
        {comparedCount !== null && candidateCount !== null
          ? ` after comparing ${comparedCount} of ${candidateCount} ${candidateCount === 1 ? "expense" : "expenses"}`
          : " from your own spending history"}.
      </p>
      <p className="anomaly-clarification">
        These are pattern comparisons, not error or fraud alerts. Small statistical differences are excluded.
      </p>
      <ul className="anomaly-list">
        {records.map((record) => (
          <li className="anomaly-item" key={record.key}>
            <div className="anomaly-item-head">
              <span className="anomaly-item-name">{record.name ?? record.category}</span>
              {record.ratioLabel && (
                <span className="anomaly-ratio-badge">
                  {record.ratioLabel}
                </span>
              )}
            </div>
            <p className="anomaly-item-meta">
              {record.category}
              {record.dateLabel ? ` · ${record.dateLabel}` : ""}
            </p>
            <p className="anomaly-item-amount">{record.amountLabel}</p>
            <p className="anomaly-item-explanation">{record.explanation}</p>
            {record.evidence && <p className="anomaly-item-evidence">{record.evidence}</p>}
            {record.impactText && <p className="anomaly-item-impact">{record.impactText}</p>}
          </li>
        ))}
      </ul>
    </AnomalyShell>
  );
}
