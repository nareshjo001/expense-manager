import { FaCreditCard, FaThLarge, FaPiggyBank  } from "react-icons/fa";
import { HiSparkles } from "react-icons/hi2";
import { useEffect, useState } from "react";
import "../Header.css";
import { useIsMobile } from "../../hooks/useIsMobile";
import IncomeModal from '../../IncomeHandling/IncomeModal';
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

  const isMobile = useIsMobile();
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
  
  let styles = {};
  if (isMobile) {
    styles.gridTemplateColumns = "repeat(2,1fr)";
  } else {
    styles.gridTemplateColumns = "repeat(3,1fr)";
  }

  return (
    <div className="monthly-insights income-insights-header">
      <div className="monthly-insights-header">
          <div className="monthly-insights-header-left">
              <h1 className="monthly-insights-header-title">
                  <HiSparkles className="icon-glow" />
                  Income Insights
              </h1>

              <p className="monthly-insights-header-description income-insights-header-description">
                  <span className="income-insights-overview">Intelligent financial overview</span>
                  <span aria-hidden="true">•</span>
                  <span className="period-selector">
                    <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                      <option value="financial_year">
                        FY {new Date().getFullYear()} - {String((new Date().getFullYear() + 1) % 100).padStart(2, '0')}
                      </option>
                      <option value="current_month">{currentMonthYear}</option>
                    </select>
                  </span>
              </p>
          </div>

          <div className="monthly-insights-header-budget">
              <p>Total Income</p>
              <h1>₹ {cardData.totalIncome}</h1>
              <span>Spent: ₹ {cardData.totalExpenses}</span>
          </div>
      </div>

      <div className={`monthly-insights-body-cards ${animate ? "show" : ""}`} style={styles}>
          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-chart-line">
                    <FaPiggyBank />
                  </i>
                  Net Balance
              </div>
              <p className="daily-average">
                {cardData.balance === 0 ? (
                  <span style={{ fontSize: "16px" }}>
                    No balance available
                  </span>
                ) : cardData.balance < 0 ? (
                  <>
                    <span style={{ color: "red" }}>
                      -₹ {Math.abs(Math.round(cardData.balance))}
                    </span>
                    <small style={{ color: "inherit", fontSize: "15px", display: "block" }}>
                      Expenses exceed income
                    </small>
                  </>
                ) : (
                  <>
                    <span>₹ {Math.round(cardData.balance)}</span>
                  </>
                )}
              </p>
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-wave-square">
                    <FaCreditCard />
                  </i>
                  Recorded Incomes
              </div>
              {cardData.totalIncomes === 0 ? (
                <>
                  <p className="insufficient-data">
                    <span style={{ fontSize: "16px" }}>
                      No income records
                    </span>
                  </p>
                </>
              ) : (
                <div className="recorded-income-row">
                  {isMobile ? (
                    <>
                      <div className="recorded-income-actions">
                        <p className="recorded-income-count">{cardData.totalIncomes}</p>
                        <button className="income-view-btn" onClick={() => setShowIncomeModal(true)}>
                          View ↗
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="recorded-income-count">
                        {cardData.totalIncomes}
                        <span>Sources</span>
                      </p>
                      <button className="income-view-btn" onClick={() => setShowIncomeModal(true)}>
                        View ↗
                      </button>
                    </>
                  )}
                </div>
              )}
          </div>

          <div className="monthly-insights-card" style={isMobile ? { gridColumn: "1 / -1" } : {}}>
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-bag-shopping">
                    <FaThLarge />
                  </i>
                  Top Source
              </div>
              {!cardData.topSource || cardData.topSource === 'N/A' ? (
                <p className="insufficient-data">
                  <span style={{ fontSize: "16px" }}>
                    No income sources
                  </span>
                </p>
              ) : (
                <p style={{fontSize: "24px"}}>{cardData.topSource}</p>
              )}
          </div>
      </div>

      <IncomeModal
        isOpen={showIncomeModal}
        onClose={() => setShowIncomeModal(false)}
        period={period}
      />
    </div>
  );
}
