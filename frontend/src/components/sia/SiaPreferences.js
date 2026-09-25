import React, { useState } from "react";
import "../expensesHandling/AddExpense.css";
import "./SiaPreferences.css";

import QueryState from "../common/QueryState";
import DeleteAlert from "../alertsEffects/DeleteAlert";
import { useSiaPreferenceQuery } from "../../hooks/queries/useSiaPreferenceQuery";
import { useSaveSiaPreferenceMutation } from "../../hooks/mutations/useSaveSiaPreferenceMutation";
import { useDeleteSiaHistoryMutation } from "../../hooks/mutations/useDeleteSiaHistoryMutation";
import {
  siaPreferenceSaveSuccessToast,
  siaPreferenceSaveErrorToast,
  siaHistoryDeleteSuccessToast,
  siaHistoryDeleteErrorToast,
} from "../alertsEffects/toastMessages";

// SIA-001-T06 -- settings page for the assistant's per-user enable/disable
// toggle and "delete my SIA history" control, matching
// NotificationPreferences.js's own page-shell pattern (QueryState wrapper,
// a TanStack Query hook plus a mutation hook, no separate local-state
// seeding needed here since there's exactly one boolean field to reflect,
// not a multi-field form to stage edits for before saving).
//
// SIA is ON by default (opt-OUT, not opt-in, per siaPreferenceService.js's
// own contract) -- a user who never opens this page keeps using SIA
// exactly as before this task shipped.
const SiaPreferences = () => {
  const preferenceQuery = useSiaPreferenceQuery();
  const saveMutation = useSaveSiaPreferenceMutation();
  const deleteHistoryMutation = useDeleteSiaHistoryMutation();

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const enabled = preferenceQuery.data?.data?.enabled !== false;

  const handleToggle = () => {
    const nextEnabled = !enabled;
    saveMutation.mutate(nextEnabled, {
      onSuccess: () => siaPreferenceSaveSuccessToast(nextEnabled),
      onError: (error) => siaPreferenceSaveErrorToast(error.response?.data),
    });
  };

  const handleConfirmDeleteHistory = () => {
    setConfirmingDelete(false);
    deleteHistoryMutation.mutate(undefined, {
      onSuccess: () => siaHistoryDeleteSuccessToast(),
      onError: (error) => siaHistoryDeleteErrorToast(error.response?.data),
    });
  };

  return (
    <div className="add-page sia-prefs-page">
      <h2 className="sia-prefs-heading">SIA Settings</h2>
      <p className="sia-prefs-subheading">
        Control whether the assistant can answer your questions, and manage the conversation
        history it keeps.
      </p>

      <QueryState
        isLoading={preferenceQuery.isLoading}
        isError={preferenceQuery.isError}
        isEmpty={false}
        onRetry={preferenceQuery.refetch}
        loadingLabel="Loading your SIA settings..."
        errorLabel="We couldn't load your SIA settings. Please try again."
      >
        <section className="sia-prefs-section">
          <h3>Assistant</h3>
          <label className="sia-prefs-toggle">
            <input
              type="checkbox"
              checked={enabled}
              disabled={saveMutation.isPending}
              onChange={handleToggle}
            />
            <span>{enabled ? "SIA is on" : "SIA is off"}</span>
          </label>
          <p className="sia-prefs-hint">
            When SIA is off, it won't answer questions about your finances. Your existing
            conversation history is kept until you delete it below, and turning SIA back on
            doesn't lose anything.
          </p>
        </section>

        <section className="sia-prefs-section">
          <h3>Conversation history</h3>
          <p className="sia-prefs-hint">
            This deletes every SIA conversation you've had -- separate from deleting your whole
            account. It doesn't change whether SIA is on or off.
          </p>
          <button
            type="button"
            className="sia-prefs-delete-history"
            onClick={() => setConfirmingDelete(true)}
            disabled={deleteHistoryMutation.isPending}
          >
            {deleteHistoryMutation.isPending ? "Deleting..." : "Delete my SIA history"}
          </button>
        </section>
      </QueryState>

      {confirmingDelete && (
        <DeleteAlert
          confirmDeleteId="sia-history"
          confirmDeleteHandler={handleConfirmDeleteHistory}
          cancelDeleteHandler={() => setConfirmingDelete(false)}
          message="Delete your entire SIA conversation history? This can't be undone."
        />
      )}
    </div>
  );
};

export default SiaPreferences;
