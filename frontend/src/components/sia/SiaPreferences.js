import React, { useState } from "react";
import {
  HiSparkles,
  HiOutlineChatBubbleOvalLeft,
  HiOutlineTrash,
  HiOutlineInformationCircle,
} from "react-icons/hi2";
import { FaRobot } from "react-icons/fa";
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
      <div className="sia-prefs-card">
        <div className="sia-prefs-header">
          <div className="sia-prefs-header-badge" aria-hidden="true">
            <HiSparkles className="sia-prefs-header-badge-icon" />
          </div>
          <div className="sia-prefs-header-text">
            <div className="sia-prefs-title-wrapper">
              <span className="sia-prefs-accent-bar" aria-hidden="true" />
              <h2 className="sia-prefs-heading">SIA Settings</h2>
            </div>
            <p className="sia-prefs-subheading">
              Control whether the assistant can answer your questions, and manage the conversation
              history it keeps.
            </p>
          </div>
        </div>

        <QueryState
          isLoading={preferenceQuery.isLoading}
          isError={preferenceQuery.isError}
          isEmpty={false}
          onRetry={preferenceQuery.refetch}
          loadingLabel="Loading your SIA settings..."
          errorLabel="We couldn't load your SIA settings. Please try again."
        >
          <div className="sia-prefs-content">
            <section className="sia-prefs-section sia-prefs-section--assistant">
              <div className="sia-prefs-section-header">
                <div className="sia-prefs-section-header-left">
                  <div className="sia-prefs-item-badge" aria-hidden="true">
                    <FaRobot className="sia-prefs-item-badge-icon" />
                  </div>
                  <h3 className="sia-prefs-item-title">Assistant</h3>
                </div>
                <label className="sia-prefs-toggle" htmlFor="sia-assistant-toggle">
                  <input
                    type="checkbox"
                    id="sia-assistant-toggle"
                    className="sia-prefs-toggle-input"
                    checked={enabled}
                    disabled={saveMutation.isPending}
                    onChange={handleToggle}
                    aria-label="Toggle SIA assistant"
                  />
                  <span className="sia-prefs-toggle-switch" aria-hidden="true">
                    <span className="sia-prefs-toggle-knob" />
                  </span>
                  <span className="sia-prefs-toggle-text">{enabled ? "SIA is on" : "SIA is off"}</span>
                </label>
              </div>

              <div className="sia-prefs-item-body">
                <p className="sia-prefs-hint">
                  When SIA is off, it won't answer questions about your finances. Your existing
                  conversation history is kept until you delete it below.
                </p>
                <div className="sia-prefs-callout">
                  <HiOutlineInformationCircle className="sia-prefs-callout-icon" aria-hidden="true" />
                  <span>Turning SIA back on doesn't lose anything.</span>
                </div>
              </div>
            </section>

            <section className="sia-prefs-section sia-prefs-section--history">
              <div className="sia-prefs-section-header">
                <div className="sia-prefs-section-header-left">
                  <div className="sia-prefs-item-badge" aria-hidden="true">
                    <HiOutlineChatBubbleOvalLeft className="sia-prefs-item-badge-icon" />
                  </div>
                  <h3 className="sia-prefs-item-title">Conversation History</h3>
                </div>
              </div>

              <div className="sia-prefs-item-body">
                <p className="sia-prefs-hint">
                  This deletes every SIA conversation you've had — separate from deleting your whole
                  account. It doesn't change whether SIA is on or off.
                </p>
              </div>

              <div className="sia-prefs-item-actions">
                <button
                  type="button"
                  className="sia-prefs-delete-history"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={deleteHistoryMutation.isPending}
                >
                  <HiOutlineTrash className="sia-prefs-delete-icon" aria-hidden="true" />
                  <span>{deleteHistoryMutation.isPending ? "Deleting..." : "Delete my SIA history"}</span>
                </button>
              </div>
            </section>
          </div>
        </QueryState>
      </div>

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
