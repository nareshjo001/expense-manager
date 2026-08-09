import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import SiaAskButton from "./SiaAskButton";
import { useSiaLauncher } from "./SiaLauncherContext";

// Unit-level: useSiaLauncher() is mocked so this file proves SiaAskButton's
// OWN contract in isolation (what it renders, what it calls, when it
// renders nothing) -- the real end-to-end open/prefill/focus behavior is
// covered by SiaLauncherContext.test.js against the real provider stack.
jest.mock("./SiaLauncherContext", () => ({
  useSiaLauncher: jest.fn(),
}));

const ENV_KEY = "REACT_APP_SIA_ENABLED";
const originalFlag = process.env[ENV_KEY];

function setFlag(value) {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

beforeEach(() => {
  setFlag("true");
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  if (originalFlag === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalFlag;
});

describe("SiaAskButton", () => {
  it("renders a native button whose visible text is the exact supplied label", () => {
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    render(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);

    const button = screen.getByRole("button", { name: "Ask SIA about this trend" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveTextContent("Ask SIA about this trend");
  });

  it("calls openSiaWithQuestion with exactly the supplied suggestionId and nothing else", () => {
    const openSiaWithQuestion = jest.fn();
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion });
    render(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA about my budget" }));

    expect(openSiaWithQuestion).toHaveBeenCalledTimes(1);
    expect(openSiaWithQuestion).toHaveBeenCalledWith("budget-status");
  });

  it("renders nothing when the SIA build flag is disabled", () => {
    setFlag("false");
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    const { container } = render(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing (and never throws) when no SiaLauncherProvider is mounted above it", () => {
    useSiaLauncher.mockReturnValue(null);
    const { container } = render(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);

    expect(container).toBeEmptyDOMElement();
  });

  it("meets the 44px minimum touch target via its own stylesheet class", () => {
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    render(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);

    expect(screen.getByRole("button", { name: "Ask SIA about this trend" })).toHaveClass("sia-ask-btn");
  });

  // Batch 3G remediation (dark-theme contrast blocker): the runtime
  // appearance-selection contract. A genuine computed-style/contrast
  // assertion is not meaningful under Jest's CSS transform (no real
  // stylesheet cascade is applied in jsdom), so this proves the class the
  // component actually applies at runtime for each tone -- the static
  // cascade trace for why that class is readable in both themes lives in
  // SiaAskButton.css's comment and the audit report. Final visual/contrast
  // confirmation is reserved for the Windows build check.
  it('applies the "sia-ask-btn--light-surface" class when tone="light-surface" is supplied', () => {
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    render(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" tone="light-surface" />);

    const button = screen.getByRole("button", { name: "Ask SIA about my budget" });
    expect(button).toHaveClass("sia-ask-btn");
    expect(button).toHaveClass("sia-ask-btn--light-surface");
  });

  it("does not apply the light-surface class when tone is omitted (default/inherited appearance)", () => {
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    render(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);

    const button = screen.getByRole("button", { name: "Ask SIA about this trend" });
    expect(button).toHaveClass("sia-ask-btn");
    expect(button).not.toHaveClass("sia-ask-btn--light-surface");
  });

  it("does not apply the light-surface class for an unrecognized tone value (fails closed to default)", () => {
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    render(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" tone="something-else" />);

    expect(screen.getByRole("button", { name: "Ask SIA about this trend" })).not.toHaveClass("sia-ask-btn--light-surface");
  });

  it("keeps the accessible name and suggestionId wiring exact when a tone is supplied", () => {
    const openSiaWithQuestion = jest.fn();
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion });
    render(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" tone="light-surface" />);

    const button = screen.getByRole("button", { name: "Ask SIA about my budget" });
    fireEvent.click(button);

    expect(openSiaWithQuestion).toHaveBeenCalledTimes(1);
    expect(openSiaWithQuestion).toHaveBeenCalledWith("budget-status");
  });

  it("remains a native <button type=\"button\"> (keyboard-activatable, no role/behavior change) regardless of tone", () => {
    useSiaLauncher.mockReturnValue({ openSiaWithQuestion: jest.fn() });
    render(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" tone="light-surface" />);

    const button = screen.getByRole("button", { name: "Ask SIA about my budget" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
  });
});
