import { useMemo, useState } from "react";
import { FaChartLine } from "react-icons/fa6";
import "./SpendingForecast.css";

const formatMoney = (value) =>
  `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTargetMonth(targetMonth) {
  if (typeof targetMonth !== "string") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(targetMonth);
  if (!match) return targetMonth;
  const monthIndex = Number(match[2]) - 1;
  return monthIndex >= 0 && monthIndex <= 11
    ? `${MONTH_LABELS[monthIndex]} ${match[1]}`
    : targetMonth;
}

const RISK_PRESENTATION = {
  safe: { tone: "safe", symbol: "✓", label: "On track" },
  watch: { tone: "watch", symbol: "!", label: "Worth watching" },
  high: { tone: "high", symbol: "▲", label: "Likely over budget" },
};

function BudgetRiskBlock({ budgetRisk }) {
  if (!budgetRisk || typeof budgetRisk !== "object") return null;
  if (budgetRisk.status === "no_budget") {
    return (
      <div className="forecast-budget-block">
        <p className="forecast-budget-line">
          No budget is set for this month, so this projection is not compared with a limit.
        </p>
      </div>
    );
  }
  const presentation = RISK_PRESENTATION[budgetRisk.status];
  if (!presentation) return null;
  return (
    <div className="forecast-budget-block">
      <div>
        <p className="forecast-budget-kicker">Projected budget position</p>
        <p className="forecast-budget-line">
          {isFiniteNumber(budgetRisk.budgetAmount) ? formatMoney(budgetRisk.budgetAmount) : "—"} budget
          {isFiniteNumber(budgetRisk.predictedUtilizationPercentage) && (
            <> · {Math.round(budgetRisk.predictedUtilizationPercentage)}% projected</>
          )}
        </p>
        {isFiniteNumber(budgetRisk.predictedRemaining) && (
          <p className="forecast-budget-line">
            {budgetRisk.predictedRemaining >= 0
              ? `${formatMoney(budgetRisk.predictedRemaining)} may remain.`
              : `${formatMoney(Math.abs(budgetRisk.predictedRemaining))} above budget.`}
          </p>
        )}
      </div>
      <span className={`forecast-badge ${presentation.tone}`}>
        <span aria-hidden="true">{presentation.symbol}</span>{presentation.label}
      </span>
    </div>
  );
}

function ForecastShell({ children }) {
  return (
    <section className="forecast-container" aria-labelledby="forecast-heading">
      <div className="forecast-heading-row">
        <div className="heading-icon"><FaChartLine size={18} color="#FFFFFF" /></div>
        <h1 id="forecast-heading" className="forecast-h-text">Month-end Forecast</h1>
      </div>
      <div className="forecast-card">{children}</div>
    </section>
  );
}

function EmptyForecast({ title, children }) {
  return (
    <ForecastShell>
      <div className="forecast-empty">
        <p className="forecast-empty-title">{title}</p>
        <p className="forecast-empty-text">{children}</p>
      </div>
    </ForecastShell>
  );
}

export default function SpendingForecast({ report }) {
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const forecast = report?.forecast;
  const currentMonth = forecast?.currentMonthForecast;
  const categories = useMemo(() => {
    const list = currentMonth?.categories;
    return Array.isArray(list)
      ? list.filter(
          (entry) =>
            entry &&
            typeof entry.category === "string" &&
            isFiniteNumber(entry.projectedAmount)
        )
      : [];
  }, [currentMonth]);

  if (!forecast || typeof forecast !== "object" || !currentMonth || typeof currentMonth !== "object") {
    return (
      <EmptyForecast title="Forecast temporarily unavailable">
        We could not prepare the current month projection just now. Your expenses and budgets are unaffected.
      </EmptyForecast>
    );
  }

  const historyMonths = isFiniteNumber(currentMonth.historyMonthsUsed)
    ? currentMonth.historyMonthsUsed
    : null;
  if (currentMonth.hasData !== true || !isFiniteNumber(currentMonth.estimate)) {
    return (
      <EmptyForecast title="Not enough history yet">
        {historyMonths !== null
          ? `There ${historyMonths === 1 ? "is" : "are"} ${historyMonths} complete ${historyMonths === 1 ? "month" : "months"} available. Keep tracking expenses and the month-end projection will appear after three complete months.`
          : "Keep tracking expenses and the month-end projection will appear after a few complete months."}
      </EmptyForecast>
    );
  }

  const targetMonth = formatTargetMonth(currentMonth.targetMonth);
  const lower = isFiniteNumber(currentMonth.range?.lower) ? currentMonth.range.lower : null;
  const upper = isFiniteNumber(currentMonth.range?.upper) ? currentMonth.range.upper : null;
  const qualityStatus = currentMonth.dataQuality?.status;
  const qualityLabel = qualityStatus === "limited"
    ? "Limited history"
    : qualityStatus === "sufficient"
      ? "Sufficient history"
      : "History quality unavailable";

  return (
    <ForecastShell>
      <div className="forecast-hero">
        <div>
          <p className="forecast-target-label">
            {targetMonth ? `Projected spending · ${targetMonth}` : "Projected spending · current month"}
          </p>
          <p className="forecast-headline-amount">{formatMoney(currentMonth.estimate)}</p>
          <p className="forecast-headline-caption">Projected total by month end</p>
        </div>
        <div className="forecast-summary-grid">
          <div className="forecast-summary-item">
            <span>Spent so far</span>
            <strong>{formatMoney(currentMonth.spentSoFar)}</strong>
          </div>
          <div className="forecast-summary-item">
            <span>Expected remaining</span>
            <strong>{formatMoney(currentMonth.expectedRemaining)}</strong>
          </div>
        </div>
      </div>

      {lower !== null && upper !== null && (
        <p className="forecast-range-text">
          Reasonable range <strong>{formatMoney(lower)}</strong> – <strong>{formatMoney(upper)}</strong>
        </p>
      )}

      <div className="forecast-badge-row">
        <span className="forecast-badge neutral">{qualityLabel}</span>
        {historyMonths !== null && (
          <span className="forecast-badge neutral">
            {historyMonths} complete {historyMonths === 1 ? "month" : "months"} used
          </span>
        )}
      </div>

      <BudgetRiskBlock budgetRisk={currentMonth.budgetRisk} />

      {categories.length > 0 && (
        <div className="forecast-category-section">
          <button
            type="button"
            className="forecast-category-toggle"
            aria-expanded={categoriesExpanded}
            aria-controls="forecast-category-breakdown"
            onClick={() => setCategoriesExpanded((expanded) => !expanded)}
          >
            <span>
              <span className="forecast-category-toggle-title">Projected by category</span>
              <span className="forecast-category-toggle-meta">
                {categories.length} {categories.length === 1 ? "category" : "categories"}
              </span>
            </span>
            <span className="forecast-category-toggle-indicator">
              <span>{categoriesExpanded ? "Collapse" : "Expand"}</span>
              <span className={`forecast-category-chevron ${categoriesExpanded ? "expanded" : ""}`} aria-hidden="true">
                ▾
              </span>
            </span>
          </button>
          {categoriesExpanded && (
            <ul id="forecast-category-breakdown" className="forecast-category-list">
              {categories.map((entry) => {
                const share = isFiniteNumber(entry.sharePercentage) ? entry.sharePercentage : 0;
                return (
                  <li className="forecast-category-row" key={entry.category}>
                    <div className="forecast-category-label">
                      <div>
                        <span className="forecast-category-name">{entry.category}</span>
                        <span className="forecast-category-subtext">
                          {formatMoney(entry.actualAmount)} spent
                          {entry.expectedRemaining > 0 && ` · ${formatMoney(entry.expectedRemaining)} expected`}
                        </span>
                      </div>
                      <span className="forecast-category-value">
                        {formatMoney(entry.projectedAmount)} · {Math.round(share)}%
                      </span>
                    </div>
                    <div className="forecast-bar-track" aria-hidden="true">
                      <div className="forecast-bar-fill" style={{ width: `${Math.min(100, Math.max(0, share))}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <p className="forecast-estimate-note">
        This projection combines everything already spent with an estimate for the remaining days.
        Actual spending can differ from the projection.
      </p>
    </ForecastShell>
  );
}
