// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
//
// Covers LandingPage.js's confirmDeleteHandler change: a committed delete
// (2xx) always follows the success path -- closing the confirmation modal
// and toasting -- whether derived budget/report sync finished
// (synchronized) or is still catching up (pending). A genuine failure or an
// idempotency conflict must NOT close the modal as if it succeeded.
//
// '../imports/Imports' is mocked as a whole so this suite exercises only
// LandingPage.js's own confirmDeleteHandler logic, not ExpensesPage's real
// data fetching or DeleteAlert's real markup -- both are replaced with
// minimal stubs that expose the exact props LandingPage.js passes them.
// useDeleteExpenseMutation is mocked directly so every outcome is driven by
// manually invoking the exact onSuccess/onError callbacks passed in --
// deterministic, no real network.
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import LandingPage from "./LandingPage";
import { useDeleteExpenseMutation } from "../../hooks/mutations/useDeleteExpenseMutation";
import { deleteSuccessToast, deleteErrorToast } from "../imports/Imports";

// An explicit factory (not bare jest.mock(path) auto-mocking) so Jest never
// needs to load-and-introspect the real hook module -- it transitively
// imports ../../api/axios, and this project's pinned axios version ships an
// ESM-only entry that CRA's bundled Jest transform config does not parse
// (a pre-existing, unrelated environment limitation).
jest.mock("../../hooks/mutations/useDeleteExpenseMutation", () => ({
  useDeleteExpenseMutation: jest.fn(),
}));

// Fully hand-mocked (no jest.requireActual, no real Router) -- the real
// react-router-dom v7 package is not resolvable under this project's
// bundled CRA/Jest 27 setup (a pre-existing, unrelated environment
// limitation: react-router-dom v7's ESM-first "exports" map is not resolved
// by Jest 27's bundled resolver). LandingPage.js only uses Routes/Route/
// Link/useLocation, none of which need real routing behavior for this
// suite -- Route ignores `path` and always renders its element so the
// mocked ExpensesPage (below) is always present, and Link is a plain
// pass-through anchor.
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

jest.mock("../sia/SiaLauncherContext", () => ({
  SiaLauncherProvider: ({ children }) => <>{children}</>,
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
