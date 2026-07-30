import axios from "axios";
import { handleApiError } from "./handleApiError";

// Shared axios instance: attaches the auth token and centralizes 401/429/409 handling for every API call.
const api = axios.create({
  baseURL: process.env.REACT_APP_BACKEND_URL,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");

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
  (error) => {
    if (error.response) {
      handleApiError(error.response);
    }

    return Promise.reject(error);
  }
);

export default api;