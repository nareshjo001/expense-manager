// FE-002-T07 -- accessibility regression tests.
//
// The 2026-09-08 audit recorded that no a11y tests and no axe dependency
// existed anywhere in the frontend or e2e suites, so every accessibility fix
// this feature shipped (T03's semantic buttons, T04's focus trap, and now
// T02/T05's labelled fields) could be undone by any later edit with nothing
// to catch it.
//
// These tests deliberately do two different things, because axe alone is not
// enough. axe catches machine-detectable violations, which is roughly a third
// of WCAG. The explicit assertions below cover the parts axe cannot judge:
// whether the label is bound to the right input, whether an error is
// announced, whether a hint is actually referenced.
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { LabeledField } from "./LabeledField";
import { FormStatus } from "./FormStatus";

expect.extend(toHaveNoViolations);

describe("LabeledField (FE-002-T02)", () => {
  test("has no axe violations", async () => {
    const { container } = render(<LabeledField label="Email ID" name="email" type="email" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  test("the label is bound to the input, so clicking it focuses the field", () => {
    render(<LabeledField label="Email ID" name="email" type="email" />);
    // getByLabelText resolves through the htmlFor/id relationship, so this
    // passing IS the proof that the binding exists -- a stray <label> with no
    // htmlFor would not be found here.
    expect(screen.getByLabelText(/Email ID/)).toBeInTheDocument();
  });

  test("a placeholder alone is never the accessible name", () => {
    render(<LabeledField label="Email ID" name="email" placeholder="you@example.com" />);
    const input = screen.getByLabelText(/Email ID/);
    // The placeholder may exist as a hint, but the name comes from the label.
    expect(input).toHaveAttribute("placeholder", "you@example.com");
    expect(screen.getByText("Email ID")).toBeInTheDocument();
  });

  test("an error is announced and linked to the input via aria-describedby", () => {
    render(<LabeledField label="Password" name="password" error="Password is too short" />);

    const input = screen.getByLabelText(/Password/);
    const alert = screen.getByRole("alert");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(alert).toHaveTextContent("Password is too short");
    // The link must be real: describedby has to name the element that exists.
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  test("aria-describedby is absent when there is nothing to describe", () => {
    render(<LabeledField label="Email" name="email" />);
    // Pointing describedby at a non-existent id makes some screen readers
    // announce nothing at all, so the attribute must simply not be there.
    expect(screen.getByLabelText(/Email/)).not.toHaveAttribute("aria-describedby");
  });

  test("a hint is referenced by the input as well", () => {
    render(<LabeledField label="Code" name="otp" hint="Six digits." />);
    const input = screen.getByLabelText(/Code/);
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText("Six digits.")).toBeInTheDocument();
  });

  test("two instances on one page do not collide on id", () => {
    render(
      <>
        <LabeledField label="Password" name="password" />
        <LabeledField label="Confirm Password" name="confirmPassword" />
      </>
    );
    // Exact string match: "Password" must resolve to the first field only,
    // not also to "Confirm Password".
    const first = screen.getByLabelText("Password");
    const second = screen.getByLabelText("Confirm Password");
    // A hand-written id would make these the same element and silently break
    // the second field's label association.
    expect(first.id).not.toBe(second.id);
  });

  test("required is exposed to assistive tech, not only styled", () => {
    render(<LabeledField label="Email" name="email" required />);
    expect(screen.getByLabelText(/Email/)).toHaveAttribute("aria-required", "true");
  });
});

describe("FormStatus (FE-002-T05)", () => {
  test("has no axe violations", async () => {
    const { container } = render(<FormStatus message="Invalid email or password" />);
    expect(await axe(container)).toHaveNoViolations();
  });

  test("an error message is assertive so it interrupts", () => {
    render(<FormStatus message="Invalid email or password" tone="error" />);
    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("aria-live", "assertive");
    expect(region).toHaveTextContent("Invalid email or password");
  });

  test("a status message is polite so it waits for a pause", () => {
    render(<FormStatus message="Sending reset link..." tone="status" />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  test("the region is present in the DOM even while empty", () => {
    // This is the crux of the component. A live region added at the same
    // moment as its text is frequently not announced at all -- the region has
    // to already exist for the change to be observed.
    const { container } = render(<FormStatus message="" tone="error" />);
    const region = container.querySelector(".form-status");
    expect(region).toBeInTheDocument();
    expect(region).toBeEmptyDOMElement();
  });
});
