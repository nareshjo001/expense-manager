import { expenseAddErrorToast } from "../components/alertsEffects/toastMessages";
import { queryClient } from "../query/queryClient";
import { clearAccessToken } from "./sessionClient";

// Centralized handling for expired sessions and shared HTTP error statuses (401/429/409).

// Clears the session and returns to the auth screen, mirroring LandingPage.js's manual logout.
export const forceReauth = () => {
  clearAccessToken();
  // Clears authenticated server state before a new session can begin.
  queryClient.clear();
  window.location.replace("/");
};

// Returns true if the status was handled here (caller should stop), false if the caller should handle it itself.
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
