import api from "./axios";
import { askSia } from "./siaApi";

// The shared axios instance (frontend/src/api/axios.js) is mocked here, not
// the network -- no real HTTP request, backend, or token/localStorage
// interceptor logic is ever exercised by this test file. Only api.post is
// given a mock implementation, matching askSia's actual usage.
jest.mock("./axios", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const GROUNDED_RESPONSE = {
  success: true,
  answer: "Your spending increased mainly in food.",
  intent: "spending_change",
  basedOn: ["spending.monthComparison"],
};

afterEach(() => {
  jest.clearAllMocks();
});

describe("frontend/src/api/siaApi askSia", () => {
  it("calls the shared axios instance's post exactly once with /sia/ask and { question }", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    await askSia("Why did my spending change?");

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/sia/ask", { question: "Why did my spending change?" });
  });

  it("returns the exact response.data object unchanged, without normalization or cloning", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    const result = await askSia("Why did my spending change?");

    expect(result).toBe(GROUNDED_RESPONSE);
  });

  it("propagates a rejected axios error unchanged", async () => {
    const axiosError = new Error("Request failed with status code 503");
    axiosError.response = {
      status: 503,
      data: { success: false, message: "SIA is temporarily unavailable." },
    };
    api.post.mockRejectedValue(axiosError);

    await expect(askSia("Why did my spending change?")).rejects.toBe(axiosError);
  });

  it("never performs a real network call -- the shared axios instance is fully mocked", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    await askSia("Why did my spending change?");

    expect(jest.isMockFunction(api.post)).toBe(true);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
