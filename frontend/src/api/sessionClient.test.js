import { clearAccessToken, getAccessToken, getCsrfToken, refreshAccessToken, setAccessToken } from "./sessionClient";

beforeEach(() => {
  clearAccessToken();
  document.cookie = "balensia_csrf=; Max-Age=0; path=/";
  process.env.REACT_APP_BACKEND_URL = "/backend";
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("keeps access tokens in memory only", () => {
  setAccessToken("short-lived-token");
  expect(getAccessToken()).toBe("short-lived-token");
  expect(localStorage.getItem("token")).toBeNull();
  clearAccessToken();
  expect(getAccessToken()).toBeNull();
});

test("refreshes with the CSRF cookie/header pair and stores the new access token in memory", async () => {
  document.cookie = "balensia_csrf=csrf-value; path=/";
  global.fetch.mockResolvedValue({ ok: true, json: async () => ({ token: "renewed-token" }) });

  const result = await refreshAccessToken();

  expect(result.token).toBe("renewed-token");
  expect(getAccessToken()).toBe("renewed-token");
  expect(getCsrfToken()).toBe("csrf-value");
  expect(global.fetch).toHaveBeenCalledWith("/backend/auth/refresh", expect.objectContaining({
    credentials: "include",
    headers: expect.objectContaining({ "X-CSRF-Token": "csrf-value" }),
  }));
});
