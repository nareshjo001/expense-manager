import React, { useId, useState } from 'react';
import { format } from 'date-fns';
import './CategoryBudgets.css';
import '../../common/QueryState.css';
import QueryState from '../../common/QueryState';
// DAT-001-T06 -- all money renders through the shared formatter; the API
// sends integer paise, so formatMinor is used directly.
import { formatMinor } from '../../../utils/money';
import { useCategoryBudgetsQuery } from '../../../hooks/queries/useCategoryBudgetsQuery';
import { useSaveCategoryBudgetMutation } from '../../../hooks/mutations/useSaveCategoryBudgetMutation';
import { useDeleteCategoryBudgetMutation } from '../../../hooks/mutations/useDeleteCategoryBudgetMutation';

// BUD-001-T05 -- per-category monthly budgets on top of (never replacing)
// the total monthly budget SetBudget manages. Every financial fact shown
// here (spent, remaining, status, projection, over-allocation) comes from
// the backend summary (docs/budgets/BUD-001-T01-category-budget-invariants.md
// section 3); this component only formats it.

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
// Read-side bucket for invalid legacy data; the backend rejects budgeting it
// (RESERVED_CATEGORY), so it is never offered as a suggestion.
const RESERVED_CATEGORY = 'Uncategorized';

const STATUS_CLASS = {
  Safe: 'safe',
  Warning: 'warning',
  Critical: 'critical',
  Overspent: 'overspent',
};

// errorCode -> inline message. Codes from the T01 contract.
const ERROR_MESSAGES = {
  CATEGORY_BUDGET_EXCEEDS_TOTAL:
    'This would allocate more than your monthly total budget. Lower this amount, reduce another category, or raise the total budget.',
  TOO_MANY_CATEGORY_BUDGETS:
    "You've reached the maximum number of category budgets for this month. Remove one before adding another.",
  MONTH_NOT_WRITABLE:
    'This month is read-only, so its category budgets can no longer be changed.',
  RESERVED_CATEGORY:
    '"Uncategorized" can\'t have a budget. Choose a specific category.',
  INVALID_CATEGORY: 'Enter a category name (up to 50 characters).',
  INVALID_AMOUNT:
    'Enter an amount greater than zero, with at most 2 decimal places.',
  AMOUNT_OUT_OF_RANGE: 'That amount is too large for a category budget.',
  INVALID_MONTH: 'Choose a valid month.',
  CATEGORY_BUDGET_NOT_FOUND:
    'That category budget no longer exists. The list has been refreshed.',
  INVALID_ID:
    'That category budget no longer exists. The list has been refreshed.',
};

const currentMonthKey = () => format(new Date(), 'yyyy-MM');

const monthLabel = (monthKey) => {
  const [year, month] = monthKey.split('-').map(Number);
  return format(new Date(year, month - 1, 1), 'MMMM yyyy');
};

// Integer paise -> the plain rupee string an amount input expects
// ("1500.00"), without going through float arithmetic.
const minorToInputValue = (minor) => {
  const rupees = Math.trunc(minor / 100);
  const paise = String(Math.abs(minor % 100)).padStart(2, '0');
  return `${rupees}.${paise}`;
};

