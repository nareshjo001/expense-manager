import { useState, useMemo } from "react";
import {
  FaChevronDown,
  FaUtensils,
  FaShoppingCart,
  FaReceipt,
  FaPlane,
  FaGamepad,
  FaMedkit,
  FaCoins,
  FaGraduationCap,
  FaWallet,
} from "react-icons/fa";
// DAT-001-T06 -- whole rupees, explicit en-IN grouping, but no longer a
// private copy: the shared formatter guarantees this rounds identically to
// every other money display in the app.
import { formatMoneyApprox as formatMoney } from "../../utils/money";
import "./AnomalyInsights.css";

// Deterministic category to icon mapping matching the app standard
const getCategoryIcon = (category = "") => {
  const value = String(category || "").trim().toLowerCase();
  if (
    value.includes("food") ||
    value.includes("swiggy") ||
    value.includes("zomato") ||
    value.includes("dine") ||
    value.includes("dining") ||
    value.includes("restaurant") ||
    value.includes("cafe") ||
    value.includes("coffee") ||
    value.includes("snack") ||
    value.includes("eat")
  ) {
    return FaUtensils;
  }
  if (
    value.includes("shop") ||
    value.includes("grocer") ||
    value.includes("mart") ||
    value.includes("store") ||
    value.includes("cloth") ||
    value.includes("essential") ||
    value.includes("supermarket") ||
    value.includes("retail")
  ) {
    return FaShoppingCart;
  }
  if (
    value.includes("bill") ||
    value.includes("utilit") ||
    value.includes("electric") ||
    value.includes("water") ||
    value.includes("recharge") ||
    value.includes("subscript") ||
    value.includes("rent") ||
    value.includes("broadband") ||
    value.includes("wifi") ||
    value.includes("gas bill")
  ) {
    return FaReceipt;
  }
  if (
    value.includes("travel") ||
    value.includes("transport") ||
    value.includes("flight") ||
    value.includes("air") ||
    value.includes("fuel") ||
    value.includes("gas") ||
    value.includes("petrol") ||
    value.includes("diesel") ||
    value.includes("cab") ||
    value.includes("uber") ||
    value.includes("ola") ||
    value.includes("train") ||
    value.includes("bus") ||
    value.includes("metro")
  ) {
    return FaPlane;
  }
  if (
    value.includes("entertain") ||
    value.includes("movie") ||
    value.includes("cinema") ||
    value.includes("game") ||
    value.includes("gaming") ||
    value.includes("play") ||
    value.includes("netflix") ||
    value.includes("prime") ||
    value.includes("hulu") ||
    value.includes("disney") ||
    value.includes("stream") ||
    value.includes("music") ||
    value.includes("spotify")
  ) {
    return FaGamepad;
  }
  if (
    value.includes("health") ||
    value.includes("medic") ||
    value.includes("doctor") ||
    value.includes("hospital") ||
    value.includes("pharm") ||
    value.includes("fitness") ||
    value.includes("gym")
  ) {
    return FaMedkit;
  }
  if (
    value.includes("invest") ||
    value.includes("save") ||
    value.includes("finance") ||
    value.includes("bank") ||
    value.includes("stock") ||
    value.includes("mutual") ||
    value.includes("crypto")
  ) {
    return FaCoins;
  }
  if (
    value.includes("educat") ||
    value.includes("exam") ||
    value.includes("fee") ||
    value.includes("fees") ||
    value.includes("study") ||
    value.includes("book") ||
    value.includes("course") ||
    value.includes("tuition") ||
    value.includes("school") ||
    value.includes("college") ||
    value.includes("academy") ||
    value.includes("training") ||
    value.includes("university") ||
    value.includes("learning")
  ) {
    return FaGraduationCap;
  }
  return FaWallet;
};

// Material spending-review surfacing and category projections consolidated.

const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const isNonBlankString = (value) => typeof value === "string" && value.trim() !== "";

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

