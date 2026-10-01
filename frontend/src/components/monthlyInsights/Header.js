import { FaCalendarAlt, FaCreditCard, FaThLarge, FaArrowUp, FaArrowDown } from "react-icons/fa";
// DAT-001-T06 -- all money renders through the shared formatter.
import { formatMoney } from "../../utils/money";
import { FaArrowTrendUp, FaArrowTrendDown, FaPen } from "react-icons/fa6";
import { HiSparkles } from "react-icons/hi2";
import { useBudgetSummary } from "../../hooks/queries/useBudgetSummary";
import { useEffect, useRef, useState } from "react";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { useModalA11y } from "../hooks/useModalA11y";
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

  // FE-a11y: the edit-budget overlay had no dialog semantics -- no
  // role="dialog", no focus trap, no Escape handling -- same gap as
  // DeleteAlert/SaveRuleAlert/IncomeModal, fixed the same way.
  const editBudgetDialogRef = useRef(null);
  useModalA11y(editBudgetDialogRef, () => setEditBudget(false), editBudget);

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
              <div className="budget-header-brand-tile" aria-hidden="true">
                <HiSparkles />
              </div>
              <div className="budget-header-title-wrap">
                <h1 className="monthly-insights-header-title">
                    Budget Insights
                </h1>

                <p className="monthly-insights-header-description">
                    Intelligent financial overview • {currentMonthYear}
                </p>
              </div>
          </div>

          <div className="monthly-insights-header-budget">
              <div className="budget-total-card-top">
                {budgetStatus !== "loading" && budgetStatus !== "error" && (
                  <p className="budget-total-card-label">Total Budget</p>
                )}
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
              </div>

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
                  <h1>{formatMoney(totalBudget)}</h1>
                  <div className="budget-total-card-footer">
                    <span className="budget-total-card-spent">Spent: {formatMoney(summary.totalSpent)}</span>
                    <svg className="budget-decor-bars" width="24" height="18" viewBox="0 0 24 18" fill="none" aria-hidden="true">
                      <rect x="2" y="12" width="3" height="6" rx="1.5" fill="currentColor" opacity="0.35" />
                      <rect x="8" y="8" width="3" height="10" rx="1.5" fill="currentColor" opacity="0.45" />
                      <rect x="14" y="5" width="3" height="13" rx="1.5" fill="currentColor" opacity="0.65" />
                      <rect x="20" y="2" width="3" height="16" rx="1.5" fill="currentColor" opacity="0.85" />
                    </svg>
                  </div>
                </>
              )}
          </div>

      </div>

      <div className={`monthly-insights-body-cards ${animate ? "show" : ""}`}>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <div className="budget-card-icon-badge" aria-hidden="true">
                    {comparePastMonth != null && comparePastMonth < 0 ? (
                      <FaArrowTrendDown />
                    ) : (
                      <FaArrowTrendUp />
                    )}
                  </div>
                  <span>Spending Trend</span>
              </div>
              <div className="budget-insight-card-content">
                <div className="budget-insight-val-block">
                  {comparePastMonth == null ? (
                    <p className="insufficient-data">
                      <span style={{ fontSize: "16px" }}>Insufficient data</span>
                    </p>
                  ) : (
                    <>
                      <div className="budget-insight-val-row" aria-hidden="true">
                        {comparePastMonth !== 0 && (
                          <span className="budget-insight-trend-arrow">
                            {comparePastMonth < 0 ? <FaArrowDown /> : <FaArrowUp />}
                          </span>
                        )}
                        <span className="budget-insight-main-num">{percentageChange}%</span>
                      </div>
                      <span className="budget-insight-subtext" aria-hidden="true">
                        {comparePastMonth !== 0
                          ? "than last month"
                          : "No change from last month"}
                      </span>
                      <span className="sr-only">
                        {percentageChange}% {comparePastMonth > 0
                          ? "higher than last month"
                          : comparePastMonth < 0
                          ? "lower than last month"
                          : "No change from last month"}
                      </span>
                    </>
                  )}
                </div>
                <div className="budget-insight-graphic" aria-hidden="true">
                  <svg className="insight-decor-wave" width="76" height="30" viewBox="0 0 76 30" fill="none">
                    <defs>
                      <linearGradient id="trendWaveGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ec4899" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#ec4899" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M 2 24 C 6 24, 11 15, 15 15 C 19 15, 22 21, 26 21 C 30 21, 34 11, 38 11 C 42 11, 44 15, 48 15 C 52 15, 54 8, 58 8 C 61 8, 63 10, 65 10 C 67 10, 69 6, 71 4 L 71 29 L 2 29 Z"
                      fill="url(#trendWaveGrad)"
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
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <div className="budget-card-icon-badge" aria-hidden="true">
                    <FaCalendarAlt />
                  </div>
                  <span>Daily Average</span>
              </div>
              <div className="budget-insight-card-content">
                <div className="budget-insight-val-block">
                  <p className="daily-average">
                    {summary.dailyAverage === 0 || summary.dailyAverage === undefined ? (
                      <span style={{ fontSize: "16px" }}>Insufficient data</span>
                    ) : (
                      formatMoney(summary.dailyAverage)
                    )}
                  </p>
                </div>
                <div className="budget-insight-graphic" aria-hidden="true">
                  <svg className="insight-decor-bars" width="28" height="22" viewBox="0 0 28 22" fill="none">
                    <rect x="2" y="14" width="3.5" height="8" rx="1.75" fill="#ec4899" opacity="0.3" />
                    <rect x="8.5" y="10" width="3.5" height="12" rx="1.75" fill="#ec4899" opacity="0.45" />
                    <rect x="15" y="6" width="3.5" height="16" rx="1.75" fill="#ec4899" opacity="0.65" />
                    <rect x="21.5" y="2" width="3.5" height="20" rx="1.75" fill="#ec4899" opacity="0.85" />
                  </svg>
                </div>
              </div>
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <div className="budget-card-icon-badge" aria-hidden="true">
                    <FaCreditCard />
                  </div>
                  <span>Payment Count</span>
              </div>
              <div className="budget-insight-card-content">
                <div className="budget-insight-val-block">
                  {summary.transactionCount === 0 || summary.transactionCount === undefined ? (
                    <p className="insufficient-data">
                      <span style={{ fontSize: "16px" }}>Insufficient data</span>
                    </p>
                  ) : (
                    <p>{summary.transactionCount}</p>
                  )}
                </div>
                <div className="budget-insight-graphic" aria-hidden="true">
                  <svg className="insight-decor-bars" width="28" height="22" viewBox="0 0 28 22" fill="none">
                    <rect x="2" y="14" width="3.5" height="8" rx="1.75" fill="#ec4899" opacity="0.3" />
                    <rect x="8.5" y="10" width="3.5" height="12" rx="1.75" fill="#ec4899" opacity="0.45" />
                    <rect x="15" y="6" width="3.5" height="16" rx="1.75" fill="#ec4899" opacity="0.65" />
                    <rect x="21.5" y="2" width="3.5" height="20" rx="1.75" fill="#ec4899" opacity="0.85" />
                  </svg>
                </div>
              </div>
          </div>

          <div className="monthly-insights-card">
              <div className="monthly-insights-card-header">
                  <div className="budget-card-icon-badge" aria-hidden="true">
                    <FaThLarge />
                  </div>
                  <span>Top Category</span>
              </div>
              <div className="budget-insight-card-content">
                <div className="budget-insight-val-block">
                  {!summary.topCategory || summary.topCategory === 'N/A' ? (
                    <p className="insufficient-data">
                      <span style={{ fontSize: "16px" }}>Insufficient data</span>
                    </p>
                  ) : (
                    <p title={summary.topCategory}>{summary.topCategory}</p>
                  )}
                </div>
                <div className="budget-insight-graphic" aria-hidden="true">
                  <svg className="insight-decor-donut" width="30" height="30" viewBox="0 0 34 34" fill="none">
                    <circle cx="17" cy="17" r="12" stroke="#fce7f3" strokeWidth="4" />
                    <circle
                      cx="17"
                      cy="17"
                      r="12"
                      stroke="#ec4899"
                      strokeWidth="4"
                      strokeDasharray="42 76"
                      strokeDashoffset="8"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-budget-heading"
            ref={editBudgetDialogRef}
            tabIndex={-1}
          >
            <h2 id="edit-budget-heading">Edit Budget</h2>

            <div className="budget-current-value">
              <span>Current Budget</span>
              <h3>{formatMoney(totalBudget)}</h3>
            </div>

            <form onSubmit={handleBudgetSubmit}>
              <div className="budget-input-group">
                <label htmlFor="edit-budget-amount">New Budget</label>

                <input
                  id="edit-budget-amount"
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
