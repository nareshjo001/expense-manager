import { FaCreditCard, FaThLarge, FaPiggyBank  } from "react-icons/fa";
import { HiSparkles } from "react-icons/hi2";
import { useEffect, useState } from "react";
import "../Header.css";
import { useIsMobile } from "../../hooks/useIsMobile";
import IncomeModal from '../../IncomeHandling/IncomeModal';
import { expenseAddErrorToast } from "../../alertsEffects/toastMessages";

export default function Header({ period, setPeriod }) {
  // const [editBudget, setEditBudget] = useState(false);
  const [cardData, setCardData] = useState({
    totalIncome: 0,
    totalExpenses: 0,
    totalIncomes: 0,
    balance: 0,
    topSource: "N/A",
  });

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
    const fetchInsights = async () => {
      try {
        const token = localStorage.getItem("token");
        const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

        const res = await fetch(`${BASE_URL}/auth/income-insights-header`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ period }),
        });

        if (!res.ok) {
          throw new Error("Failed to fetch insights");
        }

        const data = await res.json();

        if (data.success) {
          setCardData(data.data);
        }
      } catch (error) {
        expenseAddErrorToast({ message: "Failed to load insights." });
        console.error(error);
      }
    };

    fetchInsights();
  }, [period]);

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
    <div className="monthly-insights">
      <div className="monthly-insights-header">
          <div className="monthly-insights-header-left">
              <h1 className="monthly-insights-header-title">
                  <HiSparkles className="icon-glow" />
                  Income Insights
              </h1>

              <p className="monthly-insights-header-description">
                  Intelligent financial overview •{" "} 
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
                  <p className="recorded-income-count">
                    {cardData.totalIncomes}
                    <span>Sources</span>
                  </p>

                  <button className="income-view-btn" onClick={() => setShowIncomeModal(true)}>
                    View ↗
                  </button>
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
      />
    </div>
  );
}