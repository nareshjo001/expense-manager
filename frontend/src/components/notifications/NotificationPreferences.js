import React, { useEffect, useState } from "react";
import {
  FaBell,
  FaMoon,
  FaSyncAlt,
  FaRegPauseCircle,
  FaChartPie,
  FaChevronDown,
} from "react-icons/fa";
import "../expensesHandling/AddExpense.css";
import "./NotificationPreferences.css";

import QueryState from "../common/QueryState";
import { useNotificationPreferencesQuery } from "../../hooks/queries/useNotificationPreferencesQuery";
import { useSaveNotificationPreferencesMutation } from "../../hooks/mutations/useSaveNotificationPreferencesMutation";
import {
  notificationPreferencesSaveSuccessToast,
  notificationPreferencesSaveErrorToast,
} from "../alertsEffects/toastMessages";

const PREVIEW_LABEL = {
  device: "Match this device",
  generic: "Always generic (hide details)",
  detailed: "Always detailed",
};

const getTypeIcon = (type = "") => {
  switch (type) {
    case "recurring-expense":
      return FaSyncAlt;
    case "recurring-expense-ended":
      return FaRegPauseCircle;
    case "category-budget-alert":
      return FaChartPie;
    default:
      return FaBell;
  }
};

function emptyLocalState() {
  return { types: {}, quietHours: { enabled: false, start: "22:00", end: "07:00", timeZone: "" } };
}

