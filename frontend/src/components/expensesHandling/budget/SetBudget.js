import React, { useState } from 'react';
import { format } from 'date-fns';
import './SetBudget.css';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../../alertsEffects/toastMessages';
import BudgetBar from './BudgetBar';
import { useBudgetSummary } from '../../../hooks/queries/useBudgetSummary';
import { FetchingLoader } from '../../alertsEffects/FetchingLoader';
import { useCreateBudgetMutation } from '../../../hooks/mutations/useCreateBudgetMutation';

// Sets or displays the current month's budget, reading from the shared budgets query.
const SetBudget = () => {
  const { monthlyBudgets, budgetStatus } = useBudgetSummary();
  const createBudgetMutation = useCreateBudgetMutation();

  const [budget, setBudget] = useState({ month: "", budgetAmount: "" });
  const [isSetBudget, setIsSetBudget] = useState(true);

  const currentMonth = format(new Date(), 'MMM yyyy');

  const isCurrentMonthSet = () =>
    monthlyBudgets.some(b => b.month === currentMonth);

  const handleBudgetChange = (e) => {
    setBudget({
      month: currentMonth,
      budgetAmount: Number(e.target.value),
    });
  };

  const handleBudgetSubmit = () => {
    createBudgetMutation.mutate(Number(budget.budgetAmount), {
      onSuccess: (data) => {
        if (!data.success) {
          expenseAddErrorToast(data);
          console.error("Error setting budget:", data.message);
          return;
        }

        expenseAddSuccessToast(data);

        // Reset UI state only after a verified successful save
        setIsSetBudget(true);
        setBudget({ month: "", budgetAmount: "" });
      },
      onError: (error) => {
        // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
        const status = error.response?.status;
        if (status === 401 || status === 429 || status === 409) return;
        console.error("Network error while saving budget:", error);
      },
    });
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
            {createBudgetMutation.isPending ? <FetchingLoader /> :  "Confirm"}
          </button>
        </div>
      )}

      {isCurrentMonthSet() && (
        <div className="budget-notify set-budget">
          <BudgetBar monthlyBudgets={monthlyBudgets} />
        </div>
      )}
    </div>
  );
};

export default SetBudget;