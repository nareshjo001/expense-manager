import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// The flag is read once at module load time (see SiaEntryPoint.js), so each
// test that needs a specific flag value sets process.env before requiring
// the module fresh via jest.resetModules() + a dynamic require. This file
// never touches any API client, mutation hook, or network -- SiaEntryPoint
// itself calls none of those (see M4-1's askSia / M4-2's useSiaAskMutation).
const ENV_KEY = "REACT_APP_SIA_ENABLED";
const originalValue = process.env[ENV_KEY];

function restoreEnv() {
  if (originalValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = originalValue;
  }
}

afterEach(() => {
  cleanup();
  restoreEnv();
  jest.resetModules();
});

afterAll(() => {
  restoreEnv();
});

// Loads a fresh SiaEntryPoint after setting (or deleting) the flag, so the
// module-level SIA_ENABLED constant is re-evaluated against the given value.
function loadSiaEntryPoint(flagValue) {
  jest.resetModules();
  if (flagValue === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = flagValue;
  }
  return require("./SiaEntryPoint").default;
}

describe("frontend/src/components/sia/SiaEntryPoint", () => {
  it("renders nothing when the flag is unset", () => {
    const SiaEntryPoint = loadSiaEntryPoint(undefined);
    const { container } = render(<SiaEntryPoint />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it('renders nothing when the flag is "false"', () => {
    const SiaEntryPoint = loadSiaEntryPoint("false");
    const { container } = render(<SiaEntryPoint />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["TRUE", "1", "yes", "True", " true", "true "])(
    'renders nothing for the non-contract value "%s"',
    (value) => {
      const SiaEntryPoint = loadSiaEntryPoint(value);
      const { container } = render(<SiaEntryPoint />);

      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    }
  );

  it('renders exactly one button named "Ask SIA" for the exact value "true"', () => {
    const SiaEntryPoint = loadSiaEntryPoint("true");
    render(<SiaEntryPoint />);

    const buttons = screen.getAllByRole("button", { name: "Ask SIA" });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("type", "button");
  });

  it("invokes onOpen exactly once when the enabled button is clicked", () => {
    const SiaEntryPoint = loadSiaEntryPoint("true");
    const onOpen = jest.fn();
    render(<SiaEntryPoint onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onOpen is omitted and the button is clicked", () => {
    const SiaEntryPoint = loadSiaEntryPoint("true");
    render(<SiaEntryPoint />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }))).not.toThrow();
  });
});