function AnomalyReviewItem({ record }) {
  const CategoryIcon = getCategoryIcon(record.category);
  const displayName = record.name || record.category;

  return (
    <li className="anomaly-item" key={record.key}>
      {/* Top Header: Category Icon + Brand (Left) & Amount + Ratio Badge (Right) */}
      <div className="anomaly-item-header">
        <div className="anomaly-item-brand">
          <div className="anomaly-cat-icon-tile" aria-hidden="true">
            <CategoryIcon size={18} />
          </div>
          <div className="anomaly-brand-details">
            <span className="anomaly-item-name" title={displayName}>
              {displayName}
            </span>
            <span className="anomaly-item-meta">
              {record.category}{record.dateLabel ? ` · ${record.dateLabel}` : ""}
            </span>
          </div>
        </div>

        <div className="anomaly-item-right">
          <span className="anomaly-item-amount">{record.amountLabel}</span>
          {record.ratioLabel && (
            <span className="anomaly-ratio-badge">
              {record.ratioLabel}
            </span>
          )}
        </div>
      </div>

      {/* Structured Explanation & Context Callout */}
      <div className="anomaly-item-body">
        <div className="anomaly-explanation-card">
          <p className="anomaly-item-explanation">{record.explanation}</p>
        </div>

        {(record.evidence || record.impactText) && (
          <div className="anomaly-context-tags">
            {record.impactText && (
              <p className="anomaly-item-impact">
                <span className="anomaly-tag-bullet impact-bullet" aria-hidden="true">⚡</span>
                <span>{record.impactText}</span>
              </p>
            )}
            {record.evidence && (
              <p className="anomaly-item-evidence">
                <span className="anomaly-tag-bullet evidence-bullet" aria-hidden="true">•</span>
                <span>{record.evidence}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CategoryEquationCard({ entry }) {
  const share = isFiniteNumber(entry.sharePercentage) ? entry.sharePercentage : 0;
  const CategoryIcon = getCategoryIcon(entry.category);
  const actual = isFiniteNumber(entry.actualAmount) ? entry.actualAmount : 0;
  const expected = isFiniteNumber(entry.expectedRemaining)
    ? Math.max(0, entry.expectedRemaining)
    : 0;
  const projected = isFiniteNumber(entry.projectedAmount)
    ? entry.projectedAmount
    : actual + expected;

  return (
    <div className="projected-category-row">
      {/* Top Row: Category Brand (Left) & Share Badge (Right) */}
      <div className="projected-cat-header">
        <div className="projected-cat-brand">
          <div className="projected-cat-icon-tile" aria-hidden="true">
            <CategoryIcon size={18} />
          </div>
          <span className="projected-cat-name" title={entry.category}>
            {entry.category}
          </span>
        </div>

        <div className="projected-cat-share-wrap">
          <span className="projected-cat-share-badge">
            {Math.round(share)}%
          </span>
          <span className="projected-cat-share-caption">
            of monthly<br />spending
          </span>
        </div>
      </div>

      {/* Bottom Row: Equation */}
      <div className="projected-cat-equation">
        <div className="projected-eq-block">
          <div className="projected-eq-label-row">
            <span className="projected-eq-dot spent-dot" aria-hidden="true" />
            <span className="projected-eq-label">Spent so far</span>
          </div>
          <span className="projected-eq-amount">{formatMoney(actual)}</span>
        </div>

        <span className="projected-eq-op" aria-hidden="true">
          +
        </span>

        <div className="projected-eq-block">
          <div className="projected-eq-label-row">
            <span className="projected-eq-dot expected-dot" aria-hidden="true" />
            <span className="projected-eq-label">Expected (remaining)</span>
          </div>
          <span className="projected-eq-amount">{formatMoney(expected)}</span>
        </div>

        <span className="projected-eq-op" aria-hidden="true">
          =
        </span>

        <div className="projected-eq-block projected-total-block">
          <div className="projected-eq-label-row">
            <span className="projected-eq-label total-label">Projected total</span>
          </div>
          <span className="projected-eq-amount total-amount">
            {formatMoney(projected)}
          </span>
        </div>
      </div>
    </div>
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
  const [showAllCategories, setShowAllCategories] = useState(false);
  const anomalies = report?.anomalies;
  const currentMonthForecast = report?.forecast?.currentMonthForecast;

  const categories = useMemo(() => {
    const list = currentMonthForecast?.categories;
    return Array.isArray(list)
      ? list.filter((entry) => {
          if (!entry || typeof entry.category !== "string") return false;
          const projected = isFiniteNumber(entry.projectedAmount) ? entry.projectedAmount : 0;
          if (Math.round(projected) <= 0) return false;
          if (isFiniteNumber(entry.sharePercentage) && Math.round(entry.sharePercentage) <= 0) {
            return false;
          }
          return true;
        })
      : [];
  }, [currentMonthForecast]);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => (b.projectedAmount ?? 0) - (a.projectedAmount ?? 0));
  }, [categories]);

  let leftContent = null;

  // The anomalies block is missing or not shaped like a real result at all
  if (!isPlainObject(anomalies) || typeof anomalies.hasData !== "boolean") {
    leftContent = (
      <EmptyState
        title="Spending review is unavailable right now."
        text="We could not check this month's expenses against your history just now. Your expenses and budgets are unaffected — please try again shortly."
      />
    );
  } else if (anomalies.hasData === false) {
    const reasonCode = anomalies.reasonCode;

    if (reasonCode === "NO_ELIGIBLE_CURRENT_EXPENSES") {
      leftContent = (
        <EmptyState
          title="No expenses to check yet this month"
          text="There are no eligible expenses recorded this month to compare against your spending history."
        />
      );
    } else if (reasonCode === "NO_BASELINE_YET") {
      leftContent = (
        <EmptyState
          title="Still building your spending history"
          text="More matching purchase history is needed before this month's expenses can be compared reliably."
        />
      );
    } else {
      leftContent = (
        <EmptyState
          title="Spending review is unavailable right now."
          text="We could not check this month's expenses against your history just now. Your expenses and budgets are unaffected — please try again shortly."
        />
      );
    }
  } else {
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
      leftContent = (
        <EmptyState
          title={comparedCount !== null
            ? `No material spending changes found among ${comparedCount} comparable ${comparedCount === 1 ? "expense" : "expenses"}.`
            : "No material spending changes found this month."}
          text={uncomparableCount > 0
            ? `${uncomparableCount} ${uncomparableCount === 1 ? "expense did" : "expenses did"} not yet have enough matching history for comparison.`
            : "Only purchases that are both unusual for you and meaningful to the month are shown here."}
        />
      );
    } else {
      leftContent = (
        <>
          <p className="anomaly-clarification">
            These are pattern comparisons, not error or fraud alerts. Small statistical differences are excluded.
          </p>
          <ul className="anomaly-list">
            {records.map((record) => (
              <AnomalyReviewItem key={record.key} record={record} />
            ))}
          </ul>
        </>
      );
    }
  }

  return (
    <section className="anomaly-container" aria-labelledby="anomaly-heading">
      <div className="unified-insights-grid">
        {/* LEFT CARD — Spending Worth Reviewing */}
        <div className="unified-insight-card anomaly-review-card">
          <div className="unified-card-head">
            <div className="unified-card-title-row">
              <span className="heading-accent-line anomaly-accent-line" aria-hidden="true" />
              <h2 id="anomaly-heading" className="unified-card-title">
                Spending Worth Reviewing
              </h2>
            </div>
            <p className="unified-card-subtitle">
              Unusual spending patterns & material changes
            </p>
          </div>
          <div className="unified-card-body">{leftContent}</div>
        </div>

        {/* RIGHT CARD — Projected by Category */}
        <div className="unified-insight-card projected-category-card">
          <div className="unified-card-head">
            <div className="unified-card-title-row">
              <span className="heading-accent-line projected-accent-line" aria-hidden="true" />
              <h2 className="unified-card-title">Projected by Category</h2>
            </div>
            <p className="unified-card-subtitle">
              Top categories by projected month-end spending
            </p>
          </div>
          <div className="unified-card-body">
            {sortedCategories.length > 0 ? (
              <div className="projected-category-list">
                {sortedCategories.slice(0, 1).map((entry) => (
                  <CategoryEquationCard key={entry.category} entry={entry} />
                ))}

                {sortedCategories.length > 1 && (
                  <div
                    className={`projected-categories-expandable ${showAllCategories ? "is-expanded" : ""}`}
                    id="projected-categories-rest"
                    aria-hidden={!showAllCategories}
                  >
                    <div className="projected-categories-expandable-inner">
                      {sortedCategories.slice(1).map((entry) => (
                        <CategoryEquationCard key={entry.category} entry={entry} />
                      ))}
                    </div>
                  </div>
                )}

                <p className="projected-footnote">
                  Projections combine month-to-date spending with historical pace.
                </p>

                {sortedCategories.length > 1 && (
                  <div className="projected-category-actions-row">
                    <button
                      type="button"
                      className="projected-show-all-btn"
                      onClick={() => setShowAllCategories((prev) => !prev)}
                      aria-expanded={showAllCategories}
                      aria-controls="projected-categories-rest"
                    >
                      <span>{showAllCategories ? "Show less" : `Show all (${sortedCategories.length})`}</span>
                      <FaChevronDown
                        className={`projected-show-all-chevron ${showAllCategories ? "expanded" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="projected-empty-state">
                <p className="projected-empty-title">Category projection unavailable</p>
                <p className="projected-empty-text">
                  Category projections will appear once sufficient spending history is recorded.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
