import React, { useState } from "react";
import { format, parseISO } from "date-fns";
import "../expensesHandling/AddExpense.css";
import "./RecurringManagement.css";

import QueryState from "../common/QueryState";
import { formatMoney } from "../../utils/money";
import { useRecurringDefinitionsQuery } from "../../hooks/queries/useRecurringDefinitionsQuery";
import { usePauseRecurringMutation } from "../../hooks/mutations/usePauseRecurringMutation";
import { useResumeRecurringMutation } from "../../hooks/mutations/useResumeRecurringMutation";
import { useEndRecurringMutation } from "../../hooks/mutations/useEndRecurringMutation";
import { useEditRecurringMutation } from "../../hooks/mutations/useEditRecurringMutation";
import {
  recurringActionSuccessToast,
  recurringActionErrorToast,
} from "../alertsEffects/toastMessages";

// REC-002-T05 -- manage every recurring definition regardless of status:
// pause/resume/end, and edit the definition's own future-affecting fields.
//
// Deliberately separate from UpcomingRecurring.js (REC-003), which only
// ever shows OCCURRENCES of ACTIVE definitions -- a paused or ended
// definition produces none, so it has nowhere to appear there. This is the
// one place a paused definition is visible at all, and the only place it
// can be resumed.

const STATUS_LABEL = {
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

function formatDate(value) {
  if (!value) return null;
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return null;
  }
}

