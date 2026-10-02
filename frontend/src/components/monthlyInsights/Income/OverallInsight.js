import { useEffect } from 'react';
// DAT-001-T06 -- money renders through the shared formatter.
import { formatMoney } from "../../../utils/money";
import './OverallInsight.css';
import { FaFire, FaChartPie, FaPiggyBank } from "react-icons/fa";
import { useInView } from 'react-intersection-observer';
import { useIncomeInsightsQuery } from '../../../hooks/queries/useIncomeInsightsQuery';
import QueryState from '../../common/QueryState';

// Savings rate, runway forecast, and income-dependency cards for the income insights page.
export default function OverallInsight({ period }) {
  const insightsQuery = useIncomeInsightsQuery(period);
  const insight = insightsQuery.data?.success ? (insightsQuery.data.data ?? null) : null;

  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.5
  });

  useEffect(() => {
    if (insightsQuery.isError) {
      console.error("Error fetching insights:", insightsQuery.error);
    }
  }, [insightsQuery.isError, insightsQuery.error]);

  return (
    <QueryState
      isLoading={insightsQuery.isLoading}
      isError={insightsQuery.isError}
      isEmpty={false}
      onRetry={insightsQuery.refetch}
      loadingLabel="Loading income insights..."
      errorLabel="We couldn't load your income insights."
    >
      <div className="income-insights-section">
        <div className="income-insights-cards-row overall-insights-container">
          {/* Card 1 — Savings Rate (Matches 2nd reference image layout) */}
          <div className="income-insight-panel-card savings-rate-card overall-insights-card">
            <div className="income-card-head overall-insights-card-head savings-rate-head">
              <div className="savings-rate-head-top">
                <div className="income-card-icon-badge heading-icon" aria-hidden="true">
                  <FaPiggyBank size={16} />
                </div>
                <h3 className="income-card-title overall-insights-h-text">Savings Rate</h3>
              </div>
              <p className="income-card-subtitle overall-insights-p-text savings-rate-status-label">
                {insight?.savingsRateData?.status || "Your income savings"}
              </p>
            </div>

            {insight?.savingsRateData ? (
              <div className="income-card-body overall-insights-card-body">
                <div className="savings-rate-metric-box">
                  <div className="savings-rate-metric-value">
                    {insight.savingsRateData.savingsRate}%
                  </div>
                  <div className="savings-rate-metric-sub">
                    <span className="savings-rate-metric-label">Saved</span>{" "}
                    <span className="savings-rate-metric-amount">
                      {formatMoney(insight.savingsRateData.netBalance)}
                    </span>
                  </div>
                </div>

                <p className="income-card-desc overall-insights-p-text">
                  {insight.savingsRateData.subMessage || "Your savings from total recorded income"}
                </p>
              </div>
            ) : (
              <div className="insights-empty-card overall-insights-empty-card">
                <p className="insights-empty-title">No income data available</p>
                <p className="insights-empty-text">Add income records to calculate savings rate</p>
              </div>
            )}
          </div>

          {/* Card 2 — Runway Forecast (Matches Leaky Bucket centered style) */}
          <div className="income-insight-panel-card runway-forecast-card overall-insights-card">
            <div className="income-card-head overall-insights-card-head">
              <div className="income-card-icon-badge heading-icon" aria-hidden="true">
                <FaFire size={16} />
              </div>
              <div className="income-card-head-text">
                <h3 className="income-card-title overall-insights-h-text">Runway Forecast</h3>
                <p className="income-card-subtitle overall-insights-p-text">Income sustainability</p>
              </div>
            </div>

            {insight?.runwayData ? (
              <div className="runway-hero-body overall-insights-card-body">
                <div className="runway-value-wrap">
                  <div className="runway-number-container">
                    <h3
                      ref={ref}
                      className={`runway-hero-number streak-number overall-insights-h-text ${!inView ? 'hidden' : ''} ${inView ? 'animate' : ''}`}
                    >
                      {insight.runwayData.runwayDays}
                    </h3>
                    <svg className="runway-sparkles" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M8 0L9.5 5.5L15 7L9.5 8.5L8 14L6.5 8.5L1 7L6.5 5.5L8 0Z" fill="#f43f5e" opacity="0.85" />
                      <circle cx="13" cy="3" r="1.5" fill="#f43f5e" />
                    </svg>
                  </div>
                  <span className="runway-hero-unit overall-insights-p-text">
                    {insight.runwayData.runwayDays === 1 ? 'day remaining' : 'days remaining'}
                  </span>
                </div>
                <p className="runway-hero-desc overall-insights-p-text">
                  {insight.runwayData.subMessage || 'Estimated financial runway based on income and spend.'}
                </p>
              </div>
            ) : (
              <div className="insights-empty-card overall-insights-empty-card">
                <p className="insights-empty-title">No runway data available</p>
                <p className="insights-empty-text">Add income and expenses to calculate your financial runway</p>
              </div>
            )}
          </div>

          {/* Card 3 — Income Dependency (Donut Chart layout matching reference) */}
          <div className="income-insight-panel-card income-dependency-card overall-insights-card">
            <div className="income-card-head overall-insights-card-head">
              <div className="income-card-icon-badge heading-icon" aria-hidden="true">
                <FaChartPie size={16} />
              </div>
              <div className="income-card-head-text">
                <h3 className="income-card-title overall-insights-h-text">Income Dependency</h3>
                <p className="income-card-subtitle overall-insights-p-text">Source concentration</p>
              </div>
            </div>

            {insight?.incomeDependencyData ? (() => {
              const dependencyPercent = Number(insight.incomeDependencyData.dependencyPercent) || 0;
              const clampedDependency = Math.max(0, Math.min(100, dependencyPercent));
              const donutRadius = 30;
              const donutCircumference = 2 * Math.PI * donutRadius;
              const donutDashLength = (clampedDependency / 100) * donutCircumference;

              return (
                <div className="income-card-body overall-insights-card-body income-dependency-body">
                  <div className="income-dependency-donut-wrap">
                    <svg
                      className="income-dependency-donut-svg"
                      viewBox="0 0 68 68"
                      width="68"
                      height="68"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient
                          id="incomeDependencyGradient"
                          x1="0%"
                          y1="0%"
                          x2="0%"
                          y2="100%"
                          gradientTransform="rotate(90 0.5 0.5)"
                        >
                          <stop offset="0%" stopColor="#f472b6" />
                          <stop offset="50%" stopColor="#ec4899" />
                          <stop offset="100%" stopColor="#db2777" />
                        </linearGradient>
                      </defs>
                      <circle
                        className="income-dependency-donut-track"
                        cx="34"
                        cy="34"
                        r={donutRadius}
                        fill="none"
                        strokeWidth="8"
                      />
                      <circle
                        className="income-dependency-donut-progress"
                        cx="34"
                        cy="34"
                        r={donutRadius}
                        fill="none"
                        stroke="url(#incomeDependencyGradient)"
                        strokeWidth="8"
                        strokeLinecap={donutDashLength > 0 ? "round" : "butt"}
                        strokeDasharray={`${donutDashLength} ${donutCircumference}`}
                        strokeDashoffset="0"
                        transform="rotate(-90 34 34)"
                      />
                    </svg>
                    <span className="income-dependency-donut-value">
                      {insight.incomeDependencyData.dependencyPercent}%
                    </span>
                  </div>

                  <h4 className="income-dependency-risk-title">
                    {insight.incomeDependencyData.riskLevel}
                  </h4>

                  <p className="income-dependency-desc overall-insights-p-text">
                    {insight.incomeDependencyData.subMessage || 'Evaluation of income diversification across sources.'}
                  </p>
                </div>
              );
            })() : (
              <div className="insights-empty-card overall-insights-empty-card">
                <p className="insights-empty-title">No income data available</p>
                <p className="insights-empty-text">Add income records to analyze dependency</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </QueryState>
  );
}