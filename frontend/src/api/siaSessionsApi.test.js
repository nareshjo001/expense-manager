import api from "./axios";
import { getSiaSessions, getSiaSessionMessages, deleteSiaSession } from "./siaSessionsApi";

// The shared axios instance is mocked -- no real network, token, or
// interceptor behaviour is exercised here.
jest.mock("./axios", () => ({
  __esModule: true,
  default: { get: jest.fn(), delete: jest.fn() },
}));

afterEach(() => {
  jest.clearAllMocks();
});

describe("frontend/src/api/siaSessionsApi", () => {
  it("getSiaSessions calls GET /sia/sessions and forwards the abort signal", async () => {
    const payload = { success: true, sessions: [] };
    api.get.mockResolvedValue({ data: payload });
    const signal = new AbortController().signal;

    const result = await getSiaSessions(signal);

    expect(api.get).toHaveBeenCalledWith("/sia/sessions", { signal });
    expect(result).toBe(payload);
  });

  it("getSiaSessionMessages builds the exact per-session messages path", async () => {
    api.get.mockResolvedValue({ data: { success: true, messages: [] } });
    const signal = new AbortController().signal;

    await getSiaSessionMessages("64f1a2b3c4d5e6f7a8b9c0d1", signal);

    expect(api.get).toHaveBeenCalledWith("/sia/sessions/64f1a2b3c4d5e6f7a8b9c0d1/messages", { signal });
  });

  it("encodes the session id so an unexpected value cannot alter the path", async () => {
    api.get.mockResolvedValue({ data: { success: true, messages: [] } });

    await getSiaSessionMessages("a/../b");

    expect(api.get).toHaveBeenCalledWith("/sia/sessions/a%2F..%2Fb/messages", { signal: undefined });
  });

  it("deleteSiaSession calls DELETE on the exact session path", async () => {
    const payload = { success: true, message: "Session deleted." };
    api.delete.mockResolvedValue({ data: payload });

    const result = await deleteSiaSession("64f1a2b3c4d5e6f7a8b9c0d1");

    expect(api.delete).toHaveBeenCalledWith("/sia/sessions/64f1a2b3c4d5e6f7a8b9c0d1");
    expect(result).toBe(payload);
  });

  it("propagates errors unchanged", async () => {
    const error = new Error("boom");
    error.response = { status: 404, data: { success: false, message: "Session not found." } };
    api.get.mockRejectedValue(error);

    await expect(getSiaSessions()).rejects.toBe(error);
  });
});
