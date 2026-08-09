import { useMutation } from "@tanstack/react-query";
import { askSia } from "../../api/siaApi";
import { useSiaAskMutation } from "./useSiaAskMutation";

// Both TanStack Query's useMutation and the askSia API function are mocked
// here -- never the network. No real HTTP request, QueryClient, or cache is
// ever involved in this test file.
jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
}));

jest.mock("../../api/siaApi", () => ({
  askSia: jest.fn(),
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

describe("frontend/src/hooks/mutations/useSiaAskMutation", () => {
  it("calls useMutation exactly once with mutationFn set to the exact imported askSia function", () => {
    useMutation.mockReturnValue({});

    useSiaAskMutation();

    expect(useMutation).toHaveBeenCalledTimes(1);
    expect(useMutation).toHaveBeenCalledWith({ mutationFn: askSia, retry: 0 });
  });

  it("configures only mutationFn and an explicit retry:0 -- no mutation key or callbacks", () => {
    useMutation.mockReturnValue({});

    useSiaAskMutation();

    const optionsArg = useMutation.mock.calls[0][0];
    expect(Object.keys(optionsArg).sort()).toEqual(["mutationFn", "retry"]);
  });

  it("disables automatic retries so the same clientMessageId is never resent behind the UI's back", () => {
    useMutation.mockReturnValue({});

    useSiaAskMutation();

    expect(useMutation.mock.calls[0][0].retry).toBe(0);
  });

  it("returns the exact object returned by useMutation, unchanged", () => {
    const fakeMutationObject = {
      data: undefined,
      error: null,
      isPending: false,
      mutate: jest.fn(),
      mutateAsync: jest.fn(),
      reset: jest.fn(),
    };
    useMutation.mockReturnValue(fakeMutationObject);

    const result = useSiaAskMutation();

    expect(result).toBe(fakeMutationObject);
  });

  it("invoking the configured mutationFn passes the request payload unchanged to askSia", async () => {
    let capturedOptions;
    useMutation.mockImplementation((options) => {
      capturedOptions = options;
      return {};
    });
    askSia.mockResolvedValue(GROUNDED_RESPONSE);

    const payload = {
      question: "Why did my spending change?",
      sessionId: "64f1a2b3c4d5e6f7a8b9c0d1",
      clientMessageId: "key-1",
    };

    useSiaAskMutation();
    await capturedOptions.mutationFn(payload);

    expect(askSia).toHaveBeenCalledTimes(1);
    expect(askSia).toHaveBeenCalledWith(payload);
  });

  it("the hook itself never generates a clientMessageId -- that belongs to the conversation state", async () => {
    let capturedOptions;
    useMutation.mockImplementation((options) => {
      capturedOptions = options;
      return {};
    });
    askSia.mockResolvedValue(GROUNDED_RESPONSE);

    useSiaAskMutation();
    await capturedOptions.mutationFn({ question: "Q" });

    expect(askSia).toHaveBeenCalledWith({ question: "Q" });
  });

  it("resolves with the exact API response returned by askSia, unchanged", async () => {
    let capturedOptions;
    useMutation.mockImplementation((options) => {
      capturedOptions = options;
      return {};
    });
    askSia.mockResolvedValue(GROUNDED_RESPONSE);

    useSiaAskMutation();
    const result = await capturedOptions.mutationFn("Why did my spending change?");

    expect(result).toBe(GROUNDED_RESPONSE);
  });

  it("propagates a rejected askSia error as the same error object", async () => {
    let capturedOptions;
    useMutation.mockImplementation((options) => {
      capturedOptions = options;
      return {};
    });
    const apiError = new Error("Request failed with status code 503");
    askSia.mockRejectedValue(apiError);

    useSiaAskMutation();

    await expect(capturedOptions.mutationFn("Why did my spending change?")).rejects.toBe(apiError);
  });

  it("never performs a real network call -- askSia is fully mocked", async () => {
    let capturedOptions;
    useMutation.mockImplementation((options) => {
      capturedOptions = options;
      return {};
    });
    askSia.mockResolvedValue(GROUNDED_RESPONSE);

    useSiaAskMutation();
    await capturedOptions.mutationFn("q");

    expect(jest.isMockFunction(askSia)).toBe(true);
    expect(askSia).toHaveBeenCalledTimes(1);
  });
});
