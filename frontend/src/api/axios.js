import axios from "axios";
import { handleApiError } from "./handleApiError";
import { getAccessToken, refreshAccessToken } from "./sessionClient";

// Shared axios instance: attaches the auth token and centralizes 401/429/409 handling for every API call.
const api = axios.create({
  baseURL: process.env.REACT_APP_BACKEND_URL,
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
});

api.interceptors.request.use(
  (config) => {
    const token = getAccessToken();

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Routes every non-2xx response through handleApiError once, then re-rejects so callers' own handling still runs.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest?._sessionRetry && await refreshAccessToken()) {
      originalRequest._sessionRetry = true;
      return api(originalRequest);
    }
    if (error.response) {
      // BUD-001-T05 -- a request may opt out of the generic 409 toast when its
      // caller renders its own, more specific conflict message inline (e.g.
      // "this would exceed your monthly budget"), so the user doesn't get both.
      // 401/429 handling is unaffected.
      handleApiError(
        error.response,
        originalRequest?.suppressConflictToast ? { onConflict: () => {} } : undefined
      );
    }

    return Promise.reject(error);
  }
);

export default api;
