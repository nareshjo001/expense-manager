import { useId } from "react";

// FE-002-T02 -- the reusable labelled-field primitive. T04 shipped the dialog
// half of this task as useModalA11y; this is the field half, which the
// 2026-09-08 audit recorded as missing.
//
// The problem it fixes: every input in the authentication journey identified
// itself with `placeholder` alone. A placeholder is not a label. It vanishes
// the moment the user types, so anyone relying on it loses the only clue to
// what the field wants -- which hurts screen-reader users first but also
// anyone returning to a half-filled form. Placeholder text is also commonly
// rendered in a low-contrast grey, so it tends to fail the same contrast bar
// T06 covers.
//
// What this component guarantees for every field built from it:
//   * a real <label htmlFor> bound to the input's id, so clicking the label
//     focuses the field and assistive tech announces a name;
//   * ids generated with useId(), so a component may be rendered twice on one
//     page without colliding (a hand-written id="email" cannot promise that);
//   * error text tied to the input through aria-describedby AND marked
//     aria-invalid, so the error is announced as part of the field rather
//     than as loose text floating nearby;
//   * a `required` field marked with aria-required, not only a visual accent.
//
// The placeholder is kept as an optional example/hint. It is not a label and
// is never the only identification.
export const LabeledField = ({
  label,
  type = "text",
  name,
  value,
  onChange,
  required = false,
  error,
  hint,
  className = "",
  inputClassName = "",
  autoComplete,
  ...inputProps
}) => {
  const reactId = useId();
  const inputId = `field-${name || "input"}-${reactId}`;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  // Only reference ids that are actually rendered: pointing aria-describedby
  // at a missing element makes some screen readers announce nothing at all.
  const describedBy = [error ? errorId : null, hint ? hintId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`labeled-field ${className}`.trim()}>
      <label className="labeled-field-label" htmlFor={inputId}>
        {label}
        {required && (
          <span className="labeled-field-required" aria-hidden="true">
            {" *"}
          </span>
        )}
      </label>

      {hint && (
        <p className="labeled-field-hint" id={hintId}>
          {hint}
        </p>
      )}

      <input
        id={inputId}
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy || undefined}
        autoComplete={autoComplete}
        className={`labeled-field-input ${inputClassName}`.trim()}
        {...inputProps}
      />

      {/* role="alert" so a validation message that appears after submit is
          announced immediately, rather than only being found if the user
          happens to navigate back over the field. */}
      {error && (
        <p className="labeled-field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default LabeledField;
