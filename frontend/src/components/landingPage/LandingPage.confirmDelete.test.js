// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LandingPage from "./LandingPage";
import { useDeleteExpenseMutation } from "../../hooks/mutations/useDeleteExpenseMutation";
import { deleteSuccessToast, deleteErrorToast } from "../imports/Imports";

// An explicit factory (not bare jest.mock(path) auto-mocking) so Jest never
jest.mock("../../hooks/mutations/useDeleteExpenseMutation", () => ({
  useDeleteExpenseMutation: jest.fn(),
}));

// Fully hand-mocked (no jest.requireActual, no real Router) -- the real
jest.mock(
  "react-router-dom",
  () => ({
    Routes: ({ children }) => <>{children}</>,
    Route: ({ element }) => element,
    Link: ({ to, children, ...rest }) => (
      <a href={typeof to === "string" ? to : "#"} {...rest}>
        {children}
      </a>
    ),
    useLocation: () => ({ pathname: "/" }),
  }),
  { virtual: true }
);

jest.mock("../../query/queryClient", () => ({
  queryClient: { clear: jest.fn() },
}));

jest.mock("../imports/Imports", () => {
  const React = require("react");
  return {
    ThemeContext: React.createContext({ theme: "light-theme", toggleTheme: jest.fn() }),
    TrendChartPage: () => null,
    BarChartPage: () => null,
    PieChartPage: () => null,
    ExpensesPage: ({ onDelete }) => (
      <button onClick={() => onDelete("expense-1")}>trigger-delete</button>
    ),
    AddExpense: () => null,
    DeleteAlert: ({ confirmDeleteHandler, cancelDeleteHandler }) => (
      <div data-testid="delete-alert">
        <button onClick={confirmDeleteHandler}>confirm-delete</button>
        <button onClick={cancelDeleteHandler}>cancel-delete</button>
      </div>
    ),
    Insights: () => null,
    deleteSuccessToast: jest.fn(),
    deleteErrorToast: jest.fn(),
    Add: () => null,
  };
});

beforeEach(() => {
  localStorage.setItem("token", "fake-test-token");
});

afterEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
});

function renderLandingPage() {
  return render(
    <LandingPage setIsSpinnerLoad={jest.fn()} setIsLogout={jest.fn()} setIsLoggedIn={jest.fn()} />
  );
}

function triggerDeleteAndCapture(mockMutate) {
  fireEvent.click(screen.getByText("trigger-delete"));
  fireEvent.click(screen.getByText("confirm-delete"));
  const [confirmDeleteId, callbacks] = mockMutate.mock.calls[mockMutate.mock.calls.length - 1];
  return { confirmDeleteId, callbacks };
}

describe("LandingPage confirmDeleteHandler -- committed delete UX", () => {
  let mockDeleteMutate;

  beforeEach(() => {
    mockDeleteMutate = jest.fn();
    useDeleteExpenseMutation.mockReturnValue({ mutate: mockDeleteMutate });
  });

  it("renders the interaction-blocking chart overlay only for the mobile chart picker", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    try {
      const { container } = renderLandingPage();
      fireEvent.click(container.querySelector(".mobile-chart-btn"));

      expect(container.querySelector(".mobile-chart-overlay")).toBeInTheDocument();
      expect(container.querySelector(".mobile-dropdown-modal")).toBeInTheDocument();

      fireEvent.click(container.querySelector(".mobile-chart-overlay"));
      expect(container.querySelector(".mobile-chart-overlay")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  it("a synchronized 2xx closes the confirmation modal and shows the plain success toast", () => {
    renderLandingPage();
    const { callbacks } = triggerDeleteAndCapture(mockDeleteMutate);

    act(() => {
      callbacks.onSuccess({ success: true, derivedData: { status: "synchronized", recoveryPending: false } });
    });

    expect(deleteSuccessToast).toHaveBeenCalledWith(false);
    // Modal closed -- the stubbed DeleteAlert is no longer rendered.
    expect(screen.queryByTestId("delete-alert")).not.toBeInTheDocument();
  });

  it("a committed-but-pending 2xx STILL closes the modal and toasts success, with the pending flag surfaced", () => {
    renderLandingPage();
    const { callbacks } = triggerDeleteAndCapture(mockDeleteMutate);

    act(() => {
      callbacks.onSuccess({
        success: true,
        derivedData: { status: "pending", budget: "pending", report: "synchronized", recoveryPending: true },
      });
    });

    expect(deleteSuccessToast).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("delete-alert")).not.toBeInTheDocument();
  });

  it("a genuine primary failure (500) does NOT close the modal or toast success", () => {
    renderLandingPage();
    const { callbacks } = triggerDeleteAndCapture(mockDeleteMutate);

    act(() => {
      callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    expect(deleteSuccessToast).not.toHaveBeenCalled();
    expect(deleteErrorToast).toHaveBeenCalledWith({ message: "Internal Server Error" });
    // Modal stays open for the user to retry/cancel explicitly.
    expect(screen.getByTestId("delete-alert")).toBeInTheDocument();
  });

  it("an idempotency/other conflict (409) is a controlled error -- not masqueraded as success, modal stays open", () => {
    renderLandingPage();
    const { callbacks } = triggerDeleteAndCapture(mockDeleteMutate);

    act(() => {
      callbacks.onError({ response: { status: 409, data: { errorCode: "IDEMPOTENCY_KEY_CONFLICT" } } });
    });

    expect(deleteSuccessToast).not.toHaveBeenCalled();
    expect(deleteErrorToast).not.toHaveBeenCalled();
    expect(screen.getByTestId("delete-alert")).toBeInTheDocument();
  });
});
