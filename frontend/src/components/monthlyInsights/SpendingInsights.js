import './SpendingInsights.css';
// DAT-001-T06 -- money renders through the shared formatter.
import { formatMoney } from "../../utils/money";
import { useMemo } from 'react';
import { FaChartPie, FaTrophy, FaTint, FaWallet, FaChartBar } from "react-icons/fa";
import OverallInsight from "./OverallInsight";

// Derives the top-category, micro-spending, and weekend-vs-weekday panels from the report data.
function buildLeftPanel(categoriesMonthly, totalSpent) {
  const topCategory = categoriesMonthly?.topCategory;
  if (!categoriesMonthly?.hasData || !topCategory?.category || !Number.isFinite(topCategory?.total)) {
    return null;
  }
  const percentage = totalSpent > 0 ? (topCategory.total / totalSpent) * 100 : 0;
  return {
    topCategory: topCategory.category,
    amount: topCategory.total,
    percentage,
    showTopCategoryInsight: percentage >= 40,
  };
}

function buildMiddlePanel(habitsMonthly) {
  const micro = habitsMonthly?.microSpending;
  if (!micro?.hasData || !micro?.qualifies) return null;
  const subMessage = micro.transactionCount >= 5
    ? "These small purchases are adding up — consider tracking them."
    : "A few small purchases here and there, nothing alarming yet.";
  return {
    leakTotal: micro.totalSpent ?? 0,
    count: micro.transactionCount,
    averageLeak: Math.round(micro.averageAmount ?? 0),
    subMessage,
  };
}

function buildRightPanel(habitsMonthly) {
  const wvw = habitsMonthly?.weekendVsWeekday;
  if (!wvw || (!wvw.weekendSpent && !wvw.weekdaySpent)) return null;
  let title = "Weekday Spender";
  let message = "Your spending pattern is consistent throughout the week.";
  if (wvw.preferredPeriod === "Weekday") {
    title = "Weekday Spender";
    message = "You tend to spend more on weekdays than weekends.";
  } else if (wvw.preferredPeriod === "Weekend") {
    title = "Weekend Spender";
    message = "You tend to spend more on weekends than weekdays.";
  }
  return {
    insight: { title, message },
    weekdayAvg: Math.round(wvw.weekdayAverage ?? 0),
    weekendAvg: Math.round(wvw.weekendAverage ?? 0),
  };
}

