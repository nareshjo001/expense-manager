import './QueryState.css';

// FE-001 -- shared explicit-state wrapper for TanStack Query-backed screens.
// Distinguishes loading vs error(+retry) vs empty vs content so a screen can
// never show the same blank/generic UI for "still loading", "the request
// failed" and "there is genuinely no data yet" (the exact gap the feature
// spec calls out for the chart/insights screens).
export default function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  loadingLabel = 'Loading...',
  errorLabel = "Something went wrong loading this data.",
  emptyLabel = 'No data to show yet.',
  emptyHint,
  children,
}) {
  if (isLoading) {
    return (
      <div className="query-state query-state-loading" role="status" aria-live="polite">
        <span className="query-state-spinner" aria-hidden="true" />
        <p className="query-state-message">{loadingLabel}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="query-state query-state-error" role="alert" aria-live="assertive">
        <p className="query-state-message">{errorLabel}</p>
        {onRetry && (
          <button type="button" className="query-state-retry" onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="query-state query-state-empty" role="status" aria-live="polite">
        <p className="query-state-message">{emptyLabel}</p>
        {emptyHint && <p className="query-state-hint">{emptyHint}</p>}
      </div>
    );
  }

  return children ?? null;
}
