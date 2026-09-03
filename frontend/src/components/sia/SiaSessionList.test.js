// FE-001-T08 -- SiaSessionList's loading/error+retry/empty state matrix was
// already implemented (hand-rolled, equivalent to QueryState in substance)
// but had no test file proving it. This is that test file.
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import SiaSessionList from "./SiaSessionList";
import { useSiaSessionsQuery } from "../../hooks/queries/useSiaSessionsQuery";
import { useSiaDeleteSessionMutation } from "../../hooks/mutations/useSiaDeleteSessionMutation";

jest.mock("../../hooks/queries/useSiaSessionsQuery", () => ({
  useSiaSessionsQuery: jest.fn(),
}));

jest.mock("../../hooks/mutations/useSiaDeleteSessionMutation", () => ({
  useSiaDeleteSessionMutation: jest.fn(),
}));

function makeSession(overrides = {}) {
  return {
    sessionId: "s1",
    title: "Spending this month",
    lastMessageAt: "2026-06-01T12:00:00.000Z",
    messageCount: 4,
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    isOpen: true,
    onSelect: jest.fn(),
    onBack: jest.fn(),
    activeSessionId: null,
    onActiveSessionDeleted: jest.fn(),
    ...overrides,
  };
}

let mutate;

beforeEach(() => {
  mutate = jest.fn();
  useSiaDeleteSessionMutation.mockReturnValue({ mutate, isPending: false });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("frontend/src/components/sia/SiaSessionList -- FE-001-T08 state matrix", () => {
  it("shows an accessible loading state and nothing else while the query loads", () => {
    useSiaSessionsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SiaSessionList {...baseProps()} />);

    expect(screen.getByText(/loading your conversations/i)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading conversation history");
    expect(screen.queryByText(/no past conversations yet/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows an accessible error state with a working Try again, and no loading/empty text", () => {
    const refetch = jest.fn();
    useSiaSessionsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch,
    });

    render(<SiaSessionList {...baseProps()} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.queryByText(/loading your conversations/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state once the query succeeds with no sessions", () => {
    useSiaSessionsQuery.mockReturnValue({
      data: { success: true, sessions: [] },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SiaSessionList {...baseProps()} />);

    expect(screen.getByText(/no past conversations yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders each session's title, formatted meta, and opens it through onSelect", () => {
    const onSelect = jest.fn();
    useSiaSessionsQuery.mockReturnValue({
      data: {
        success: true,
        sessions: [makeSession(), makeSession({ sessionId: "s2", title: "", messageCount: 1 })],
      },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SiaSessionList {...baseProps({ onSelect })} />);

    expect(screen.getByText("Spending this month")).toBeInTheDocument();
    // Falls back to FALLBACK_TITLE when the backend sends no title.
    expect(screen.getByText("SIA conversation")).toBeInTheDocument();
    expect(screen.getByText(/4 messages/)).toBeInTheDocument();
    expect(screen.getByText(/1 messages/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Spending this month"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("omits the message count suffix when messageCount is not a number", () => {
    useSiaSessionsQuery.mockReturnValue({
      data: { success: true, sessions: [makeSession({ messageCount: undefined })] },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SiaSessionList {...baseProps()} />);

    expect(screen.queryByText(/messages/)).not.toBeInTheDocument();
  });
});

describe("frontend/src/components/sia/SiaSessionList -- delete flow", () => {
  function renderWithOneSession(overrides = {}) {
    useSiaSessionsQuery.mockReturnValue({
      data: { success: true, sessions: [makeSession()] },
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: jest.fn(),
    });
    return render(<SiaSessionList {...baseProps(overrides)} />);
  }

  it("asks for inline confirmation before deleting, and Cancel backs out without mutating", () => {
    renderWithOneSession();

    fireEvent.click(screen.getByRole("button", { name: /delete spending this month/i }));
    expect(screen.getByText("Delete?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("confirming delete mutates with the session id and clears confirmation on success", () => {
    renderWithOneSession();

    fireEvent.click(screen.getByRole("button", { name: /delete spending this month/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(mutate).toHaveBeenCalledWith("s1", expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }));

    const { onSuccess } = mutate.mock.calls[0][1];
    act(() => {
      onSuccess();
    });

    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });

  it("calls onActiveSessionDeleted only when the deleted session was the active one", () => {
    const onActiveSessionDeleted = jest.fn();
    renderWithOneSession({ activeSessionId: "s1", onActiveSessionDeleted });

    fireEvent.click(screen.getByRole("button", { name: /delete spending this month/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    const { onSuccess } = mutate.mock.calls[0][1];
    act(() => {
      onSuccess();
    });

    expect(onActiveSessionDeleted).toHaveBeenCalledWith("s1");
  });

  it("shows a persistent, accessible error and restores row controls when deletion fails (never optimistic)", () => {
    renderWithOneSession();

    fireEvent.click(screen.getByRole("button", { name: /delete spending this month/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    const { onError } = mutate.mock.calls[0][1];
    act(() => {
      onError();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(/could not be deleted/i);
    // The row's own delete icon button is back (confirmation cleared).
    expect(screen.getByRole("button", { name: /delete spending this month/i })).toBeInTheDocument();
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });
});
