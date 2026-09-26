// BUD-001-T05 -- a request can opt out of the shared interceptor's generic
// 409 toast (suppressConflictToast) when its caller renders a specific
// conflict message itself. Default behavior (no flag) must be unchanged.
import api from "./axios";
import { handleApiError } from "./handleApiError";

// axios ships an ESM root that CRA's Jest (no transform for node_modules)
// can't parse; pin this test to axios's own prebuilt CJS bundle. (FE-003-T03
// proposes the same mapping repo-wide in package.json's jest.moduleNameMapper,
// but that change isn't on main yet.)
jest.mock("axios", () => jest.requireActual("axios/dist/browser/axios.cjs"));
jest.mock("./handleApiError", () => ({ handleApiError: jest.fn() }));
jest.mock("./sessionClient", () => ({
  getAccessToken: jest.fn(() => null),
  refreshAccessToken: jest.fn(async () => false),
}));

function rejectWith(status) {
  api.defaults.adapter = (config) =>
    Promise.reject(Object.assign(new Error(`HTTP ${status}`), { config, response: { status, config } }));
}

afterEach(() => {
  jest.clearAllMocks();
});

test("without the flag, a 409 goes through the default handling (no options)", async () => {
  rejectWith(409);
  await expect(api.put("/api/anything", {})).rejects.toThrow("HTTP 409");
  expect(handleApiError).toHaveBeenCalledTimes(1);
  expect(handleApiError.mock.calls[0][0].status).toBe(409);
  expect(handleApiError.mock.calls[0][1]).toBeUndefined();
});

test("with suppressConflictToast, a silent onConflict is passed so no generic toast is shown", async () => {
  rejectWith(409);
  await expect(api.put("/api/category-budgets", {}, { suppressConflictToast: true })).rejects.toThrow("HTTP 409");
  expect(handleApiError).toHaveBeenCalledTimes(1);
  expect(handleApiError.mock.calls[0][1]).toEqual({ onConflict: expect.any(Function) });
});

test("the error still rejects to the caller so it can render its own message", async () => {
  rejectWith(409);
  const error = await api.put("/api/category-budgets", {}, { suppressConflictToast: true }).catch((e) => e);
  expect(error.response.status).toBe(409);
});
