import { useMemo } from "react";
import {
  FaLightbulb,
  FaBullseye,
  FaFireAlt,
  FaChartLine,
  FaExclamationTriangle,
  FaExclamationCircle,
} from "react-icons/fa";
import { formatMoneyApprox as formatMoney } from "../../utils/money";
import "./BudgetIntelligence.css";

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const DEFAULT_INSIGHT = {
  type: "OTHERS",
  title: "No Budget Insights Yet",
  message: "Set a budget to start getting personalized insights.",
  tip: "Add a monthly budget to unlock smart tips.",
};

function getInsightType(data) {
  const typeFromInsights = data?.budgetInsights?.type?.toUpperCase();
  if (
    typeFromInsights &&
    ["EXCEEDED", "CRITICAL", "HIGH_RISK", "AT_RISK", "WARNING", "SAFE", "OTHERS"].includes(
      typeFromInsights
    )
  ) {
    return typeFromInsights;
  }

  const statusFromData = data?.status?.toUpperCase();
  if (statusFromData === "OVERSPENT") return "EXCEEDED";
  if (statusFromData === "CRITICAL") return "CRITICAL";
  if (statusFromData === "WARNING") return "WARNING";
  if (statusFromData === "SAFE") return "SAFE";

  const projStatus = data?.projectionStatus?.toUpperCase();
  if (projStatus === "PROJECTEDOVERSPEND") return "HIGH_RISK";
  if (projStatus === "ATRISK") return "AT_RISK";

  const utilization = Number(data?.utilization);
  if (Number.isFinite(utilization)) {
    if (utilization > 100) return "EXCEEDED";
    if (utilization >= 90) return "CRITICAL";
    if (utilization >= 70) return "WARNING";
    return "SAFE";
  }

  return "OTHERS";
}

function renderStatusIcon(type) {
  switch (type) {
    case "EXCEEDED":
      return <FaFireAlt size={18} color="#dc2626" />;
    case "CRITICAL":
      return <FaExclamationCircle size={20} color="#dc2626" />;
    case "HIGH_RISK":
      return <FaExclamationTriangle size={18} color="#ea580c" />;
    case "AT_RISK":
      return <FaExclamationTriangle size={18} color="#f97316" />;
    case "WARNING":
      return <FaExclamationCircle size={20} color="#eab308" />;
    case "SAFE":
      return <FaBullseye size={18} color="#10b981" />;
    case "OTHERS":
    default:
      return <FaLightbulb size={18} color="#10b981" />;
  }
}

