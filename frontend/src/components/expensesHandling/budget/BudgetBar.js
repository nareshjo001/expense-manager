import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import './BudgetBar.css';
import icons from '../../imports/iconsImport';
import { FetchingLoader } from '../../alertsEffects/FetchingLoader';

// Progress bar showing the current month's budget usage, with an animated fill and over-budget alert state.
//
// Phase C.2 -- `isStale` (from useBudgetSummary's `isCurrentMonthStale`)
// indicates the `.spent` figure shown below may still reflect a mutation
// whose budget recalculation is pending recovery (see
// Controllers/BudgetControllers/getbudgets.js's `recoveryPending`/
// `staleMonths`). Rather than hiding or blocking on this, the existing
// value is still shown (best-available data) alongside a calm, explicit
// "still refreshing" note -- consistent with the wording already used
// elsewhere for pending derived-data recovery (see
// alertsEffects/toastMessages.js's deleteSuccessToast).
const BudgetBar = ({ monthlyBudgets, isStale = false }) => {
  const currentMonth = format(new Date(), 'MMM yyyy');

  const budget = monthlyBudgets.find(b => b.month === currentMonth);

  const budgetAmount = budget ? parseFloat(budget.budget) : 0;

  const monthlyTotal = budget ? parseFloat(budget.spent) : 0;

  const percentage = budgetAmount
    ? Math.round(Math.min((monthlyTotal / budgetAmount) * 100))
    : 0;

  const [fill, setFill] = useState(0);

  // Delays the fill update so the width change animates via CSS transition instead of jumping instantly.
  useEffect(() => {
    const timeout = setTimeout(() => setFill(percentage), 100);
    return () => clearTimeout(timeout);
  }, [percentage]);

  return (
    <div className="budget-bar-wrapper">
      <div className="budget-label">Budget - {format(currentMonth, 'MMM')}</div>

      <div className="progress-hover-zone">
        <div className="tooltip-text">
          { percentage <=100 ? (
            <div>
            <div><strong>Budget Set:</strong> ₹{budgetAmount}</div>
            <div><strong>Spent:</strong> ₹{monthlyTotal}</div>
            <div>{percentage}% of budget used</div>
            </div> ) : (
          'Uh-oh! Budget busted. Time to slow down!'
          )}
        </div>

        <div className="progress-container">
          <div
            className="progress-bar"
            style={{ width: `${fill}%` }}
          ></div>

          <div className="bar-circle">
            {percentage <= 100 ?
              `${percentage}%` :
              <img src={icons.alertIcon} className="alert-icon" alt="alert-icon"/>
            }
          </div>
        </div>
      </div>

      {isStale && (
        <div className="budget-refreshing-note" role="status">
          <FetchingLoader />
          <span>Budget is refreshing</span>
        </div>
      )}
    </div>
  );
};

export default BudgetBar;