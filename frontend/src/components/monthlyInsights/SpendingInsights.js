import './SpendingInsights.css';
import { useMemo } from 'react';
import { FaChartPie, FaTrophy, FaTint } from "react-icons/fa";
import { FaArrowTrendUp } from "react-icons/fa6";

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
  let title = "How You Spend";
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
      <div className='spending-insights-container-heading'>
        <div className="heading-icon">
          <FaChartPie size={18} color="#FFFFFF" />
        </div>
        <h1 className='spending-insights-h-text' style={{fontWeight: "600"}}>Spending Insights</h1>
      </div>

      <div className="spending-insights-grid">
        {/* LEFT CARD */}
        <div className='spending-insights-left'>
          <div className='spending-insights-card-head'>
            <div className="heading-icon">
              <FaTrophy size={18} color="#FFFFFF" />
            </div>
            <div className='spending-insights-left-heading'>
              <h1 className='spending-insights-h-text' style={{color: "#111827"}}>Top Category</h1>
              <p className='spending-insights-p-text' style={{color: "var(--muted-text)"}}>Your highest spending</p>
            </div>
          </div>

          {leftPanelData 
            ? (
              <>
                <div className="spending-insights-left-body">
                  <p className='spending-insights-p-text' style={{color: "#374151", fontWeight: "500", marginBottom: "12px"}}>
                    {leftPanelData.topCategory} is your top category at{" "}
                    <strong style={{ color: "var(--menu-color)" }}>
                      ₹{leftPanelData.amount.toLocaleString()}
                    </strong>
                  </p>
                  <p className='spending-insights-p-text'>
                    {leftPanelData.showTopCategoryInsight
                      ? "Reducing spending in this category could have the biggest impact."
                      : `(${Math.round(leftPanelData.percentage)}% of your spending)`}
                  </p>
                </div>

                <div className="spending-insights-left-progress">
                  <div className='spending-insights-left-bar'>
                      <div className="progress-track" style={{height: "13px"}}>
                        <div
                            className="spending-progress-fill"
                            style={{ width: `${Math.min(100, Math.round(leftPanelData.percentage))}%` }}
                        />
                      </div>
                      <p className='spending-insights-p-text' style={{color: "#000"}}>
                        <strong>{`${Math.round(leftPanelData.percentage)}%`}</strong>
                      </p>
                  </div>
                </div>
              </>
            ) : (
              <div className='insights-empty-card'>
                <p className='insights-empty-text'>No spending insights yet</p>
                <p className='insights-empty-text'>Start tracking expenses to discover your top category</p>
              </div>
            )}
        </div>

        {/* MIDDLE CARD */}
        <div className='spending-insights-middle'>
          <div className='spending-insights-card-head'>
            <div className="heading-icon" style={{background: ""}}>
              <FaTint  size={18} color="#FFFFFF" />
            </div>
            <div className='spending-insights-middle-heading'>
              <h1 className='spending-insights-h-text' style={{color: "#111827"}}>Leaky Bucket</h1>
              <p className='spending-insights-p-text'>Micro-spending Pattern</p>
            </div>
          </div>

          {middlePanelData
            ? (
              <div className="spending-insights-middle-body">
                <h1 className='spending-insights-h-text' style={{color: "var(--menu-color)", fontWeight: "700", fontSize: "28px" ,textAlign: "center", marginTop: "20px"}}>
                  ₹{middlePanelData.leakTotal.toLocaleString()}
                </h1>
                <p className='spending-insights-p-text' style={{textAlign: "center"}}><strong>{middlePanelData.count}</strong> small purchases (At an avg <strong>₹{middlePanelData.averageLeak}</strong>)</p>
                <p className='spending-insights-p-text' style={{marginTop: "20px", fontWeight: "500"}}>{middlePanelData.subMessage}</p>
              </div>
            ) : (
              <div className='insights-empty-card'>
                <p className='insights-empty-text'>No micro-spending detected</p>
                <p className='insights-empty-text'>Great job keeping small expenses under control</p>
              </div>
            )} 
        </div>

        {/* RIGHT CARD */}
        <div className='spending-insights-right'>
          <div className='spending-insights-card-head'>
            <div className="heading-icon">
              <FaArrowTrendUp size={18} color="#FFFFFF" />
            </div>
            <div className='spending-insights-right-heading'>
              <h1 className='spending-insights-h-text' style={{color: "#111827"}}>
                {rightPanelData ? rightPanelData.insight.title : `How You Spend`}
              </h1>
              <p className='spending-insights-p-text'>Behavioral Pattern</p>
            </div>
          </div>

          {rightPanelData 
            ? (
              <>
                <p className='spending-insights-p-text' style={{color: "#374151", fontWeight: "500"}}>
                  {rightPanelData.insight.message}
                </p>
                <div className='spending-insights-right-stats'>
                  <div className='spending-insights-right-stats-weekday'>
                    <p className='spending-insights-p-text'>Weekday Avg</p>
                    <h1 className='spending-insights-h-text' style={{color: "var(--menu-color)"}}>
                      ₹{rightPanelData.weekdayAvg.toLocaleString()}
                    </h1>
                  </div>
                  <div className='spending-insights-right-stats-weekend'>
                    <p className='spending-insights-p-text'>Weekend Avg</p>
                    <h1 className='spending-insights-h-text' style={{color: "var(--menu-color)"}}>
                      ₹{rightPanelData.weekendAvg.toLocaleString()}
                    </h1>
                  </div>
                </div>
              </>
            ) : (
              <div className='insights-empty-card'>
                <p className='insights-empty-text'>Not enough data to analyze patterns</p>
                <p className='insights-empty-text'>Keep tracking to unlock insights</p>
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}