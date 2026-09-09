// FE-002-T05 -- form-level live region for validation and submission status.
//
// Field-level errors are announced by LabeledField's role="alert". This
// covers the other half: messages that belong to the FORM rather than to one
// input -- "Invalid email or password", "Sending reset link...", "Saved".
// Those were previously delivered only through toasts, which are rendered in
// a detached container and are easy for assistive tech to miss entirely.
//
// The container is rendered ALWAYS, even when empty. A live region has to
// exist in the DOM before the text appears for the change to be announced;
// mounting the region and its text at the same moment is the single most
// common reason an aria-live region silently does nothing.
//
// tone chooses the urgency, and the pairing is deliberate:
//   * "error"  -> role="alert" + aria-live="assertive": interrupt, the user
//                 cannot proceed until they know.
//   * "status" -> role="status" + aria-live="polite": wait for a pause,
//                 because "Saving..." interrupting someone mid-sentence is
//                 worse than telling them a moment later.
export const FormStatus = ({ message, tone = "error", className = "" }) => {
  const isError = tone === "error";

  return (
    <div
      className={`form-status ${isError ? "form-status-error" : "form-status-info"} ${className}`.trim()}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {message || ""}
    </div>
  );
};

export default FormStatus;