export default function BudgetIntelligence({ data, forecast, report }) {
  const insights = data?.budgetInsights ?? DEFAULT_INSIGHT;
  const insightType = getInsightType(data);

  const utilization = isFiniteNumber(data?.utilization) ? data.utilization : 0;
  const spent = isFiniteNumber(data?.spent) ? data.spent : 0;
  const budget = isFiniteNumber(data?.budget) ? data.budget : 0;

  const effectiveForecast = forecast || report?.forecast || data?.forecast;
  const currentMonthForecast = effectiveForecast?.currentMonthForecast;
  const hasForecastData =
    currentMonthForecast?.hasData === true && isFiniteNumber(currentMonthForecast?.estimate);

  const { displayEstimate, displayRemaining, footnoteText } = useMemo(() => {
    if (hasForecastData) {
      const estimate = currentMonthForecast.estimate;
      const remainingFromRisk = currentMonthForecast.budgetRisk?.predictedRemaining;
      const remaining = isFiniteNumber(remainingFromRisk)
        ? remainingFromRisk
        : (budget > 0 ? budget - estimate : null);

      const historyMonths = isFiniteNumber(currentMonthForecast.historyMonthsUsed)
        ? currentMonthForecast.historyMonthsUsed
        : null;

      const footnote = historyMonths !== null
        ? `Based on your recent spending pattern and ${historyMonths} ${historyMonths === 1 ? "month" : "months"} of history.`
        : "Based on your recent spending pattern and history.";

      return {
        displayEstimate: estimate,
        displayRemaining: remaining,
        footnoteText: footnote,
      };
    }

    if (budget > 0) {
      return {
        displayEstimate: spent,
        displayRemaining: Math.max(0, budget - spent),
        footnoteText: "Complete 3 months of tracking to unlock month-end forecast.",
      };
    }

    return {
      displayEstimate: null,
      displayRemaining: null,
      footnoteText: "Set a monthly budget to unlock month-end forecast.",
    };
  }, [hasForecastData, currentMonthForecast, budget, spent]);

  return (
    <div className="budget-intel-merged-container">
      {/* LEFT COLUMN: Budget Progress & Smart Tip */}
      <div className="budget-intel-left-col">
        {/* Status Header */}
        <div className="budget-intel-header">
          <div className="budget-intel-icon-tile" aria-hidden="true">
            {renderStatusIcon(insightType)}
          </div>
          <div className="budget-intel-title-wrap">
            <div className="budget-intel-title-row">
              <h2 className="budget-intel-title">
                {insights.title ?? DEFAULT_INSIGHT.title}
              </h2>
              <span className={`budget-intel-priority-badge ${insightType}`}>
                {insightType.replace("_", " ")}
              </span>
            </div>
            {insights.message && insights.message !== insights.title && (
              <p className="budget-intel-message">{insights.message}</p>
            )}
          </div>
        </div>

        {/* Budget Progress Bar */}
        {budget > 0 && (
          <div className="budget-progress-section">
            <div className="budget-progress-row">
              <span className="budget-progress-label">Budget Progress</span>
              <span className={`budget-progress-percent ${insightType}`}>
                {Math.round(utilization)}%
              </span>
            </div>

            <div className="budget-progress-bar-track" aria-hidden="true">
              <div
                className={`budget-progress-bar-fill ${insightType}`}
                style={{
                  width: `${Math.min(Math.max(utilization, 0), 100)}%`,
                }}
              />
            </div>

            <div className="budget-progress-labels">
              <span className="budget-label-spent">{formatMoney(spent)}</span>
              <span className="budget-label-budget">{formatMoney(budget)}</span>
            </div>
          </div>
        )}

        {/* Smart Tip Card */}
        <div className="budget-smart-tip-card">
          <div className="budget-smart-tip-icon-tile" aria-hidden="true">
            <FaLightbulb size={16} color="#db2777" />
          </div>
          <div className="budget-smart-tip-content">
            <h5 className="budget-smart-tip-heading">Smart Tip</h5>
            <p className="budget-smart-tip-text">
              {insights.tip ?? DEFAULT_INSIGHT.tip}
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Month-end Forecast */}
      <div className="budget-intel-right-col">
        <div className="budget-forecast-panel">
          <div className="budget-forecast-header">
            <div className="budget-forecast-icon-tile" aria-hidden="true">
              <FaChartLine size={15} color="#db2777" />
            </div>
            <h3 className="budget-forecast-heading">Month-end Forecast</h3>
          </div>

          <div className="budget-forecast-metric-card">
            <div className="forecast-stat-col">
              <span className="forecast-stat-amount spend">
                {displayEstimate !== null ? formatMoney(displayEstimate) : "—"}
              </span>
              <span className="forecast-stat-label">projected total spend</span>
            </div>

            <div className="forecast-stat-divider" aria-hidden="true" />

            <div className="forecast-stat-col">
              <span
                className={`forecast-stat-amount ${
                  displayRemaining !== null && displayRemaining < 0 ? "over" : "safe"
                }`}
              >
                {displayRemaining !== null ? formatMoney(Math.abs(displayRemaining)) : "—"}
              </span>
              <span className="forecast-stat-label">
                {displayRemaining !== null && displayRemaining < 0
                  ? "likely over budget"
                  : "likely remaining"}
              </span>
            </div>
          </div>

          <p className="budget-forecast-footnote">{footnoteText}</p>
        </div>
      </div>
    </div>
  );
}
