import React, { useState } from 'react';
import { format } from 'date-fns';
import './SetBudget.css';
import '../../common/QueryState.css';
import { expenseAddSuccessToast, expenseAddErrorToast } from '../../alertsEffects/toastMessages';
import BudgetBar from './BudgetBar';
import { useBudgetSummary } from '../../../hooks/queries/useBudgetSummary';
import { FetchingLoader } from '../../alertsEffects/FetchingLoader';
import { useCreateBudgetMutation } from '../../../hooks/mutations/useCreateBudgetMutation';

// Sets or displays the current month's budget, reading from the shared budgets query.
const SetBudget = () => {
  const { monthlyBudgets, budgetStatus, isCurrentMonthStale, refetchBudgets } = useBudgetSummary();
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

  // FE-001-T08 -- previously plain text with no ARIA role and no way to
  // recover from a failed fetch short of reloading the page. role="status"/
  // role="alert" let assistive tech announce the transition, and Retry
  // re-issues the same budgets query rather than leaving the user stuck.
  if (budgetStatus === "loading") {
    return (
      <div className="set-budget">
        <h1>Monthly Budget</h1>
        <span className="query-state-spinner" aria-hidden="true" />
        <p role="status" aria-live="polite">Fetching budget...</p>
      </div>
    );
  }

  if (budgetStatus === "error") {
    return (
      <div className="set-budget">
        <h1>Monthly Budget</h1>
        <p role="alert" aria-live="assertive">Network Error</p>
        <button
          type="button"
          className="query-state-retry"
          onClick={() => refetchBudgets?.()}
        >
          Retry
        </button>
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
            step="any"
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
          <BudgetBar monthlyBudgets={monthlyBudgets} isStale={isCurrentMonthStale} />
        </div>
      )}
    </div>
  );
};

export default SetBudget;