const formatPercent = (value) =>
  `${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;

// Maps a rejected mutation (or a 200 with success:false) to
// { message, field } for inline display. 401/429 are already handled by the
// shared axios interceptor (re-auth / toast), so nothing inline is added.
const describeError = (error) => {
  const response = error?.response;
  if (!response) {
    if (error && error.success === false) {
      return {
        message: ERROR_MESSAGES[error.errorCode] ?? error.message ?? "Couldn't save the category budget.",
        field: error.field,
      };
    }
    return { message: "Couldn't reach the server. Check your connection and try again." };
  }
  if (response.status === 401 || response.status === 429) return null;
  const body = response.data ?? {};
  return {
    message:
      ERROR_MESSAGES[body.errorCode] ??
      body.message ??
      'Something went wrong. Please try again.',
    field: body.field,
  };
};

const EMPTY_FORM = { category: '', amount: '' };

const CategoryBudgetRow = ({
  row,
  writable,
  isConfirmingDelete,
  isDeleting,
  onEdit,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}) => {
  const statusClass = STATUS_CLASS[row.status] ?? 'safe';
  const barValue = Math.max(0, Math.min(Number(row.utilization) || 0, 100));
  const isOver = row.remainingMinor < 0;

  return (
    <li className={`category-budget-row category-budget-row--${statusClass}`}>
      <div className="category-budget-row-header">
        <span className="category-budget-name">{row.category}</span>
        <span className={`category-budget-status category-budget-status--${statusClass}`}>
          {row.status}
        </span>
      </div>

      <div
        className="category-budget-progress"
        role="progressbar"
        aria-label={`${row.category} budget used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barValue}
        aria-valuetext={`${formatPercent(row.utilization)} used, ${row.status}`}
      >
        <div
          className={`category-budget-progress-fill category-budget-progress-fill--${statusClass}`}
          style={{ width: `${barValue}%` }}
        />
      </div>

      <dl className="category-budget-figures">
        <div>
          <dt>Budget</dt>
          <dd>{formatMinor(row.amountMinor)}</dd>
        </div>
        <div>
          <dt>Spent</dt>
          <dd>
            {formatMinor(row.spentMinor)} ({formatPercent(row.utilization)})
          </dd>
        </div>
        <div>
          <dt>{isOver ? 'Over by' : 'Remaining'}</dt>
          <dd className={isOver ? 'category-budget-over' : undefined}>
            {formatMinor(Math.abs(row.remainingMinor))}
          </dd>
        </div>
      </dl>

      {row.atRisk && (
        <p className="category-budget-at-risk">
          On pace to exceed this budget
          {typeof row.projectedSpentMinor === 'number' &&
            ` (projected ${formatMinor(row.projectedSpentMinor)} by month end)`}
          .
        </p>
      )}

      {writable && !isConfirmingDelete && (
        <div className="category-budget-actions">
          <button
            type="button"
            className="category-budget-button"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.category} budget`}
          >
            Edit
          </button>
          <button
            type="button"
            className="category-budget-button category-budget-button--danger"
            onClick={() => onRequestDelete(row.id)}
            aria-label={`Delete ${row.category} budget`}
          >
            Delete
          </button>
        </div>
      )}

      {writable && isConfirmingDelete && (
        <div className="category-budget-confirm" role="group" aria-label={`Confirm deleting ${row.category} budget`}>
          <span>Delete the {row.category} budget?</span>
          <button
            type="button"
            className="category-budget-button category-budget-button--danger"
            onClick={() => onConfirmDelete(row)}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Confirm delete'}
          </button>
          <button
            type="button"
            className="category-budget-button"
            onClick={onCancelDelete}
            disabled={isDeleting}
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  );
};

const CategoryBudgets = () => {
  const idPrefix = useId();
  const monthInputId = `${idPrefix}-month`;
  const categoryInputId = `${idPrefix}-category`;
  const amountInputId = `${idPrefix}-amount`;
  const suggestionsId = `${idPrefix}-suggestions`;
  const formErrorId = `${idPrefix}-form-error`;

  const [month, setMonth] = useState(currentMonthKey);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [formError, setFormError] = useState(null);
  const [listError, setListError] = useState(null);
  const [notice, setNotice] = useState('');

  const query = useCategoryBudgetsQuery(month);
  const saveMutation = useSaveCategoryBudgetMutation();
  const deleteMutation = useDeleteCategoryBudgetMutation();

  const summary = query.data?.success ? query.data.data : null;
  const isError = query.isError || query.data?.success === false;
  const categories = summary?.categories ?? [];
  const unbudgeted = summary?.unbudgetedCategories ?? [];
  const totals = summary?.totals;
  const writable = summary?.writable === true;

  // No canonical category list exists client-side (CAT-001 categories are
  // free text), so suggest the categories this month already has data for.
  const suggestions = [
    ...new Set([...unbudgeted, ...categories].map((c) => c.category)),
  ]
    .filter((name) => name && name !== RESERVED_CATEGORY)
    .sort((a, b) => a.localeCompare(b));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
  };

  const handleMonthChange = (e) => {
    const next = e.target.value;
    // Ignore partial/cleared input rather than issuing an INVALID_MONTH read.
    if (!MONTH_PATTERN.test(next)) return;
    setMonth(next);
    resetForm();
    setConfirmingDeleteId(null);
    setListError(null);
    setNotice('');
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({ category: row.category, amount: minorToInputValue(row.amountMinor) });
    setFormError(null);
    setNotice('');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const category = form.category.trim();
    const amount = form.amount.trim();
    if (!category || !amount || saveMutation.isPending) return;

    setFormError(null);
    setNotice('');
    saveMutation.mutate(
      { month, category, amount },
      {
        onSuccess: (data) => {
          if (!data?.success) {
            setFormError(describeError(data));
            return;
          }
          const saved = data.data?.budget?.category ?? category;
          setNotice(`Saved the ${saved} budget.`);
          resetForm();
        },
        onError: (error) => {
          setFormError(describeError(error));
        },
      }
    );
  };

  const handleConfirmDelete = (row) => {
    setListError(null);
    setNotice('');
    deleteMutation.mutate(
      { id: row.id, month },
      {
        onSuccess: (data) => {
          setConfirmingDeleteId(null);
          if (!data?.success) {
            setListError(describeError(data));
            return;
          }
          if (editingId === row.id) resetForm();
          setNotice(`Deleted the ${row.category} budget.`);
        },
        onError: (error) => {
          setConfirmingDeleteId(null);
          setListError(describeError(error));
        },
      }
    );
  };

  const isFormIncomplete = !form.category.trim() || !form.amount.trim();

  const renderTotals = () => (
    <div className="category-budgets-totals">
      {totals.totalBudgetMinor === null ? (
        <>
          <p>
            <strong>Allocated:</strong> {formatMinor(totals.allocatedMinor)}
          </p>
          <p className="category-budgets-note">
            No monthly total budget is set for this month. Category budgets still work on their own.
          </p>
        </>
      ) : (
        <p>
          <strong>Allocated:</strong> {formatMinor(totals.allocatedMinor)} of{' '}
          {formatMinor(totals.totalBudgetMinor)} total budget
          {!totals.overAllocated && typeof totals.unallocatedMinor === 'number' && totals.unallocatedMinor > 0 && (
            <> ({formatMinor(totals.unallocatedMinor)} unallocated)</>
          )}
        </p>
      )}

      {totals.overAllocated && (
        <p className="category-budgets-warning">
          Warning: over-allocated by {formatMinor(totals.overAllocatedByMinor)}. Your category
          budgets add up to more than this month&apos;s total budget. Lower some category budgets
          or raise the total.
        </p>
      )}

      {(unbudgeted.length > 0 || totals.unbudgetedSpentMinor > 0) && (
        <div className="category-budgets-unbudgeted">
          <h3>Unbudgeted spending: {formatMinor(totals.unbudgetedSpentMinor)}</h3>
          {unbudgeted.length > 0 && (
            <ul aria-label="Unbudgeted spending by category">
              {unbudgeted.map((c) => (
                <li key={c.category}>
                  {c.category}: {formatMinor(c.spentMinor)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  const renderForm = () => (
    <form
      className="category-budgets-form"
      onSubmit={handleSubmit}
      aria-label={editingId ? 'Edit category budget' : 'Add category budget'}
      noValidate
    >
      <div className="category-budgets-field">
        <label htmlFor={categoryInputId}>Category</label>
        <input
          id={categoryInputId}
          type="text"
          list={suggestionsId}
          value={form.category}
          maxLength={50}
          readOnly={Boolean(editingId)}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          aria-invalid={formError?.field === 'category' ? true : undefined}
          aria-describedby={formError ? formErrorId : undefined}
          required
        />
        <datalist id={suggestionsId}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>

      <div className="category-budgets-field">
        <label htmlFor={amountInputId}>Amount (₹)</label>
        <input
          id={amountInputId}
          type="number"
          inputMode="decimal"
          min="0.01"
          step="0.01"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          aria-invalid={formError?.field === 'amount' ? true : undefined}
          aria-describedby={formError ? formErrorId : undefined}
          required
        />
      </div>

      <div className="category-budgets-form-actions">
        <button
          type="submit"
          className="category-budget-button category-budget-button--primary"
          disabled={saveMutation.isPending || isFormIncomplete}
        >
          {saveMutation.isPending
            ? 'Saving...'
            : editingId
              ? 'Update budget'
              : 'Add budget'}
        </button>
        {editingId && (
          <button
            type="button"
            className="category-budget-button"
            onClick={resetForm}
            disabled={saveMutation.isPending}
          >
            Cancel edit
          </button>
        )}
      </div>

      {formError && (
        <p id={formErrorId} className="category-budgets-error" role="alert">
          {formError.message}
        </p>
      )}
    </form>
  );

  return (
    <section className="category-budgets" aria-labelledby={`${idPrefix}-heading`}>
      <div className="category-budgets-header">
        <h2 id={`${idPrefix}-heading`}>Category Budgets</h2>
        <div className="category-budgets-month">
          <label htmlFor={monthInputId}>Month</label>
          <input
            id={monthInputId}
            type="month"
            value={month}
            onChange={handleMonthChange}
          />
        </div>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={isError}
        onRetry={() => query.refetch()}
        loadingLabel="Loading category budgets..."
        errorLabel="Couldn't load category budgets."
      >
        {summary && totals && (
          <>
            {summary.rolloverPolicy === 'none' && (
              <p className="category-budgets-note">
                Unspent amounts don&apos;t carry over to next month.
              </p>
            )}

            {!writable && (
              <p className="category-budgets-note category-budgets-readonly">
                {monthLabel(summary.month ?? month)} is read-only. Category budgets can only be changed
                for the current month and upcoming months.
              </p>
            )}

            {renderTotals()}

            {notice && (
              <p className="category-budgets-notice" role="status">
                {notice}
              </p>
            )}

            {listError && (
              <p className="category-budgets-error" role="alert">
                {listError.message}
              </p>
            )}

            {categories.length === 0 ? (
              <div className="category-budgets-empty">
                <p>No category budgets for {monthLabel(summary.month ?? month)} yet.</p>
                {writable && (
                  <p className="category-budgets-note">
                    Give a category like Food or Travel its own limit to track it separately from
                    your overall budget.
                  </p>
                )}
              </div>
            ) : (
              <ul className="category-budgets-list" aria-label="Category budgets">
                {categories.map((row) => (
                  <CategoryBudgetRow
                    key={row.id}
                    row={row}
                    writable={writable}
                    isConfirmingDelete={confirmingDeleteId === row.id}
                    isDeleting={deleteMutation.isPending}
                    onEdit={handleEdit}
                    onRequestDelete={setConfirmingDeleteId}
                    onCancelDelete={() => setConfirmingDeleteId(null)}
                    onConfirmDelete={handleConfirmDelete}
                  />
                ))}
              </ul>
            )}

            {writable && renderForm()}
          </>
        )}
      </QueryState>
    </section>
  );
};

export default CategoryBudgets;
