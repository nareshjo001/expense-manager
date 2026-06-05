import { FaCalendarAlt, FaCreditCard, FaThLarge, FaArrowUp, FaArrowDown, } from "react-icons/fa";
import { FaArrowTrendUp, FaPen  } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { BudgetContext } from "../contexts/BudgetContext";
import { useContext, useEffect, useState } from "react";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { FetchingLoader } from "../alertsEffects/FetchingLoader";
import "./Header.css";

export default function Header() {
  const { totalBudget, spent, fetchBudgets } = useContext(BudgetContext);
  const [editBudget, setEditBudget] = useState(false);
  const [newBudget, setNewBudget] = useState(totalBudget || "");
  const [cardData, setCardData] = useState({
    totalSpent: 0,
    dailyAverage: 0,
    transactionsCount: 0,
    topCategory: "N/A",
  });

  const [isFetching, setIsFetching] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (cardData) {
      const t = setTimeout(() => setAnimate(true), 50); // small delay = smoother paint
      return () => clearTimeout(t);
    }
  }, [cardData]);

  const fetchInsights = async () => {
    try {
      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const res = await fetch(`${BASE_URL}/auth/cardinsights`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error("Server error");
      }

      const data = await res.json();

      if (data.success) {
        setCardData(data.data);
      }

    } catch (error) {
      console.error("Error fetching insights:", error);
      expenseAddErrorToast({ message: "Failed to fetch insights." });
      setCardData({
        totalSpent: 0,
        dailyAverage: 0,
        transactionsCount: 0,
        topCategory: "N/A",
      });
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  const currentMonthYear = new Date().toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  const comparePastMonth = cardData.pastMonthTotal ? (cardData.totalSpent - cardData.pastMonthTotal) : null;
  const isIncreasing = comparePastMonth !== null ? comparePastMonth > 0 : null;
  const percentageChange = comparePastMonth !== null && cardData.pastMonthTotal > 0
    ? Math.round((Math.abs(comparePastMonth) / cardData.pastMonthTotal) * 100)
    : null;

  const handleBudgetSubmit = async (e) => {
    e.preventDefault();
    try {
      setIsFetching(true);
      const token = localStorage.getItem("token");
      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");

      const res = await fetch(`${BASE_URL}/auth/update-budget`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          budget: newBudget,
        }),
      });

      if (!res.ok) {
        throw new Error("Server error");
      }

      const data = await res.json();
      if (data.success) {
        setIsFetching(false);
        await fetchBudgets();
        fetchInsights();

        setNewBudget("");
        setEditBudget(false);
      }

    } catch (error) {
      expenseAddErrorToast({ message: "Failed to update budget." });
      setIsFetching(false);
      console.error("Error updating budget:", error);
    }
  };

  return (
    <div className="monthly-insights">

      <div className="monthly-insights-header">

          <div className="monthly-insights-header-left">
              <h1 className="monthly-insights-header-title">
                  <HiSparkles className="icon-glow" />
                  Budget Insights
              </h1>

              <p className="monthly-insights-header-description">
                  Intelligent financial overview • {currentMonthYear}
              </p>
          </div>

          <div className="monthly-insights-header-budget">
              <div className="edit-budget-icon" title="Edit Budget" onClick={() => setEditBudget(true)}>
                <button >
                  <FaPen />
                </button>
              </div>
              <p>Total Budget</p>
              <h1>₹ {totalBudget}</h1>
              <span>Spent: ₹ {spent}</span>
          </div>

      </div>

      <div className={`monthly-insights-body-cards ${animate ? "show" : ""}`}>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-wallet">
                    <FaArrowTrendUp />
                  </i>
                  Spending Trend
              </div>
              <p>
                {isIncreasing === null ? (
                  <span style={{fontSize: "16px"}}>Insufficient data</span>
                ) : isIncreasing ? (
                  <span className="positive">
                    <FaArrowUp /> {percentageChange}% higher than last month
                  </span>
                ) : (
                  <span className="negative">
                    <FaArrowDown /> {percentageChange}% lower than last month
                  </span>
                )}
              </p>
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-chart-line">
                    <FaCalendarAlt />
                  </i>
                  Daily Average
              </div>
              <p className="daily-average">
                {cardData.dailyAverage === 0 ? (
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                ) : (
                  <>₹ {Math.round(cardData.dailyAverage)}</>
                )}
              </p>
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-wave-square">
                    <FaCreditCard />
                  </i>
                  Payment Count
              </div>
              {cardData.transactionsCount === 0 ? (
                <p className="insufficient-data">
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                </p>
              ) : (
                <p style={{display: 'flex', alignItems: 'center', gap: '4px'}}>{cardData.transactionsCount} <span className="transaction-count"></span></p>
              )}
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-bag-shopping">
                    <FaThLarge />
                  </i>
                  Top Category
              </div>
              {!cardData.topCategory || cardData.topCategory === 'N/A' ? (
                <p className="insufficient-data">
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                </p>
              ) : (
                <p>{cardData.topCategory}</p>
              )}
          </div>

      </div>

      {editBudget && (
        <div
          className="edit-budget-overlay"
          onClick={() => setEditBudget(false)}
        >
          <div
            className="edit-budget-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Edit Budget</h2>

            <div className="budget-current-value">
              <span>Current Budget</span>
              <h3>₹ {totalBudget}</h3>
            </div>

            <form onSubmit={handleBudgetSubmit}>
              <div className="budget-input-group">
                <label>New Budget</label>

                <input
                  type="number"
                  placeholder="Enter new budget"
                  value={newBudget}
                  onChange={(e) => setNewBudget(e.target.value)}
                  min="0"
                  required
                />
              </div>

              <div className="budget-modal-actions">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={() => setEditBudget(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="save-btn"
                >
                  {isFetching ? <FetchingLoader /> : "Update Budget"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}