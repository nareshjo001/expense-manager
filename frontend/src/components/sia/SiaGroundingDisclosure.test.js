import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SiaGroundingDisclosure, { isValidGrounding } from "./SiaGroundingDisclosure";

afterEach(() => {
  cleanup();
});

// Batch 3F acceptance remediation: `period` here is a component-level test
const ONE_SOURCE = { sources: [{ key: "financialHealth", label: "Financial health analysis", period: "2026-08-09" }] };
const TWO_SOURCES = {
  sources: [
    { key: "financialHealth", label: "Financial health analysis", period: "2026-08-09" },
    { key: "summary", label: "Financial summary" },
  ],
};

describe("SiaGroundingDisclosure -- isValidGrounding()", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["not an object", "a string"],
    ["missing sources", {}],
    ["sources not an array", { sources: "nope" }],
    ["empty sources array", { sources: [] }],
    ["a source missing key", { sources: [{ label: "X" }] }],
    ["a source missing label", { sources: [{ key: "x" }] }],
    ["a source with a blank key", { sources: [{ key: "  ", label: "X" }] }],
    ["a source with a non-string period", { sources: [{ key: "x", label: "X", period: 123 }] }],
  ])("rejects %s", (_label, value) => {
    expect(isValidGrounding(value)).toBe(false);
  });

  it("accepts a single valid source with a period", () => {
    expect(isValidGrounding(ONE_SOURCE)).toBe(true);
  });

  it("accepts a valid source with no period at all (period is optional)", () => {
    expect(isValidGrounding({ sources: [{ key: "x", label: "X" }] })).toBe(true);
  });

  // Batch 3F pre-commit remediation: the backend schemas no longer default
  it("accepts a source whose period is explicitly null (legacy rows written under the old schema default)", () => {
    expect(isValidGrounding({ sources: [{ key: "x", label: "X", period: null }] })).toBe(true);
  });
});

describe("SiaGroundingDisclosure -- rendering", () => {
  it("renders nothing for missing, empty, or malformed grounding", () => {
    const { container: c1 } = render(<SiaGroundingDisclosure grounding={undefined} />);
    expect(c1).toBeEmptyDOMElement();
    cleanup();

    const { container: c2 } = render(<SiaGroundingDisclosure grounding={{ sources: [] }} />);
    expect(c2).toBeEmptyDOMElement();
    cleanup();

    const { container: c3 } = render(<SiaGroundingDisclosure grounding={{ sources: [{ key: "x" }] }} />);
    expect(c3).toBeEmptyDOMElement();
  });

  it("renders a collapsed disclosure by default, indicating BALENISA data supported the answer, with the correct singular count", () => {
    render(<SiaGroundingDisclosure grounding={ONE_SOURCE} />);
    const toggle = screen.getByRole("button", { name: /BALENISA data supported this answer \(1 source\)/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Financial health analysis")).not.toBeInTheDocument();
  });

  it("uses the plural count for more than one source", () => {
    render(<SiaGroundingDisclosure grounding={TWO_SOURCES} />);
    expect(screen.getByRole("button", { name: /\(2 sources\)/i })).toBeInTheDocument();
  });

  it("expands to show human-readable labels and optional periods on click", () => {
    render(<SiaGroundingDisclosure grounding={TWO_SOURCES} />);
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Financial health analysis")).toBeInTheDocument();
    expect(screen.getByText("2026-08-09")).toBeInTheDocument();
    expect(screen.getByText("Financial summary")).toBeInTheDocument();
    // Explains what grounding means without overclaiming causal influence.
    expect(screen.getByText(/provided to SIA as context/i)).toBeInTheDocument();
    expect(screen.getByText(/do not mean every part of the answer came directly/i)).toBeInTheDocument();
  });

  it("collapses again on a second click", () => {
    render(<SiaGroundingDisclosure grounding={ONE_SOURCE} />);
    const toggle = screen.getByRole("button");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Financial health analysis")).not.toBeInTheDocument();
  });

  it("is keyboard operable -- a native button toggles on Enter/Space via the standard activation event", () => {
    render(<SiaGroundingDisclosure grounding={ONE_SOURCE} />);
    const toggle = screen.getByRole("button");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("type", "button");
    // jsdom's fireEvent.click is the faithful proxy for a native <button>'s
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("sets aria-controls to the id of the expanded content region", () => {
    render(<SiaGroundingDisclosure grounding={ONE_SOURCE} />);
    const toggle = screen.getByRole("button");
    fireEvent.click(toggle);

    const controlsId = toggle.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId)).toBeInTheDocument();
  });

  it("renders sources as a real list for correct list semantics", () => {
    render(<SiaGroundingDisclosure grounding={TWO_SOURCES} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders no period text for a legacy source whose period is explicitly null", () => {
    render(<SiaGroundingDisclosure grounding={{ sources: [{ key: "budget", label: "Budget status", period: null }] }} />);
    fireEvent.click(screen.getByRole("button"));
    // The label still renders; the null period contributes no stray empty
    // element or literal "null" text.
    expect(screen.getByText("Budget status")).toBeInTheDocument();
    expect(screen.queryByText("null")).not.toBeInTheDocument();
    expect(screen.getByRole("listitem").textContent).toBe("Budget status");
  });

  it("never renders the internal source key as visible text", () => {
    render(<SiaGroundingDisclosure grounding={ONE_SOURCE} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("financialHealth")).not.toBeInTheDocument();
  });

  it("each rendered instance owns independent expand/collapse state", () => {
    render(
      <div>
        <SiaGroundingDisclosure grounding={ONE_SOURCE} />
        <SiaGroundingDisclosure grounding={TWO_SOURCES} />
      </div>
    );
    const toggles = screen.getAllByRole("button");
    expect(toggles).toHaveLength(2);

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Financial health analysis")).toBeInTheDocument();
    expect(screen.queryByText("Financial summary")).not.toBeInTheDocument();
  });

  // Batch 3F acceptance remediation -- requirement 4: verify accessible
  it("two disclosures rendered with IDENTICAL grounding (same source keys) get distinct aria-controls/content-element ids", () => {
    const SAME_GROUNDING_A = {
      sources: [{ key: "financialHealth", label: "Financial health analysis", period: "2026-08-09" }],
    };
    // A structurally identical second grounding object (same keys, same
    const SAME_GROUNDING_B = {
      sources: [{ key: "financialHealth", label: "Financial health analysis", period: "2026-08-09" }],
    };

    render(
      <div>
        <SiaGroundingDisclosure grounding={SAME_GROUNDING_A} />
        <SiaGroundingDisclosure grounding={SAME_GROUNDING_B} />
      </div>
    );

    const toggles = screen.getAllByRole("button");
    expect(toggles).toHaveLength(2);

    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);

    const idA = toggles[0].getAttribute("aria-controls");
    const idB = toggles[1].getAttribute("aria-controls");

    // Distinct ids -- not derived from (and therefore not collided by) the
    // shared grounding source key.
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);

    // Each button's aria-controls resolves to its OWN panel element, not
    // the other instance's.
    const panelA = document.getElementById(idA);
    const panelB = document.getElementById(idB);
    expect(panelA).toBeInTheDocument();
    expect(panelB).toBeInTheDocument();
    expect(panelA).not.toBe(panelB);

    // Independent expanded state is preserved even with identical grounding
    // -- collapsing the first must not affect the second.
    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");

    // The internal key ("financialHealth") never leaks into visible text
    // for either instance, regardless of how many instances share it.
    expect(screen.queryByText("financialHealth")).not.toBeInTheDocument();
  });
});
