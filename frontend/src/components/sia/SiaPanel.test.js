import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { useSiaAskMutation } from "../../hooks/mutations/useSiaAskMutation";
import SiaPanel from "./SiaPanel";

// useSiaAskMutation (M4-2) is fully mocked here -- never the network, never
// a real askSia/axios call. This file only proves SiaPanel's own rendering
// and interaction contract against controlled mutation-object shapes.
jest.mock("../../hooks/mutations/useSiaAskMutation", () => ({
  useSiaAskMutation: jest.fn(),
}));

function makeMutationState(overrides = {}) {
  return {
    mutate: jest.fn(),
    mutateAsync: jest.fn(),
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    isError: false,
    reset: jest.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function getQuestionInput() {
  return screen.getByLabelText(/your question/i);
}

describe("frontend/src/components/sia/SiaPanel", () => {
  it("renders the accessible heading, question field, Ask button, and Close SIA control", () => {
    useSiaAskMutation.mockReturnValue(makeMutationState());
    render(<SiaPanel onClose={jest.fn()} />);

    expect(screen.getByRole("heading", { name: "Ask SIA" })).toBeInTheDocument();
    expect(getQuestionInput()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close SIA" })).toBeInTheDocument();
  });

  it("does not submit an empty question", () => {
    const mutate = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState({ mutate }));
    render(<SiaPanel onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it("does not submit a whitespace-only question", () => {
    const mutate = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState({ mutate }));
    render(<SiaPanel onClose={jest.fn()} />);

    fireEvent.change(getQuestionInput(), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it("passes a non-empty question unchanged to mutation.mutate", () => {
    const mutate = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState({ mutate }));
    render(<SiaPanel onClose={jest.fn()} />);

    fireEvent.change(getQuestionInput(), { target: { value: "Why did my spending change?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith("Why did my spending change?");
  });

  it("shows an accessible pending state and prevents duplicate submission while pending", () => {
    const mutate = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState({ mutate, isPending: true }));
    render(<SiaPanel onClose={jest.fn()} />);

    expect(screen.getByRole("status")).toHaveTextContent(/SIA is thinking/i);
    const askButton = screen.getByRole("button", { name: "Ask" });
    expect(askButton).toBeDisabled();

    fireEvent.click(askButton);

    expect(mutate).not.toHaveBeenCalled();
  });

  it("renders a successful answer exactly", () => {
    useSiaAskMutation.mockReturnValue(
      makeMutationState({
        isSuccess: true,
        data: {
          success: true,
          answer: "Your spending increased mainly in food.",
          intent: "spending_change",
          basedOn: ["spending.monthComparison"],
        },
      })
    );
    render(<SiaPanel onClose={jest.fn()} />);

    expect(screen.getByText("Your spending increased mainly in food.")).toBeInTheDocument();
  });

  it("renders a no-data answer (basedOn: [\"none\"]) as a normal success", () => {
    useSiaAskMutation.mockReturnValue(
      makeMutationState({
        isSuccess: true,
        data: {
          success: true,
          answer: "I do not have enough financial report data yet to explain your financial health score.",
          intent: "HEALTH_EXPLANATION",
          basedOn: ["none"],
        },
      })
    );
    render(<SiaPanel onClose={jest.fn()} />);

    expect(
      screen.getByText(
        "I do not have enough financial report data yet to explain your financial health score."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a backend-provided error message in an accessible alert", () => {
    useSiaAskMutation.mockReturnValue(
      makeMutationState({
        isError: true,
        error: {
          response: {
            status: 503,
            data: { success: false, message: "SIA is temporarily unavailable." },
          },
        },
      })
    );
    render(<SiaPanel onClose={jest.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("SIA is temporarily unavailable.");
  });

  it("falls back to a generic message for an unknown/malformed error", () => {
    useSiaAskMutation.mockReturnValue(
      makeMutationState({
        isError: true,
        error: new Error("connect ECONNREFUSED 127.0.0.1:8080"),
      })
    );
    render(<SiaPanel onClose={jest.fn()} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("SIA is temporarily unavailable. Please try again.");
    expect(alert).not.toHaveTextContent("ECONNREFUSED");
  });

  it("Retry sends the exact last submitted question again, unchanged", () => {
    const mutate = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState({ mutate }));
    const { rerender } = render(<SiaPanel onClose={jest.fn()} />);

    fireEvent.change(getQuestionInput(), { target: { value: "Why did my spending change?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(mutate).toHaveBeenNthCalledWith(1, "Why did my spending change?");

    // Simulate the mutation now reflecting an error after that submission.
    useSiaAskMutation.mockReturnValue(
      makeMutationState({
        mutate,
        isError: true,
        error: { response: { data: { message: "SIA is temporarily unavailable." } } },
      })
    );
    rerender(<SiaPanel onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenNthCalledWith(2, "Why did my spending change?");
  });

  it("invokes onClose exactly once when the close button is clicked", () => {
    const onClose = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState());
    render(<SiaPanel onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onClose is omitted and the close button is clicked", () => {
    useSiaAskMutation.mockReturnValue(makeMutationState());
    render(<SiaPanel />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Close SIA" }))).not.toThrow();
  });

  it("renders HTML-like answer content as literal text, never as markup", () => {
    const htmlLikeAnswer = "<b>bold</b> spending increase <img src=x onerror=alert(1)>";
    useSiaAskMutation.mockReturnValue(
      makeMutationState({
        isSuccess: true,
        data: { success: true, answer: htmlLikeAnswer, intent: "spending_change", basedOn: [] },
      })
    );
    const { container } = render(<SiaPanel onClose={jest.fn()} />);

    expect(screen.getByText(htmlLikeAnswer)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("never performs a real request -- useSiaAskMutation is fully mocked", () => {
    const mutate = jest.fn();
    useSiaAskMutation.mockReturnValue(makeMutationState({ mutate }));
    render(<SiaPanel onClose={jest.fn()} />);

    fireEvent.change(getQuestionInput(), { target: { value: "Why did my spending change?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(jest.isMockFunction(useSiaAskMutation)).toBe(true);
    expect(jest.isMockFunction(mutate)).toBe(true);
  });
});
