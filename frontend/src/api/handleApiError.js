import { expenseAddErrorToast } from "../components/alertsEffects/toastMessages";

// Session teardown for an expired/invalid token. Mirrors the existing logout
// in LandingPage.js (localStorage.clear()), then sends the user back through
// the normal auth screen by reloading the app shell.
export const forceReauth = () => {
  localStorage.clear();
  window.location.replace("/");
};

/**
 * Handles the response statuses introduced by the backend remediation.
 *
 * Returns true if the status was handled here (caller should stop), false if
 * the caller should continue with its own handling.
 *
 * Deliberately shows fixed UI copy rather than the raw backend message, so
 * server wording is never surfaced to users in places that didn't already
 * do so.
 */
export const handleApiError = (response, { onConflict } = {}) => {
  // Expired or invalid JWT — route back through the existing auth flow.
  if (response.status === 401) {
    forceReauth();
    return true;
  }

  // Rate limited. Never retry automatically; tell the user to wait.
  if (response.status === 429) {
    expenseAddErrorToast({
      message: "Too many requests. Please wait a moment and try again.",
    });
    return true;
  }

  // Conflict (currently only device-token already claimed by another account).
  // Callers pass onConflict when they want silent, non-retrying handling.
  if (response.status === 409) {
    if (onConflict) {
      onConflict();
    } else {
      expenseAddErrorToast({
        message: "This action conflicts with existing data.",
      });
    }
    return true;
  }

  return false;
};
