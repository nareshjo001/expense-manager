// Form-level live region for validation and submission status.
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
