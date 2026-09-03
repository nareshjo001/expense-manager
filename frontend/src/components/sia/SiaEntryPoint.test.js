import React from "react";
import { render as rtlRender, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiaEntryPoint from "./SiaEntryPoint";
import { getSiaStatus, getSiaSessions, getSiaSessionMessages, deleteSiaSession } from "../../api/siaSessionsApi";

// Batch 3C: SiaEntryPoint now owns the conversation state (see
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaStatus: jest.fn(),
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
}));
// Workstream 3: this component now transitively renders SiaPanel ->
jest.mock("../../api/siaVoiceApi", () => ({ transcribeSiaAudio: jest.fn() }));

beforeEach(() => {
  getSiaStatus.mockResolvedValue({ success: true, available: true });
  getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
  getSiaSessionMessages.mockResolvedValue({ success: true, sessionId: "s1", messages: [] });
  deleteSiaSession.mockResolvedValue({ success: true, message: "Session deleted." });
});

// Wraps every render in this file with a fresh QueryClient, keeping each
// test's cache isolated.
const render = (ui) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

// M4-4: SiaEntryPoint now uses hooks (useState/useContext), so the flag is
const ENV_KEY = "REACT_APP_SIA_ENABLED";
const originalValue = process.env[ENV_KEY];

function restoreEnv() {
  if (originalValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalValue;
  }
}

function setFlag(value) {
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
}

const mockPanelMountSpy = jest.fn();

// isAvailable/isCheckingAvailability are surfaced as data-attributes (not
jest.mock("./SiaPanel", () => {
  const ReactForMock = require("react");
  return function MockSiaPanel({ onClose, isAvailable, isCheckingAvailability, isAvailabilityError }) {
    ReactForMock.useEffect(() => {
      mockPanelMountSpy();
    }, []);
    return (
      <div
        data-testid="mock-sia-panel"
        data-checking={String(Boolean(isCheckingAvailability))}
        data-available={String(Boolean(isAvailable))}
        data-availability-error={String(Boolean(isAvailabilityError))}
      >
        <button type="button" onClick={onClose}>
          Mock Close
        </button>
      </div>
    );
  };
});

afterEach(() => {
  cleanup();
  restoreEnv();
  mockPanelMountSpy.mockClear();
});

afterAll(() => {
  restoreEnv();
});

describe("frontend/src/components/sia/SiaEntryPoint", () => {
  it("renders nothing when the flag is unset", () => {
    setFlag(undefined);
    const { container } = render(<SiaEntryPoint />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it('renders nothing when the flag is "false"', () => {
    setFlag("false");
    const { container } = render(<SiaEntryPoint />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["TRUE", "1", "yes", "True", " true", "true "])(
    'renders nothing for the non-contract value "%s"',
    (value) => {
      setFlag(value);
      const { container } = render(<SiaEntryPoint />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    }
  );

  it('renders exactly one button named "Ask SIA" for the exact value "true"', () => {
    setFlag("true");
    render(<SiaEntryPoint />);

    const buttons = screen.getAllByRole("button", { name: "Ask SIA" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("type", "button");
  });

  it("invokes onOpen exactly once when the enabled button is clicked", () => {
    setFlag("true");
    const onOpen = jest.fn();
    render(<SiaEntryPoint onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onOpen is omitted and the button is clicked", () => {
    setFlag("true");
    render(<SiaEntryPoint />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }))).not.toThrow();
  });

  it("clicking Ask SIA opens the panel (launcher button disappears, panel appears)", () => {
    setFlag("true");
    render(<SiaEntryPoint />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

    expect(screen.getByTestId("mock-sia-panel")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask SIA" })).not.toBeInTheDocument();
  });

  it("still invokes the optional onOpen callback exactly once when opening the panel", () => {
    setFlag("true");
    const onOpen = jest.fn();
    render(<SiaEntryPoint onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mock-sia-panel")).toBeInTheDocument();
  });

  it("closing the panel returns to the launcher", () => {
    setFlag("true");
    render(<SiaEntryPoint />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    expect(screen.getByTestId("mock-sia-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock Close" }));

    expect(screen.queryByTestId("mock-sia-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask SIA" })).toBeInTheDocument();
  });

  // Batch 3C: the PANEL is still genuinely remounted (it is pure
  it("reopening creates a fresh panel instance (a real mount, not a retained one)", () => {
    setFlag("true");
    render(<SiaEntryPoint />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    expect(mockPanelMountSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Mock Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

    expect(mockPanelMountSpy).toHaveBeenCalledTimes(2);
  });

  it("a disabled feature flag renders neither the launcher nor the panel", () => {
    setFlag("false");
    const { container } = render(<SiaEntryPoint />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Ask SIA" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-sia-panel")).not.toBeInTheDocument();
  });

  // Batch 3E pre-commit fix regression test. Spies on console.error WITHOUT
  it("the status query settles without ever logging TanStack's 'data cannot be undefined' warning", async () => {
    const errorSpy = jest.spyOn(console, "error");
    setFlag("true");
    render(<SiaEntryPoint />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    const panel = screen.getByTestId("mock-sia-panel");

    await waitFor(() => expect(panel).toHaveAttribute("data-checking", "false"));

    expect(getSiaStatus).toHaveBeenCalled();
    expect(panel).toHaveAttribute("data-available", "true");

    const undefinedDataWarnings = errorSpy.mock.calls.filter(([message]) =>
      typeof message === "string" && message.includes("Query data cannot be undefined")
    );
    expect(undefinedDataWarnings).toEqual([]);

    errorSpy.mockRestore();
  });

  // FE-001-T08 -- a genuine status-query failure previously collapsed into
  // exactly the same "unavailable" props as a clean "available: false"
  // response, so a caller downstream (SiaPanel) had no way to tell them
  // apart in its copy.
  it("surfaces a genuine status-query failure to SiaPanel as isAvailabilityError, distinct from a clean unavailable response", async () => {
    getSiaStatus.mockRejectedValue(new Error("network down"));
    setFlag("true");
    render(<SiaEntryPoint />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    const panel = screen.getByTestId("mock-sia-panel");

    // useSiaStatusQuery configures retry: 1, so a rejection settles only
    // after one retry round-trip -- longer than RTL's default 1s timeout.
    await waitFor(() => expect(panel).toHaveAttribute("data-checking", "false"), { timeout: 5000 });

    expect(panel).toHaveAttribute("data-available", "false");
    expect(panel).toHaveAttribute("data-availability-error", "true");
  });

  it("does not report an availability error for a clean available:false response", async () => {
    getSiaStatus.mockResolvedValue({ success: true, available: false });
    setFlag("true");
    render(<SiaEntryPoint />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    const panel = screen.getByTestId("mock-sia-panel");

    await waitFor(() => expect(panel).toHaveAttribute("data-checking", "false"));

    expect(panel).toHaveAttribute("data-available", "false");
    expect(panel).toHaveAttribute("data-availability-error", "false");
  });
});
