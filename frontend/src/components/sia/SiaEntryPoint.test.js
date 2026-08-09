import React from "react";
import { render as rtlRender, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiaEntryPoint from "./SiaEntryPoint";

// Batch 3C: SiaEntryPoint now owns the conversation state (see
// useSiaConversation), which uses TanStack Query, so a provider is
// required. The API layer is mocked so nothing here can reach the network.
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));

// Wraps every render in this file with a fresh QueryClient, keeping each
// test's cache isolated.
const render = (ui) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
};

// M4-4: SiaEntryPoint now uses hooks (useState/useContext), so the flag is
// read fresh on every render (see SiaEntryPoint.js) instead of being cached
// as a module-level constant loaded via jest.resetModules(). This lets every
// test in this file use one single, static top-level import of React and of
// SiaEntryPoint -- resetting Jest's module registry would also reload React
// itself, risking a second React instance and "Invalid hook call" errors.
// Tests only ever mutate process.env directly and re-render.
//
// SiaPanel is mocked here so this file stays a pure ownership/wiring test
// (open/close state, onOpen callback, flag gating) -- SiaPanel's own
// question/answer/error/retry contract is covered by SiaPanel.test.js.
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

jest.mock("./SiaPanel", () => {
  const ReactForMock = require("react");
  return function MockSiaPanel({ onClose }) {
    ReactForMock.useEffect(() => {
      mockPanelMountSpy();
    }, []);
    return (
      <div data-testid="mock-sia-panel">
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
  // presentation), but the conversation state it renders now lives in
  // SiaEntryPoint, so remounting no longer discards the transcript. That
  // retention is proven end-to-end in SiaConversation.test.js; this file
  // continues to prove the mount/unmount wiring itself.
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
});