const NotificationPreferences = () => {
  const preferencesQuery = useNotificationPreferencesQuery();
  const saveMutation = useSaveNotificationPreferencesMutation();

  const [local, setLocal] = useState(emptyLocalState());
  const [loadedOnce, setLoadedOnce] = useState(false);

  const payload = preferencesQuery.data?.data;

  useEffect(() => {
    if (!payload || loadedOnce) return;
    setLocal({
      types: payload.types || {},
      quietHours: {
        enabled: Boolean(payload.quietHours?.enabled),
        start: payload.quietHours?.start || "22:00",
        end: payload.quietHours?.end || "07:00",
        timeZone: payload.quietHours?.timeZone || "",
      },
    });
    setLoadedOnce(true);
  }, [payload, loadedOnce]);

  const typeMeta = payload?.typeMeta || {};
  const typeKeys = Object.keys(local.types);

  const handleToggleEnabled = (type) => {
    setLocal((prev) => ({
      ...prev,
      types: {
        ...prev.types,
        [type]: { ...prev.types[type], enabled: !prev.types[type]?.enabled },
      },
    }));
  };

  const handlePreviewChange = (type, preview) => {
    setLocal((prev) => ({
      ...prev,
      types: { ...prev.types, [type]: { ...prev.types[type], preview } },
    }));
  };

  const handleQuietHoursField = (field, value) => {
    setLocal((prev) => ({ ...prev, quietHours: { ...prev.quietHours, [field]: value } }));
  };

  const handleSave = () => {
    const quietHours = {
      enabled: local.quietHours.enabled,
      start: local.quietHours.start,
      end: local.quietHours.end,
      timeZone: local.quietHours.timeZone.trim() === "" ? null : local.quietHours.timeZone.trim(),
    };

    saveMutation.mutate(
      { types: local.types, quietHours },
      {
        onSuccess: () => notificationPreferencesSaveSuccessToast(),
        onError: (error) => notificationPreferencesSaveErrorToast(error.response?.data),
      }
    );
  };

  return (
    <div className="add-page notification-prefs-page">
      <QueryState
        isLoading={preferencesQuery.isLoading}
        isError={preferencesQuery.isError}
        isEmpty={false}
        onRetry={preferencesQuery.refetch}
        loadingLabel="Loading your notification preferences..."
        errorLabel="We couldn't load your notification preferences. Please try again."
      >
        <section className="notification-prefs-card">
          <div className="notification-prefs-header">
            <div className="notification-prefs-badge" aria-hidden="true">
              <FaBell className="notification-prefs-badge-icon" />
            </div>
            <div className="notification-prefs-header-text">
              <div className="notification-prefs-title-wrapper">
                <span className="notification-prefs-accent-bar" aria-hidden="true" />
                <h2 className="notification-prefs-heading">Notification Preferences</h2>
              </div>
              <p className="notification-prefs-subheading">
                Choose which notifications you receive, how much detail they show, and when to stay quiet.
              </p>
            </div>
          </div>

          {typeKeys.length === 0 && (
            <p className="notification-prefs-muted">No notification types are registered yet.</p>
          )}

          <ul className="notification-prefs-type-list">
            {typeKeys.map((type) => {
              const pref = local.types[type] || { enabled: true, preview: "device" };
              const meta = typeMeta[type] || {};
              const TypeIcon = getTypeIcon(type);
              const toggleId = `toggle-${type}`;
              const previewId = `preview-${type}`;

              return (
                <li key={type} className="notification-prefs-type-item">
                  <div className="notification-prefs-type-left">
                    <input
                      type="checkbox"
                      id={toggleId}
                      className="notification-prefs-checkbox"
                      checked={Boolean(pref.enabled)}
                      onChange={() => handleToggleEnabled(type)}
                      aria-label={meta.label || type}
                    />
                    <div className="notification-prefs-type-icon-badge" aria-hidden="true">
                      <TypeIcon />
                    </div>
                    <label htmlFor={toggleId} className="notification-prefs-type-info">
                      <span className="notification-prefs-type-title">{meta.label || type}</span>
                      {meta.description && (
                        <p className="notification-prefs-type-description">{meta.description}</p>
                      )}
                    </label>
                  </div>

                  <div className="notification-prefs-preview-control">
                    <label htmlFor={previewId} className="notification-prefs-preview-label">
                      Preview
                    </label>
                    <div className="notification-prefs-select-wrapper">
                      <select
                        id={previewId}
                        value={pref.preview || "device"}
                        disabled={!pref.enabled}
                        onChange={(e) => handlePreviewChange(type, e.target.value)}
                        className="notification-prefs-preview-select"
                      >
                        {Object.entries(PREVIEW_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <FaChevronDown className="notification-prefs-select-arrow" aria-hidden="true" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="notification-prefs-card notification-prefs-quiet-card">
          <div className="notification-prefs-quiet-box">
            <div className="notification-prefs-quiet-header">
              <div className="notification-prefs-quiet-left">
                <div className="notification-prefs-badge" aria-hidden="true">
                  <FaMoon className="notification-prefs-badge-icon" />
                </div>
                <div className="notification-prefs-quiet-text">
                  <h3 className="notification-prefs-quiet-heading">Quiet hours</h3>
                  <label className="notification-prefs-toggle" htmlFor="quiet-hours-toggle">
                    <input
                      type="checkbox"
                      id="quiet-hours-toggle"
                      className="notification-prefs-checkbox notification-prefs-quiet-checkbox"
                      checked={local.quietHours.enabled}
                      onChange={(e) => handleQuietHoursField("enabled", e.target.checked)}
                      aria-label="Don't send notifications during quiet hours"
                    />
                    <span>Don't send notifications during quiet hours</span>
                  </label>
                </div>
              </div>
            </div>

            {local.quietHours.enabled && (
              <div className="notification-prefs-quiet-fields">
                <div className="notification-prefs-quiet-inputs-row">
                  <label className="notification-prefs-field">
                    <span>Start</span>
                    <input
                      type="time"
                      value={local.quietHours.start}
                      onChange={(e) => handleQuietHoursField("start", e.target.value)}
                    />
                  </label>
                  <label className="notification-prefs-field">
                    <span>End</span>
                    <input
                      type="time"
                      value={local.quietHours.end}
                      onChange={(e) => handleQuietHoursField("end", e.target.value)}
                    />
                  </label>
                  <label className="notification-prefs-field notification-prefs-field--tz">
                    <span>Time zone</span>
                    <input
                      type="text"
                      placeholder="e.g. Asia/Kolkata (blank = app default)"
                      value={local.quietHours.timeZone}
                      onChange={(e) => handleQuietHoursField("timeZone", e.target.value)}
                    />
                  </label>
                </div>
                <p className="notification-prefs-hint">
                  A notification withheld during quiet hours is not sent later -- it is simply skipped
                  for that occurrence. You'll still see it reflected in your expenses either way.
                </p>
              </div>
            )}
          </div>

          <div className="notification-prefs-save-wrapper">
            <button
              type="button"
              className="notification-prefs-save"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save changes"}
            </button>
          </div>
        </section>
      </QueryState>
    </div>
  );
};

export default NotificationPreferences;
