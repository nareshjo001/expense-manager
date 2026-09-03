let accessToken = null;
let refreshPromise = null;

const sessionUrl = (path) => `${process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "") || ""}/auth${path}`;

export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => {
  accessToken = token || null;
};
export const clearAccessToken = () => {
  accessToken = null;
};

export const getCsrfToken = () => {
  const entry = document.cookie.split("; ").find((item) => item.startsWith("balensia_csrf="));
  return entry ? decodeURIComponent(entry.split("=").slice(1).join("=")) : null;
};

export const refreshAccessToken = async () => {
  if (refreshPromise) return refreshPromise;
  const csrfToken = getCsrfToken();
  if (!csrfToken || !process.env.REACT_APP_BACKEND_URL) return null;
  refreshPromise = fetch(sessionUrl("/refresh"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json();
      setAccessToken(data.token);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};

export const logoutSession = async () => {
  const csrfToken = getCsrfToken();
  try {
    if (csrfToken && process.env.REACT_APP_BACKEND_URL) {
      await fetch(sessionUrl("/logout"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      });
    }
  } finally {
    clearAccessToken();
  }
};
