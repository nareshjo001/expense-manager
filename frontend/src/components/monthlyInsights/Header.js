import { FaCalendarAlt, FaCreditCard, FaThLarge, FaArrowUp, FaArrowDown, } from "react-icons/fa";
import { FaArrowTrendUp, FaPen  } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { useBudgetSummary } from "../../hooks/queries/useBudgetSummary";
import { useEffect, useState } from "react";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { FetchingLoader } from "../alertsEffects/FetchingLoader";
import { useUpdateBudgetMutation } from "../../hooks/mutations/useUpdateBudgetMutation";
import "./Header.css";
import "../common/QueryState.css";

// Monthly budget insights header: summary cards plus an inline budget-edit modal.
export default function Header({ summary }) {
  // FE-001-T08 -- this is a SEPARATE subscription to the budgets query from
  // SetBudget.js's own (both derive from the same useBudgetsQuery cache).
  // Previously ignored isLoading/isError entirely and rendered totalBudget
  // (defaulting to 0) regardless of query state.
  const { totalBudget, budgetStatus, refetchBudgets } = useBudgetSummary();
  const [editBudget, setEditBudget] = useState(false);
  const [newBudget, setNewBudget] = useState(totalBudget || "");

  const [animate, setAnimate] = useState(false);

  const updateBudgetMutation = useUpdateBudgetMutation();

  useEffect(() => {
    if (summary) {
      const t = setTimeout(() => setAnimate(true), 50);
      return () => clearTimeout(t);
    }
  }, [summary]);

  const currentMonthYear = new Date().toLocaleString('default', {
    month: 'long',
    year: 'numeric',
  });

  const comparePastMonth = summary.comparePastMonth;
  const percentageChange = comparePastMonth != null ? Math.abs(comparePastMonth) : null;
 
  const handleBudgetSubmit = (e) => {
    e.preventDefault();
    updateBudgetMutation.mutate(newBudget, {
      onSuccess: (data) => {
        if (!data.success) {
          expenseAddErrorToast({ message: "Failed to update budget." });
          console.error("Error updating budget:", data.message);
          return;
        }

        setNewBudget("");
        setEditBudget(false);
      },
      onError: (error) => {
        // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
        const status = error.response?.status;
        if (status === 401 || status === 429 || status === 409) return;
        expenseAddErrorToast({ message: "Failed to update budget." });
        console.error("Error updating budget:", error);
      },
    });
  };

  return (
    <div className="monthly-insights budget-insights-header">

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
              <button
                type="button"
                className="edit-budget-icon"
                aria-label="Edit budget"
                title={budgetStatus === "ready" ? "Edit Budget" : "Budget is loading"}
                onClick={() => setEditBudget(true)}
                disabled={budgetStatus !== "ready"}
              >
                <FaPen />
              </button>
              {budgetStatus === "loading" ? (
                <p role="status" aria-live="polite">Loading&hellip;</p>
              ) : budgetStatus === "error" ? (
                <>
                  <p role="alert" aria-live="assertive">Unable to load</p>
                  <button
                    type="button"
                    className="query-state-retry"
                    onClick={() => refetchBudgets?.()}
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>
                  <p>Total Budget</p>
                  <h1>₹ {totalBudget}</h1>
                  <span>Spent: ₹ {summary.totalSpent}</span>
                </>
              )}
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
                {comparePastMonth == null ? (
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                ) : comparePastMonth > 0 ? (
                  <span className="positive">
                    <FaArrowUp /> {percentageChange}% higher than last month
                  </span>
                ) : comparePastMonth < 0 ? (
                  <span className="negative">
                    <FaArrowDown /> {percentageChange}% lower than last month
                  </span>
                ) : (
                  <span className="positive">
                    No change from last month
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
                {summary.dailyAverage === 0 || summary.dailyAverage === undefined ? (
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                ) : (
                  <>₹ {Math.round(summary.dailyAverage)}</>
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
              {summary.transactionCount === 0 || summary.transactionCount === undefined ? (
                <p className="insufficient-data">
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                </p>
              ) : (
                <p style={{display: 'flex', alignItems: 'center', gap: '4px'}}>{summary.transactionCount} <span className="transaction-count"></span></p>
              )}
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <i className="fa-solid fa-bag-shopping">
                    <FaThLarge />
                  </i>
                  Top Category
              </div>
              {!summary.topCategory || summary.topCategory === 'N/A' ? (
                <p className="insufficient-data">
                  <span style={{ fontSize: "16px" }}>
                    Insufficient data
                  </span>
                </p>
              ) : (
                <p>{summary.topCategory}</p>
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
                  step="any"
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
                  {updateBudgetMutation.isPending ? <FetchingLoader /> : "Update Budget"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
