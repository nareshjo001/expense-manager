import { FaCreditCard, FaThLarge, FaPiggyBank } from "react-icons/fa";
// DAT-001-T06 -- money renders through the shared formatter.
import { formatMoney } from "../../../utils/money";
import { HiChevronDown, HiSparkles } from "react-icons/hi2";
import { useEffect, useState } from "react";
import "../Header.css";
import "../../common/QueryState.css";
import IncomeModal from "../../IncomeHandling/IncomeModal";
import { expenseAddErrorToast } from "../../alertsEffects/toastMessages";
import { useIncomeSummaryQuery } from "../../../hooks/queries/useIncomeSummaryQuery";

// Falls back to zeroed-out totals until the summary query resolves.
const DEFAULT_CARD_DATA = {
  totalIncome: 0,
  totalExpenses: 0,
  totalIncomes: 0,
  balance: 0,
  topSource: "N/A",
};

// Income insights header: summary cards plus a link into IncomeModal for viewing recorded incomes.
export default function Header({ period, setPeriod }) {
  const summaryQuery = useIncomeSummaryQuery(period);
  const cardData = summaryQuery.data?.data ?? DEFAULT_CARD_DATA;

  const [animate, setAnimate] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);

  useEffect(() => {
    if (cardData) {
      const t = setTimeout(() => setAnimate(true), 50); // small delay = smoother paint
      return () => clearTimeout(t);
    }
  }, [cardData]);

  useEffect(() => {
    if (!summaryQuery.isError) return;
    // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
    const status = summaryQuery.error?.response?.status;
    if (status !== 401 && status !== 429 && status !== 409) {
      expenseAddErrorToast({ message: "Failed to load insights." });
    }
  }, [summaryQuery.isError, summaryQuery.error]);

  const currentMonthYear = new Date().toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="monthly-insights income-insights-header">
      <div className="monthly-insights-header">
        <div className="monthly-insights-header-left">
          <div className="income-header-brand-tile" aria-hidden="true">
            <HiSparkles />
          </div>

          <div className="income-header-title-wrap">
            <h1 className="monthly-insights-header-title">
              Income Insights
            </h1>

            <div className="income-header-subtitle-row">
              <span className="income-insights-overview">Intelligent financial overview</span>
              <div className="period-selector-pill">
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  aria-label="Select financial period"
                >
                  <option value="financial_year">
                    FY {new Date().getFullYear()} - {String((new Date().getFullYear() + 1) % 100).padStart(2, '0')}
                  </option>
                  <option value="current_month">{currentMonthYear}</option>
                </select>
                <HiChevronDown className="period-selector-chevron" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>

        <div className="monthly-insights-header-budget income-total-card">
          {summaryQuery.isLoading ? (
            <p role="status" aria-live="polite">Loading&hellip;</p>
          ) : summaryQuery.isError ? (
            <p role="alert" aria-live="assertive">Unable to load</p>
          ) : (
            <>
              <p className="income-total-card-label">Total Income</p>
              <h1 className="income-total-card-amount">{formatMoney(cardData.totalIncome)}</h1>
              <div className="income-total-card-footer">
                <span className="income-total-card-spent">Spent: {formatMoney(cardData.totalExpenses)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={`monthly-insights-body-cards income-insights-cards-grid ${animate ? "show" : ""}`}>
        {summaryQuery.isLoading ? (
          <div
            className="query-state query-state-loading"
            role="status"
            aria-live="polite"
            style={{ gridColumn: "1 / -1" }}
          >
            <span className="query-state-spinner" aria-hidden="true" />
            <p className="query-state-message">Loading income insights...</p>
          </div>
        ) : summaryQuery.isError ? (
          <div
            className="query-state query-state-error"
            role="alert"
            aria-live="assertive"
            style={{ gridColumn: "1 / -1" }}
          >
            <p className="query-state-message">We couldn't load your income insights.</p>
            <button
              type="button"
              className="query-state-retry"
              onClick={() => summaryQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="monthly-insights-card income-insight-card income-net-balance-card">
              <div className="income-card-info">
                <div className="monthly-insights-card-header income-card-header">
                  <div className="income-card-header-left">
                    <div className="income-card-icon-badge" aria-hidden="true">
                      <FaPiggyBank />
                    </div>
                    <span>Net Balance</span>
                  </div>
                </div>
                <div className="income-insight-card-content">
                  <div className="income-insight-val-block">
                    <p className="daily-average">
                      {cardData.balance === 0 ? (
                        <span style={{ fontSize: "16px" }}>
                          No balance available
                        </span>
                      ) : cardData.balance < 0 ? (
                        <>
                          <span style={{ color: "#dc2626" }}>
                            -{formatMoney(Math.abs(Math.round(cardData.balance)))}
                          </span>
                          <small style={{ color: "inherit", fontSize: "12px", display: "block" }}>
                            Expenses exceed income
                          </small>
                        </>
                      ) : (
                        <span className="income-insight-main-num">{formatMoney(cardData.balance)}</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="income-card-header-graphic" aria-hidden="true">
                <svg className="insight-decor-wave" width="76" height="30" viewBox="0 0 76 30" fill="none">
                  <defs>
                    <linearGradient id="incomeWaveGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path
                    d="M 2 24 C 6 24, 11 15, 15 15 C 19 15, 22 21, 26 21 C 30 21, 34 11, 38 11 C 42 11, 44 15, 48 15 C 52 15, 54 8, 58 8 C 61 8, 63 10, 65 10 C 67 10, 69 6, 71 4 L 71 29 L 2 29 Z"
                    fill="url(#incomeWaveGrad)"
                  />
                  <path
                    d="M 2 24 C 6 24, 11 15, 15 15 C 19 15, 22 21, 26 21 C 30 21, 34 11, 38 11 C 42 11, 44 15, 48 15 C 52 15, 54 8, 58 8 C 61 8, 63 10, 65 10 C 67 10, 69 6, 71 4"
                    stroke="#ec4899"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="71" cy="4" r="2.8" fill="#ec4899" />
                </svg>
              </div>
            </div>

            <div className="monthly-insights-card income-insight-card">
              <div className="monthly-insights-card-header income-card-header">
                <div className="income-card-header-left">
                  <div className="income-card-icon-badge" aria-hidden="true">
                    <FaCreditCard />
                  </div>
                  <span>Recorded Incomes</span>
                </div>
              </div>
              <div className="income-insight-card-content">
                {cardData.totalIncomes === 0 ? (
                  <p className="insufficient-data">
                    <span style={{ fontSize: "16px" }}>
                      No income records
                    </span>
                  </p>
                ) : (
                  <div className="recorded-income-row">
                    <p className="recorded-income-count">
                      {cardData.totalIncomes}{" "}
                      <span className="recorded-income-unit">
                        {cardData.totalIncomes === 1 ? "Source" : "Sources"}
                      </span>
                    </p>
                    <button
                      type="button"
                      className="income-view-btn"
                      onClick={() => setShowIncomeModal(true)}
                    >
                      View &rarr;
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="monthly-insights-card income-insight-card">
              <div className="monthly-insights-card-header income-card-header">
                <div className="income-card-header-left">
                  <div className="income-card-icon-badge" aria-hidden="true">
                    <FaThLarge />
                  </div>
                  <span>Top Source</span>
                </div>
              </div>
              <div className="income-insight-card-content">
                <div className="income-insight-val-block">
                  {!cardData.topSource || cardData.topSource === 'N/A' ? (
                    <p className="insufficient-data">
                      <span style={{ fontSize: "16px" }}>
                        No income sources
                      </span>
                    </p>
                  ) : (
                    <p className="income-insight-main-num" title={cardData.topSource}>
                      {cardData.topSource}
                    </p>
                  )}
                </div>
                <div className="income-insight-graphic" aria-hidden="true">
                  <svg className="insight-decor-bars" width="30" height="24" viewBox="0 0 30 24" fill="none">
                    <rect x="2" y="16" width="3.5" height="8" rx="1.75" fill="#ec4899" opacity="0.3" />
                    <rect x="8.5" y="12" width="3.5" height="12" rx="1.75" fill="#ec4899" opacity="0.45" />
                    <rect x="15" y="7" width="3.5" height="17" rx="1.75" fill="#ec4899" opacity="0.65" />
                    <rect x="21.5" y="2" width="3.5" height="22" rx="1.75" fill="#ec4899" opacity="0.85" />
                  </svg>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <IncomeModal
        isOpen={showIncomeModal}
        onClose={() => setShowIncomeModal(false)}
        period={period}
      />
    </div>
  );
}