function EditForm({ definition, onCancel, onSave, isSaving }) {
  const [expenseName, setExpenseName] = useState(definition.expenseName || "");
  const [expenseCategory, setExpenseCategory] = useState(definition.expenseCategory || "");
  const [expenseAmount, setExpenseAmount] = useState(
    definition.expenseAmount != null ? String(definition.expenseAmount) : ""
  );
  const [nextDueDate, setNextDueDate] = useState(
    definition.nextDueDate ? definition.nextDueDate.slice(0, 10) : ""
  );
  const [endDate, setEndDate] = useState(definition.endDate ? definition.endDate.slice(0, 10) : "");

  const handleSubmit = (e) => {
    e.preventDefault();
    const updates = {
      expenseName: expenseName.trim(),
      expenseCategory: expenseCategory.trim(),
      expenseAmount: Number(expenseAmount),
      nextDueDate: nextDueDate ? new Date(nextDueDate).toISOString() : undefined,
      // An explicit null clears a previously-set endDate -- a blank field is
      // ambiguous between "unchanged" and "clear", so an untouched blank
      // field that started blank is simply omitted (undefined), while a
      // field the user emptied out on a definition that HAD an endDate is
      // sent as null.
      endDate: endDate ? new Date(endDate).toISOString() : definition.endDate ? null : undefined,
    };
    onSave(updates);
  };

  return (
    <form className="recurring-mgmt-edit-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={`rec-edit-name-${definition.id}`}>Name</label>
        <input
          id={`rec-edit-name-${definition.id}`}
          type="text"
          value={expenseName}
          onChange={(e) => setExpenseName(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor={`rec-edit-category-${definition.id}`}>Category</label>
        <input
          id={`rec-edit-category-${definition.id}`}
          type="text"
          value={expenseCategory}
          onChange={(e) => setExpenseCategory(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor={`rec-edit-amount-${definition.id}`}>Amount</label>
        <input
          id={`rec-edit-amount-${definition.id}`}
          type="number"
          min="0.01"
          step="0.01"
          value={expenseAmount}
          onChange={(e) => setExpenseAmount(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor={`rec-edit-next-due-${definition.id}`}>Next due date</label>
        <input
          id={`rec-edit-next-due-${definition.id}`}
          type="date"
          value={nextDueDate}
          onChange={(e) => setNextDueDate(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor={`rec-edit-end-date-${definition.id}`}>End date (optional)</label>
        <input
          id={`rec-edit-end-date-${definition.id}`}
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>

      <div className="recurring-mgmt-form-actions">
        <button className="submit-btn" type="submit" disabled={isSaving}>
          {isSaving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" className="recurring-mgmt-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EndConfirm({ definition, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="end-recurring-message">
        <p id="end-recurring-message">
          End "{definition.expenseName}"? This stops it permanently — it cannot be resumed, unlike pausing.
        </p>
        <div className="modal-buttons">
          <button onClick={onCancel}>Cancel</button>
          <button onClick={onConfirm}>Yes, End</button>
        </div>
      </div>
    </div>
  );
}

const RecurringManagement = () => {
  const definitionsQuery = useRecurringDefinitionsQuery();
  const pauseMutation = usePauseRecurringMutation();
  const resumeMutation = useResumeRecurringMutation();
  const endMutation = useEndRecurringMutation();
  const editMutation = useEditRecurringMutation();

  const [editingId, setEditingId] = useState(null);
  const [confirmEndId, setConfirmEndId] = useState(null);

  const definitions = definitionsQuery.data?.success ? definitionsQuery.data.data : [];

  const handlePause = (id) => {
    pauseMutation.mutate(
      { id },
      {
        onSuccess: () => recurringActionSuccessToast("Recurring expense paused."),
        onError: (error) => recurringActionErrorToast(error.response?.data),
      }
    );
  };

  const handleResume = (id) => {
    resumeMutation.mutate(
      { id },
      {
        onSuccess: () => recurringActionSuccessToast("Recurring expense resumed."),
        onError: (error) => recurringActionErrorToast(error.response?.data),
      }
    );
  };

  const handleEndConfirmed = () => {
    const id = confirmEndId;
    endMutation.mutate(
      { id },
      {
        onSuccess: () => {
          recurringActionSuccessToast("Recurring expense ended.");
          setConfirmEndId(null);
        },
        onError: (error) => {
          recurringActionErrorToast(error.response?.data);
          setConfirmEndId(null);
        },
      }
    );
  };

  const handleSaveEdit = (id, scheduleVersion, updates) => {
    editMutation.mutate(
      { id, updates, scheduleVersion },
      {
        onSuccess: () => {
          recurringActionSuccessToast("Recurring expense updated.");
          setEditingId(null);
        },
        onError: (error) => recurringActionErrorToast(error.response?.data),
      }
    );
  };

  const confirmEndDefinition = definitions.find((d) => d.id === confirmEndId);

  return (
    <div className="add-page recurring-mgmt-page">
      <h2 className="recurring-mgmt-heading">Manage Recurring Expenses</h2>
      <p className="recurring-mgmt-subheading">
        Pause, resume, end, or edit a recurring schedule. Paused schedules stop showing up as upcoming
        until resumed; ending one is permanent.
      </p>

      <QueryState
        isLoading={definitionsQuery.isLoading}
        isError={definitionsQuery.isError}
        isEmpty={!definitionsQuery.isLoading && !definitionsQuery.isError && definitions.length === 0}
        onRetry={definitionsQuery.refetch}
        loadingLabel="Loading your recurring expenses..."
        errorLabel="We couldn't load your recurring expenses. Please try again."
        emptyLabel="No recurring expenses set up yet."
        emptyHint="Mark an expense as recurring from your expenses list and it will show up here."
      >
        <ul className="recurring-mgmt-list">
          {definitions.map((definition) => (
            <li key={definition.id} className={`recurring-mgmt-item recurring-mgmt-item--${definition.status}`}>
              {editingId === definition.id ? (
                <EditForm
                  definition={definition}
                  isSaving={editMutation.isPending}
                  onCancel={() => setEditingId(null)}
                  onSave={(updates) => handleSaveEdit(definition.id, definition.scheduleVersion, updates)}
                />
              ) : (
                <>
                  <div className="recurring-mgmt-item-text">
                    <div className="recurring-mgmt-item-title-row">
                      <span className="recurring-mgmt-item-name">{definition.expenseName}</span>
                      <span className={`recurring-mgmt-badge recurring-mgmt-badge--${definition.status}`}>
                        {STATUS_LABEL[definition.status] || definition.status}
                      </span>
                    </div>
                    <span className="recurring-mgmt-item-category">{definition.expenseCategory}</span>
                    <span className="recurring-mgmt-item-amount">
                      {formatMoney(definition.expenseAmount, definition.expenseAmountMinor)}
                    </span>
                    <span className="recurring-mgmt-item-meta">
                      {definition.status === "ended"
                        ? `Ended ${formatDate(definition.endedAt) || ""}`
                        : `Next due ${formatDate(definition.nextDueDate) || "—"}`}
                      {definition.endDate && definition.status !== "ended"
                        ? ` · Ends ${formatDate(definition.endDate)}`
                        : ""}
                    </span>
                  </div>

                  <div className="recurring-mgmt-item-actions">
                    {definition.status === "active" && (
                      <button
                        type="button"
                        onClick={() => handlePause(definition.id)}
                        disabled={pauseMutation.isPending}
                      >
                        Pause
                      </button>
                    )}
                    {definition.status === "paused" && (
                      <button
                        type="button"
                        onClick={() => handleResume(definition.id)}
                        disabled={resumeMutation.isPending}
                      >
                        Resume
                      </button>
                    )}
                    {definition.status !== "ended" && (
                      <button type="button" onClick={() => setEditingId(definition.id)}>
                        Edit
                      </button>
                    )}
                    {definition.status !== "ended" && (
                      <button type="button" onClick={() => setConfirmEndId(definition.id)}>
                        End
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </QueryState>

      {confirmEndDefinition && (
        <EndConfirm
          definition={confirmEndDefinition}
          onConfirm={handleEndConfirmed}
          onCancel={() => setConfirmEndId(null)}
        />
      )}
    </div>
  );
};

export default RecurringManagement;
export { formatDate, STATUS_LABEL };
