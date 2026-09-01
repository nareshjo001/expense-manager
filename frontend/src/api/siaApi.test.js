import api from "./axios";
import { askSia } from "./siaApi";

// The shared axios instance (frontend/src/api/axios.js) is mocked here, not
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

    await askSia({ question: "Why did my spending change?" });

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith("/sia/ask", { question: "Why did my spending change?" });
  });

  it("forwards sessionId and clientMessageId when supplied", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    await askSia({
      question: "Why did my spending change?",
      sessionId: "64f1a2b3c4d5e6f7a8b9c0d1",
      clientMessageId: "key-123",
    });

    expect(api.post).toHaveBeenCalledWith("/sia/ask", {
      question: "Why did my spending change?",
      sessionId: "64f1a2b3c4d5e6f7a8b9c0d1",
      clientMessageId: "key-123",
    });
  });

  it("omits absent optional fields entirely rather than sending undefined", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    await askSia({ question: "Q", sessionId: null, clientMessageId: undefined });

    const [, payload] = api.post.mock.calls[0];
    expect(Object.keys(payload)).toEqual(["question"]);
  });

  it("returns the exact response.data object unchanged, without normalization or cloning", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    const result = await askSia({ question: "Why did my spending change?" });

    expect(result).toBe(GROUNDED_RESPONSE);
  });

  it("propagates a rejected axios error unchanged", async () => {
    const axiosError = new Error("Request failed with status code 503");
    axiosError.response = {
      status: 503,
      data: { success: false, message: "SIA is temporarily unavailable." },
    };
    api.post.mockRejectedValue(axiosError);

    await expect(askSia({ question: "Why did my spending change?" })).rejects.toBe(axiosError);
  });

  it("never performs a real network call -- the shared axios instance is fully mocked", async () => {
    api.post.mockResolvedValue({ data: GROUNDED_RESPONSE });

    await askSia({ question: "Why did my spending change?" });

    expect(jest.isMockFunction(api.post)).toBe(true);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});