export default function SpendingInsights({ report }) {
  const categoriesMonthly = report?.categories?.monthly;
  const habitsMonthly = report?.habits?.monthly;
  const totalSpent = report?.spending?.totalSpent ?? report?.summary?.totalSpent ?? 0;

  const leftPanelData = useMemo(() => buildLeftPanel(categoriesMonthly, totalSpent), [categoriesMonthly, totalSpent]);
  const middlePanelData = useMemo(() => buildMiddlePanel(habitsMonthly), [habitsMonthly]);
  const rightPanelData = useMemo(() => buildRightPanel(habitsMonthly), [habitsMonthly]);

  return (
    <div className="spending-insights-container">
      <div className="spending-insights-container-heading">
        <div className="spending-insights-brand-tile" aria-hidden="true">
          <FaChartPie size={20} color="#FFFFFF" />
        </div>
        <h2 className="spending-insights-title">Spending Insights</h2>
      </div>

      <div className="spending-insights-grid">
        {/* Card 1: Top Category */}
        <div className="spending-insights-card top-category-card">
          <div className="spending-insights-card-head">
            <div className="spending-card-icon-badge badge-trophy" aria-hidden="true">
              <FaTrophy size={16} />
            </div>
            <div className="spending-card-head-text">
              <h3 className="spending-card-title">Top Category</h3>
              <p className="spending-card-subtitle">Your highest spending</p>
            </div>
          </div>

          {leftPanelData ? (
            <div className="spending-card-body">
              <p className="spending-card-main-text">
                {leftPanelData.topCategory} is your top category at{" "}
                <strong className="top-category-amount">{formatMoney(leftPanelData.amount)}</strong>
              </p>
              <p className="spending-card-desc">
                {leftPanelData.showTopCategoryInsight
                  ? "Reducing spending in this category could have the biggest impact."
                  : `(${Math.round(leftPanelData.percentage)}% of your spending)`}
              </p>
              <div className="top-category-progress-row">
                <div className="top-category-progress-track">
                  <div
                    className="top-category-progress-fill"
                    style={{ width: `${Math.min(100, Math.round(leftPanelData.percentage))}%` }}
                  />
                </div>
                <span className="top-category-progress-percent">
                  {Math.round(leftPanelData.percentage)}%
                </span>
              </div>
            </div>
          ) : (
            <div className="insights-empty-card">
              <p className="insights-empty-title">No spending insights yet</p>
              <p className="insights-empty-text">Start tracking expenses to discover your top category</p>
            </div>
          )}
        </div>

        {/* Card 2: Leaky Bucket */}
        <div className="spending-insights-card leaky-bucket-card">
          <div className="spending-insights-card-head">
            <div className="spending-card-icon-badge badge-droplet" aria-hidden="true">
              <FaTint size={16} />
            </div>
            <div className="spending-card-head-text">
              <h3 className="spending-card-title">Leaky Bucket</h3>
              <p className="spending-card-subtitle">Micro-spending Pattern</p>
            </div>
          </div>

          {middlePanelData ? (
            <div className="leaky-bucket-active-body">
              <h3 className="leaky-bucket-amount">{formatMoney(middlePanelData.leakTotal)}</h3>
              <p className="leaky-bucket-sub">
                <strong>{middlePanelData.count}</strong> small purchases (At an avg{" "}
                <strong>{formatMoney(middlePanelData.averageLeak)}</strong>)
              </p>
              <p className="leaky-bucket-msg">{middlePanelData.subMessage}</p>
            </div>
          ) : (
            <div className="leaky-bucket-empty-body">
              <div className="leaky-bucket-wallet-tile" aria-hidden="true">
                <FaWallet size={18} color="#db2777" />
                <svg className="wallet-sparkles" width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 0L9.5 5.5L15 7L9.5 8.5L8 14L6.5 8.5L1 7L6.5 5.5L8 0Z" fill="#f43f5e" opacity="0.8" />
                  <circle cx="13" cy="3" r="1.5" fill="#f43f5e" />
                </svg>
              </div>
              <p className="leaky-bucket-empty-title">No micro-spending detected</p>
              <p className="leaky-bucket-empty-desc">Great job keeping small expenses under control.</p>
            </div>
          )}
        </div>

        {/* Card 3: Weekday Spender */}
        <div className="spending-insights-card weekday-spender-card">
          <div className="spending-insights-card-head">
            <div className="spending-card-icon-badge badge-chart" aria-hidden="true">
              <FaChartBar size={16} />
            </div>
            <div className="spending-card-head-text">
              <h3 className="spending-card-title">
                {rightPanelData ? rightPanelData.insight.title : "Weekday Spender"}
              </h3>
              <p className="spending-card-subtitle">Behavioral Pattern</p>
            </div>
          </div>

          {rightPanelData ? (
            <div className="spending-card-body">
              <p className="spending-card-desc">{rightPanelData.insight.message}</p>
              <div className="weekday-stats-row">
                <div className="weekday-stat-box weekday-box">
                  <span className="weekday-stat-label">Weekday Avg</span>
                  <span className="weekday-stat-value">{formatMoney(rightPanelData.weekdayAvg)}</span>
                </div>
                <div className="weekday-stat-box weekend-box">
                  <span className="weekday-stat-label">Weekend Avg</span>
                  <span className="weekday-stat-value">{formatMoney(rightPanelData.weekendAvg)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="insights-empty-card">
              <p className="insights-empty-title">Not enough data to analyze patterns</p>
              <p className="insights-empty-text">Keep tracking to unlock insights</p>
            </div>
          )}
        </div>

        {/* Cards 4, 5, 6: Unified continuous grid items */}
        <OverallInsight report={report} />
      </div>
    </div>
  );
}