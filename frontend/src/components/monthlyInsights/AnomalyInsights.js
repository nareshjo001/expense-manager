import { FaExclamationTriangle } from "react-icons/fa";
import "./AnomalyInsights.css";

// Material spending-review surfacing only.

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const isNonBlankString = (value) => typeof value === "string" && value.trim() !== "";

// Whole rupees only, explicit "en-IN" locale so the grouping is identical on
const formatMoney = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

// Matches the project's established absolute-date style already used for
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
