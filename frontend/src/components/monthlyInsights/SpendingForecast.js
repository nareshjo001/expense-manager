import { useMemo } from "react";
import { FaChartLine } from "react-icons/fa6";
import "./SpendingForecast.css";

// Prediction Layer V1 -- the Spending Forecast section of the Insights page.
//
// Reads ONLY `report.forecast`, which the existing analytics report already
// supplies through the existing useReport()/TanStack Query flow -- there is
// deliberately no second fetch, no new query key and no parallel fetching
// architecture here. Page-level loading and API-error states remain owned by
// MonthlyInsightPage.js (Spinner / "Failed to load report."), exactly as they
// already are for every other section; this component covers the states that
// are specific to the forecast itself.
//
// Every figure rendered is an ESTIMATE and is labelled as such. Nothing here
// invents a number: when the backend says a horizon or the whole forecast is
// unavailable, the real reason is shown rather than a guessed value, and no
// accuracy percentage is ever displayed because none is measured.

// Whole rupees only. The backend keeps 2dp precision for reconciliation, but
// displaying paise on a projection would imply precision this estimate does
// not have.
//
// The "en-IN" locale is passed EXPLICITLY rather than relying on the
// runtime's default: a bare toLocaleString() groups by the machine's locale,
// so the same amount rendered as "1,50,000" on an en-IN machine but
// "150,000" on an en-US one (and on most CI runners). Since these are rupee
// amounts, the Indian grouping is correct everywhere, and stating it here
// makes the output identical on every machine with no environment variable
// required. Rounding, the Number()/|| 0 fallback and the ₹ prefix are
// unchanged.
const formatMoney = (value) =>
  `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// "2026-08" -> "August 2026". Falls back to the raw label rather than
// throwing or inventing a month if the string is not the expected shape.
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatTargetMonth(targetMonth) {
  if (typeof targetMonth !== "string") return null;
  const match = /^(\d{4})-(\d{2})$/.exec(targetMonth);
  if (!match) return targetMonth;
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return targetMonth;
  return `${MONTH_LABELS[monthIndex]} ${match[1]}`;
}

// Risk presentation. The symbol and the words carry the meaning; colour is
// only ever a redundant reinforcement, never the sole signal.
const RISK_PRESENTATION = {
  safe: { tone: "safe", symbol: "✓", label: "On track" },
  watch: { tone: "watch", symbol: "!", label: "Worth watching" },
  high: { tone: "high", symbol: "▲", label: "Likely over budget" },
};

function BudgetRiskBlock({ budgetRisk }) {
  if (!budgetRisk || typeof budgetRisk !== "object") return null;

  const { status } = budgetRisk;

  if (status === "no_budget") {
    return (
      <div className="forecast-budget-block">
        <p className="forecast-budget-line">
          No budget has been set for this month yet, so there is nothing to compare this
          estimate against.
        </p>
      </div>
    );
  }

  if (status === "insufficient_data" || !RISK_PRESENTATION[status]) return null;

  const presentation = RISK_PRESENTATION[status];
  const { budgetAmount, predictedUtilizationPercentage, predictedRemaining } = budgetRisk;

  return (
    <div className="forecast-budget-block">
      <p className="forecast-budget-line">
        <strong>Against your budget:</strong>{" "}
        {isFiniteNumber(budgetAmount) ? formatMoney(budgetAmount) : "—"}
        {isFiniteNumber(predictedUtilizationPercentage) && (
          <> · about {Math.round(predictedUtilizationPercentage)}% of it, based on this estimate</>
        )}
      </p>
      {isFiniteNumber(predictedRemaining) && (
        <p className="forecast-budget-line">
          {predictedRemaining >= 0
            ? `That would leave roughly ${formatMoney(predictedRemaining)} unspent.`
            : `That would put you roughly ${formatMoney(Math.abs(predictedRemaining))} over budget.`}
        </p>
      )}
      <p className="forecast-budget-line">
        <span className={`forecast-badge ${presentation.tone}`}>
          <span aria-hidden="true">{presentation.symbol}</span>
          {presentation.label}
        </span>
      </p>
    </div>
  );
}

function HorizonCard({ title, horizon }) {
  if (!horizon || horizon.hasData !== true || !isFiniteNumber(horizon.estimate)) return null;

  const lower = horizon.range && isFiniteNumber(horizon.range.lower) ? horizon.range.lower : null;
  const upper = horizon.range && isFiniteNumber(horizon.range.upper) ? horizon.range.upper : null;

  return (
    <div className="forecast-horizon-card">
      <p className="forecast-horizon-title">{title}</p>
      <p className="forecast-horizon-amount">{formatMoney(horizon.estimate)}</p>
      {lower !== null && upper !== null && (
        <p className="forecast-horizon-range">
          Range {formatMoney(lower)} – {formatMoney(upper)}
        </p>
      )}
    </div>
  );
}

function ForecastShell({ children }) {
  return (
    <section className="forecast-container" aria-labelledby="forecast-heading">
      <div className="forecast-heading-row">
        <div className="heading-icon">
          <FaChartLine size={18} color="#FFFFFF" />
        </div>
        <h1 id="forecast-heading" className="forecast-h-text">
          Spending Forecast
        </h1>
      </div>
      <div className="forecast-card">{children}</div>
    </section>
  );
}

export default function SpendingForecast({ report }) {
  const forecast = report?.forecast;

  // Prediction Layer V1 (corrected): this section reads ONLY the true
  // next-calendar-month forecast. The legacy `nextMonthForecast` field
  // projects the CURRENT, in-progress month despite its name, so it is
  // never read here and is never used as a fallback -- showing it under a
  // "next month" label would misstate which month the figure describes.
  const nextCalendarMonth = forecast?.nextCalendarMonthForecast;

  const categories = useMemo(() => {
    const list = nextCalendarMonth?.categories;
    return Array.isArray(list) ? list.filter((entry) => entry && typeof entry === "object") : [];
  }, [nextCalendarMonth]);

  // The forecast section is missing entirely from the report -- e.g. an older
  // cached report shape, or the analytics layer could not produce this
  // section on this request. Deliberately phrased as temporary, and never
  // presented as "you have no data".
  if (!forecast || typeof forecast !== "object") {
    return (
      <ForecastShell>
        <div className="forecast-empty">
          <p className="forecast-empty-title">Forecast temporarily unavailable</p>
          <p className="forecast-empty-text">
            We could not prepare a spending forecast just now. Your expenses and budgets are
            unaffected — please try again shortly.
          </p>
        </div>
      </ForecastShell>
    );
  }

  const dataQuality = forecast.dataQuality;
  const completedMonths = isFiniteNumber(dataQuality?.completedMonths) ? dataQuality.completedMonths : null;

  // The true next-calendar-month field is missing or malformed entirely
  // (e.g. an older cached report shape). Deliberately the temporarily-
  // unavailable state rather than a silent fall back to the legacy
  // current-month projection.
  if (!nextCalendarMonth || typeof nextCalendarMonth !== "object") {
    return (
      <ForecastShell>
        <div className="forecast-empty">
          <p className="forecast-empty-title">Forecast temporarily unavailable</p>
          <p className="forecast-empty-text">
            We could not prepare a spending forecast just now. Your expenses and budgets are
            unaffected — please try again shortly.
          </p>
        </div>
      </ForecastShell>
    );
  }

  // Not enough completed months for even a next-calendar-month estimate.
  // The real reason is shown; no number is guessed.
  if (nextCalendarMonth.hasData !== true) {
    return (
      <ForecastShell>
        <div className="forecast-empty">
          <p className="forecast-empty-title">Not enough history yet</p>
          <p className="forecast-empty-text">
            {completedMonths !== null
              ? `A forecast needs a few complete months of spending to be meaningful. So far there ${
                  completedMonths === 1 ? "is" : "are"
                } ${completedMonths} complete ${completedMonths === 1 ? "month" : "months"} of history.`
              : "A forecast needs a few complete months of spending to be meaningful."}
          </p>
          <p className="forecast-empty-text">
            Keep tracking your expenses and this section will start showing an estimate.
          </p>
        </div>
      </ForecastShell>
    );
  }

  // Prefer the horizon's own target label, falling back to the forecast
  // section's -- both are the NEXT calendar month, never the current one.
  const targetMonthLabel = formatTargetMonth(nextCalendarMonth.targetMonth ?? forecast.targetMonth);
  const range = nextCalendarMonth.range;
  const lower = range && isFiniteNumber(range.lower) ? range.lower : null;
  const upper = range && isFiniteNumber(range.upper) ? range.upper : null;
  const isLimited = dataQuality?.status === "limited";

  return (
    <ForecastShell>
      <p className="forecast-target-label">
        {targetMonthLabel ? `Estimated spending · next month · ${targetMonthLabel}` : "Estimated spending · next month"}
      </p>
      <p className="forecast-headline-amount">{formatMoney(nextCalendarMonth.estimate)}</p>

      {lower !== null && upper !== null && (
        <p className="forecast-range-text">
          Likely between <strong>{formatMoney(lower)}</strong> and <strong>{formatMoney(upper)}</strong>
        </p>
      )}

      <div className="forecast-badge-row">
        <span className="forecast-badge neutral">
          {isLimited ? "Limited history" : "Sufficient history"}
        </span>
        {completedMonths !== null && (
          <span className="forecast-badge neutral">
            {completedMonths} complete {completedMonths === 1 ? "month" : "months"} used
          </span>
        )}
      </div>

      <BudgetRiskBlock budgetRisk={forecast.budgetRisk} />

      {categories.length > 0 && (
        <>
          <h2 className="forecast-section-title">Where it is likely to go</h2>
          <ul className="forecast-category-list">
            {categories.map((entry) => {
              const share = isFiniteNumber(entry.sharePercentage) ? entry.sharePercentage : 0;
              return (
                <li className="forecast-category-row" key={entry.category}>
                  <div className="forecast-category-label">
                    <span className="forecast-category-name">{entry.category}</span>
                    {/* Text equivalent of the bar below -- the amount and share
                        are always readable without seeing the bar at all. */}
                    <span className="forecast-category-value">
                      {formatMoney(entry.predictedAmount)} · {Math.round(share)}%
                    </span>
                  </div>
                  <div className="forecast-bar-track" aria-hidden="true">
                    <div
                      className="forecast-bar-fill"
                      style={{ width: `${Math.min(100, Math.max(0, share))}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(forecast.nextQuarterForecast?.hasData === true ||
        forecast.nextYearForecast?.hasData === true) && (
        <>
          <h2 className="forecast-section-title">Looking further ahead</h2>
          {/* These two spans are the pre-existing multi-month horizons and
              are counted from the current month onwards -- stated plainly so
              neither is mistaken for the next-calendar-month figure above. */}
          <p className="forecast-estimate-note" style={{ marginTop: 0 }}>
            Counted from the current month onwards.
          </p>
          <div className="forecast-horizon-grid">
            <HorizonCard title="Next 3 months" horizon={forecast.nextQuarterForecast} />
            <HorizonCard title="Next 12 months" horizon={forecast.nextYearForecast} />
          </div>
        </>
      )}

      <p className="forecast-estimate-note">
        These are estimates based on your own spending history, not guarantees. Actual spending
        can differ, and unusual months are not predicted.
      </p>
    </ForecastShell>
  );
}
