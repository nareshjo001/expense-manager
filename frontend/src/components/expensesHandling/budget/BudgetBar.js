import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import './BudgetBar.css';
import icons from '../../imports/iconsImport';

const BudgetBar = ({ monthlyBudgets }) => {
  // Get the current month in 'MMM yyyy' format (e.g., 'Aug 2025')
  const currentMonth = format(new Date(), 'MMM yyyy');

  // Find the budget entry for the current month
  const budget = monthlyBudgets.find(b => b.month === currentMonth);

  // Extract the budget amount or default to 0 if not found
  const budgetAmount = budget ? parseFloat(budget.budget) : 0;

  // Calculate the total expenses for the current month
  const monthlyTotal = budget ? parseFloat(budget.spent) : 0;

  // Calculate the percentage of the budget used (clamped to 100%)
  const percentage = budgetAmount
    ? Math.round(Math.min((monthlyTotal / budgetAmount) * 100))
    : 0;

  // Local state for animating progress bar fill
  const [fill, setFill] = useState(0);

  // Animate the bar filling effect when percentage changes
  useEffect(() => {
    const timeout = setTimeout(() => setFill(percentage), 100);
    return () => clearTimeout(timeout);
  }, [percentage]);

  return (
    <div className="budget-bar-wrapper">
      {/* Displays the label with current month */}
      <div className="budget-label">Budget - {format(currentMonth, 'MMM')}</div>

      {/* Container for hover tooltip and animated bar */}
      <div className="progress-hover-zone">
        {/* Tooltip displayed on hover with breakdown */}
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

        {/* Progress bar visual */}
        <div className="progress-container">
          <div
            className="progress-bar"
            style={{ width: `${fill}%` }}
          ></div>

          {/* Circular percentage badge or alert icon if exceeded */}
          <div className="bar-circle">
            {percentage <= 100 ?
              `${percentage}%` :
              <img src={icons.alertIcon} className="alert-icon" alt="alert-icon"/>
            }
          </div>
        </div>
      </div>
    </div>
  );
};

export default BudgetBar;