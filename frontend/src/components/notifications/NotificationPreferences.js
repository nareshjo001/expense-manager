import React, { useEffect, useState } from "react";
import "../expensesHandling/AddExpense.css";
import "./NotificationPreferences.css";

import QueryState from "../common/QueryState";
import { useNotificationPreferencesQuery } from "../../hooks/queries/useNotificationPreferencesQuery";
import { useSaveNotificationPreferencesMutation } from "../../hooks/mutations/useSaveNotificationPreferencesMutation";
import {
  notificationPreferencesSaveSuccessToast,
  notificationPreferencesSaveErrorToast,
} from "../alertsEffects/toastMessages";

// NOT-003-T05 -- settings screen for per-type notification preferences and
// quiet hours.
//
// PREVIEW MODE, explained for whoever reads this next: "device" is not a
// placeholder value -- it means "keep deferring to whatever THIS BROWSER/
// APP chose at push-registration time" (App.js's existing "Notification
// Privacy" prompt, DeviceToken.notificationPreview). Choosing "Generic" or
// "Detailed" here OVERRIDES that, for this type, on every one of the
// user's devices. A user who wants their phone to show details but their
// work laptop to stay generic should leave preview on "Device" here and
// keep using that prompt's per-device toggle instead -- this screen cannot
// express "different per device" for a single type, because a preference
// here is account-wide by design (see notificationPreferenceService.js).
const PREVIEW_LABEL = {
  device: "Match this device's setting",
  generic: "Always generic (hide details)",
  detailed: "Always detailed",
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

  // Seeds editable local state from the server response the first time it
  // arrives, and again after every successful save (the mutation
  // invalidates the query, which refetches) -- but never overwrites
  // in-progress edits on an incidental background refetch in between.
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
      // An empty string means "use the app default" -- sent as null so the
      // backend's own resolveTimeZone(null) picks that up rather than
      // rejecting an empty string as an invalid IANA zone.
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
      <h2 className="notification-prefs-heading">Notification Preferences</h2>
      <p className="notification-prefs-subheading">
        Choose which notifications you receive, how much detail they show, and when to stay quiet.
      </p>

      <QueryState
        isLoading={preferencesQuery.isLoading}
        isError={preferencesQuery.isError}
        isEmpty={false}
        onRetry={preferencesQuery.refetch}
        loadingLabel="Loading your notification preferences..."
        errorLabel="We couldn't load your notification preferences. Please try again."
      >
        <section className="notification-prefs-section">
          <h3>By type</h3>
          {typeKeys.length === 0 && (
            <p className="notification-prefs-muted">No notification types are registered yet.</p>
          )}
          <ul className="notification-prefs-type-list">
            {typeKeys.map((type) => {
              const pref = local.types[type] || { enabled: true, preview: "device" };
              const meta = typeMeta[type] || {};
              return (
                <li key={type} className="notification-prefs-type-item">
                  <div className="notification-prefs-type-header">
                    <label className="notification-prefs-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(pref.enabled)}
                        onChange={() => handleToggleEnabled(type)}
                      />
                      <span>{meta.label || type}</span>
                    </label>
                  </div>
                  {meta.description && (
                    <p className="notification-prefs-type-description">{meta.description}</p>
                  )}
                  <label className="notification-prefs-preview-select">
                    Preview
                    <select
                      value={pref.preview || "device"}
                      disabled={!pref.enabled}
                      onChange={(e) => handlePreviewChange(type, e.target.value)}
                    >
                      {Object.entries(PREVIEW_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="notification-prefs-section">
          <h3>Quiet hours</h3>
          <label className="notification-prefs-toggle">
            <input
              type="checkbox"
              checked={local.quietHours.enabled}
              onChange={(e) => handleQuietHoursField("enabled", e.target.checked)}
            />
            <span>Don't send notifications during quiet hours</span>
          </label>

          {local.quietHours.enabled && (
            <div className="notification-prefs-quiet-fields">
              <label>
                Start
                <input
                  type="time"
                  value={local.quietHours.start}
                  onChange={(e) => handleQuietHoursField("start", e.target.value)}
                />
              </label>
              <label>
                End
                <input
                  type="time"
                  value={local.quietHours.end}
                  onChange={(e) => handleQuietHoursField("end", e.target.value)}
                />
              </label>
              <label>
                Time zone
                <input
                  type="text"
                  placeholder="e.g. Asia/Kolkata (blank = app default)"
                  value={local.quietHours.timeZone}
                  onChange={(e) => handleQuietHoursField("timeZone", e.target.value)}
                />
              </label>
              <p className="notification-prefs-hint">
                A notification withheld during quiet hours is not sent later -- it is simply skipped
                for that occurrence. You'll still see it reflected in your expenses either way.
              </p>
            </div>
          )}
        </section>

        <button
          type="button"
          className="notification-prefs-save"
          onClick={handleSave}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </button>
      </QueryState>
    </div>
  );
};

export default NotificationPreferences;
