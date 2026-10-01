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
import {
  FaBolt,
  FaUtensils,
  FaShoppingCart,
  FaPlane,
  FaGamepad,
  FaMedkit,
  FaHome,
  FaCoins,
  FaGraduationCap,
  FaPause,
  FaPlay,
  FaEdit,
  FaTrashAlt,
  FaRegCalendarAlt,
} from "react-icons/fa";

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

// Maps recurring expense name and category to visual icon
const getRecurringIcon = (name = "", category = "") => {
  const combined = `${name} ${category}`.trim().toLowerCase();
  if (
    combined.includes("recharge") ||
    combined.includes("electric") ||
    combined.includes("power") ||
    combined.includes("broadband") ||
    combined.includes("wifi") ||
    combined.includes("phone") ||
    combined.includes("mobile") ||
    combined.includes("bill") ||
    combined.includes("utilit")
  ) {
    return FaBolt;
  }
  if (
    combined.includes("food") ||
    combined.includes("swiggy") ||
    combined.includes("zomato") ||
    combined.includes("dine") ||
    combined.includes("dining") ||
    combined.includes("restaurant") ||
    combined.includes("grocer") ||
    combined.includes("snack") ||
    combined.includes("eat") ||
    combined.includes("cafe")
  ) {
    return FaUtensils;
  }
  if (
    combined.includes("shop") ||
    combined.includes("mart") ||
    combined.includes("store") ||
    combined.includes("cloth") ||
    combined.includes("essential") ||
    combined.includes("supermarket") ||
    combined.includes("retail")
  ) {
    return FaShoppingCart;
  }
  if (
    combined.includes("travel") ||
    combined.includes("transport") ||
    combined.includes("flight") ||
    combined.includes("air") ||
    combined.includes("fuel") ||
    combined.includes("gas") ||
    combined.includes("petrol") ||
    combined.includes("diesel") ||
    combined.includes("cab") ||
    combined.includes("uber") ||
    combined.includes("ola") ||
    combined.includes("train") ||
    combined.includes("bus") ||
    combined.includes("metro")
  ) {
    return FaPlane;
  }
  if (
    combined.includes("entertain") ||
    combined.includes("movie") ||
    combined.includes("cinema") ||
    combined.includes("game") ||
    combined.includes("gaming") ||
    combined.includes("play") ||
    combined.includes("netflix") ||
    combined.includes("prime") ||
    combined.includes("stream") ||
    combined.includes("music") ||
    combined.includes("spotify")
  ) {
    return FaGamepad;
  }
  if (
    combined.includes("health") ||
    combined.includes("medic") ||
    combined.includes("doctor") ||
    combined.includes("hospital") ||
    combined.includes("pharm") ||
    combined.includes("fitness") ||
    combined.includes("gym")
  ) {
    return FaMedkit;
  }
  if (
    combined.includes("rent") ||
    combined.includes("hous") ||
    combined.includes("home") ||
    combined.includes("flat") ||
    combined.includes("apartment")
  ) {
    return FaHome;
  }
  if (
    combined.includes("invest") ||
    combined.includes("save") ||
    combined.includes("finance") ||
    combined.includes("bank") ||
    combined.includes("stock") ||
    combined.includes("mutual") ||
    combined.includes("crypto")
  ) {
    return FaCoins;
  }
  if (
    combined.includes("educat") ||
    combined.includes("exam") ||
    combined.includes("fee") ||
    combined.includes("study") ||
    combined.includes("book") ||
    combined.includes("course") ||
    combined.includes("tuition") ||
    combined.includes("school") ||
    combined.includes("college") ||
    combined.includes("learning")
  ) {
    return FaGraduationCap;
  }
  return FaBolt;
};

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
      <div className="recurring-mgmt-edit-grid">
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
    <section className="recurring-mgmt-page">
      <div className="recurring-mgmt-header">
        <div className="recurring-mgmt-title-wrapper">
          <span className="recurring-mgmt-accent-bar" aria-hidden="true" />
          <h2 className="recurring-mgmt-heading">Manage Recurring Expenses</h2>
        </div>
        <p className="recurring-mgmt-subheading">
          Pause, resume, end, or edit a recurring schedule. Paused schedules stop showing up as upcoming
          until resumed; ending one is permanent.
        </p>
      </div>

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
          {definitions.map((definition) => {
            const CategoryIcon = getRecurringIcon(definition.expenseName, definition.expenseCategory);
            return (
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
                    <div className="recurring-mgmt-item-main">
                      <div className="recurring-mgmt-icon-wrapper" aria-hidden="true">
                        <CategoryIcon className="recurring-mgmt-category-icon" />
                      </div>
                      <div className="recurring-mgmt-item-text">
                        <div className="recurring-mgmt-item-title-row">
                          <span className="recurring-mgmt-item-name">{definition.expenseName}</span>
                          <span className={`recurring-mgmt-badge recurring-mgmt-badge--${definition.status}`}>
                            <span className="recurring-mgmt-badge-dot" aria-hidden="true" />
                            {STATUS_LABEL[definition.status] || definition.status}
                          </span>
                        </div>
                        <span className="recurring-mgmt-item-category">{definition.expenseCategory}</span>
                        <div className="recurring-mgmt-item-meta-row">
                          <span className="recurring-mgmt-item-amount">
                            {formatMoney(definition.expenseAmount, definition.expenseAmountMinor)}
                          </span>
                          <span className="recurring-mgmt-item-divider" aria-hidden="true">|</span>
                          <span className="recurring-mgmt-item-meta">
                            <FaRegCalendarAlt className="recurring-mgmt-calendar-icon" aria-hidden="true" />
                            {definition.status === "ended"
                              ? `Ended ${formatDate(definition.endedAt) || ""}`
                              : `Next due ${formatDate(definition.nextDueDate) || "—"}`}
                            {definition.endDate && definition.status !== "ended"
                              ? ` · Ends ${formatDate(definition.endDate)}`
                              : ""}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="recurring-mgmt-item-right">
                      <div className="recurring-mgmt-actions-divider" aria-hidden="true" />
                      <div className="recurring-mgmt-item-actions">
                        {definition.status === "active" && (
                          <button
                            type="button"
                            className="recurring-mgmt-btn recurring-mgmt-btn--pause"
                            onClick={() => handlePause(definition.id)}
                            disabled={pauseMutation.isPending}
                          >
                            <FaPause className="recurring-mgmt-btn-icon" aria-hidden="true" />
                            Pause
                          </button>
                        )}
                        {definition.status === "paused" && (
                          <button
                            type="button"
                            className="recurring-mgmt-btn recurring-mgmt-btn--resume"
                            onClick={() => handleResume(definition.id)}
                            disabled={resumeMutation.isPending}
                          >
                            <FaPlay className="recurring-mgmt-btn-icon" aria-hidden="true" />
                            Resume
                          </button>
                        )}
                        {definition.status !== "ended" && (
                          <button
                            type="button"
                            className="recurring-mgmt-btn recurring-mgmt-btn--edit"
                            onClick={() => setEditingId(definition.id)}
                          >
                            <FaEdit className="recurring-mgmt-btn-icon" aria-hidden="true" />
                            Edit
                          </button>
                        )}
                        {definition.status !== "ended" && (
                          <button
                            type="button"
                            className="recurring-mgmt-btn recurring-mgmt-btn--end"
                            onClick={() => setConfirmEndId(definition.id)}
                          >
                            <FaTrashAlt className="recurring-mgmt-btn-icon" aria-hidden="true" />
                            End
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </QueryState>

      {confirmEndDefinition && (
        <EndConfirm
          definition={confirmEndDefinition}
          onConfirm={handleEndConfirmed}
          onCancel={() => setConfirmEndId(null)}
        />
      )}
    </section>
  );
};

export default RecurringManagement;
export { formatDate, STATUS_LABEL };
