import React, { useState, useContext } from 'react';
import { format } from 'date-fns';
import './SetBudget.css';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../../alertsEffects/toastMessages';
import BudgetBar from './BudgetBar';
import { BudgetContext } from '../../contexts/BudgetContext';
import { FetchingLoader } from '../../alertsEffects/FetchingLoader';

const SetBudget = () => {
  // Accessing global budget context to get and set monthly budgets
  const { monthlyBudgets, setMonthlyBudgets, budgetStatus, fetchBudgets } = useContext(BudgetContext);

  // Local state to hold input budget and toggle view
  const [budget, setBudget] = useState({ month: "", budgetAmount: "" });
  const [isSetBudget, setIsSetBudget] = useState(true);
  
  const [isFetching, setIsFetching] = useState(false); 

  // Current month key (single source of truth)
  const currentMonth = format(new Date(), 'MMM yyyy');

  // Checks whether current month's budget already exists
  const isCurrentMonthSet = () =>
    monthlyBudgets.some(b => b.month === currentMonth);

  // Handle budget input change
  const handleBudgetChange = (e) => {
    setBudget({
      month: currentMonth,
      budgetAmount: Number(e.target.value),
    });
  };

  // Save the entered budget and update the context
  const handleBudgetSubmit = async () => {
    try {
      const token = localStorage.getItem("token");

      const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
      if (!token || !BASE_URL) return;

      setIsFetching(true);
      // Save budget for current month
      const response = await fetch(`${BASE_URL}/auth/setbudget`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          budget: Number(budget.budgetAmount)
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setIsFetching(false);
        expenseAddErrorToast(data);
        console.error("Error setting budget:", data.message);
        return;
      }

      // FETCH updated budgets AFTER backend recalculation
      const budgetsRes = await fetch(`${BASE_URL}/auth/getbudgets`, {
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });

      const budgetsData = await budgetsRes.json();

      if (budgetsData.success) {
        fetchBudgets(); // Refresh context with latest budgets
        setIsFetching(false);
        expenseAddSuccessToast(data);
        setMonthlyBudgets(budgetsData.data);
      }

      // Reset UI state
      setIsSetBudget(true);
      setBudget({ month: "", budgetAmount: "" });

    } catch (err) {
      console.error("Network error while saving budget:", err);
    }
  };

  if (budgetStatus === "loading") {
    return (
      <div className="set-budget">
        <h1>Monthly Budget</h1>
        <p>Fetching budget...</p>
      </div>
    );
  }

  if (budgetStatus === "error") {
    return (
      <div className="set-budget">
        <h1>Monthly Budget</h1>
        <p>Network Error</p>
      </div>
    );
  }

  return (
    <div>
       {/* Show 'Set Budget' icon if not already set */}
      {isSetBudget && !isCurrentMonthSet() && (
        <div className="set-budget">
          <h1>Set Your Monthly Budget!</h1>
          <button 
            className="setbudget-button" 
            onClick={() => setIsSetBudget(false)}
          >
            Set
          </button>
        </div>
      )}

      {/* Input field for setting budget */}
      {!isSetBudget && (
        <div className="set-budget">
          <input
            type="number"
            value={budget.budgetAmount}
            placeholder="Enter Your Budget"
            onChange={handleBudgetChange}
            min={0}
            required
          />
          <button
            className="confirm"
            onClick={handleBudgetSubmit}
            disabled={!budget.budgetAmount || budget.budgetAmount <= 0}
          >
            {isFetching ? <FetchingLoader /> :  "Confirm"}
          </button>
        </div>
      )}

      {/* Show BudgetBar if budget is already set */}
      {isCurrentMonthSet() && (
        <div className="budget-notify set-budget">
          <BudgetBar monthlyBudgets={monthlyBudgets} />
        </div>
      )}
    </div>
  );
};

export default SetBudget;