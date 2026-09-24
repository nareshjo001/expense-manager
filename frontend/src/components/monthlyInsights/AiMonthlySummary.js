import QueryState from "../common/QueryState";
import { useAiSummaryPreferenceQuery } from "../../hooks/queries/useAiSummaryPreferenceQuery";
import { useSaveAiSummaryOptInMutation } from "../../hooks/mutations/useSaveAiSummaryOptInMutation";
import { useGenerateAiMonthlySummaryMutation } from "../../hooks/mutations/useGenerateAiMonthlySummaryMutation";
import { expenseAddSuccessToast, expenseAddErrorToast } from "../alertsEffects/toastMessages";
import "./AiMonthlySummary.css";

// AI-001-T06 -- renders the opt-in monthly AI summary alongside its source
// facts. Two backend paths feed this component's "alongside prose"
// requirement differently (see sia/monthlySummaryService.js's
// generateMonthlySummary): the deterministic template returns per-section
// { id, text, citedFactIds }, so each sentence can show its own facts
// right next to it; the LLM-authored path returns sections: null (no
// per-sentence mapping is produced for LLM prose), so that case renders
// one narrative block with a single facts list underneath. Both paths
// always return the same flat, deduped `citedFacts` array this component
// falls back to either way.

function formatFactValue(fact) {
  if (fact.value === null || fact.value === undefined) return String(fact.value);
  if (typeof fact.value === "number") {
    const rounded = Math.round(fact.value * 100) / 100;
    if (fact.unit === "currency") return `₹${rounded}`;
    if (fact.unit === "percent") return `${rounded}%`;
    return String(rounded);
  }
  return String(fact.value);
}

function FactsList({ facts }) {
  if (!facts || facts.length === 0) return null;
  return (
    <ul className="ai-summary-facts-list">
      {facts.map((fact) => (
        <li key={fact.factId} className="ai-summary-fact">
          <span className="ai-summary-fact-label">{fact.label}</span>
          <span className="ai-summary-fact-value">{formatFactValue(fact)}</span>
        </li>
      ))}
    </ul>
  );
}

function GeneratedSummary({ result }) {
  const factsById = new Map((result.citedFacts || []).map((fact) => [fact.factId, fact]));
  const hasSections = Array.isArray(result.sections) && result.sections.length > 0;

  return (
    <div className="ai-summary-result">
      <div className="ai-summary-result-meta">
        <span className={`ai-summary-source-badge ai-summary-source-${result.source}`}>
          {result.source === "llm" ? "AI-generated" : "Template-based"}
        </span>
        {result.periodLabel && <span className="ai-summary-period">{result.periodLabel}</span>}
      </div>

      {hasSections ? (
        <div className="ai-summary-sections">
          {result.sections.map((section) => (
            <div key={section.id} className="ai-summary-section">
              <p className="ai-summary-section-text">{section.text}</p>
              <FactsList facts={(section.citedFactIds || []).map((id) => factsById.get(id)).filter(Boolean)} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="ai-summary-narrative">{result.narrative}</p>
          <div className="ai-summary-sources">
            <p className="ai-summary-sources-heading">Source facts</p>
            <FactsList facts={result.citedFacts} />
          </div>
        </>
      )}
    </div>
  );
}

export default function AiMonthlySummary() {
  const preferenceQuery = useAiSummaryPreferenceQuery();
  const optInMutation = useSaveAiSummaryOptInMutation();
  const generateMutation = useGenerateAiMonthlySummaryMutation();

  const preference = preferenceQuery.data?.data;

  const handleToggleOptIn = () => {
    const next = !preference?.optedIn;
    optInMutation.mutate(next, {
      onSuccess: () => {
        expenseAddSuccessToast({ message: next ? "AI summary enabled." : "AI summary disabled." });
      },
      onError: (error) => {
        expenseAddErrorToast({ message: error?.response?.data?.message || "Couldn't save this preference." });
      },
    });
  };

  const handleGenerate = () => {
    generateMutation.mutate(undefined, {
      onError: (error) => {
        expenseAddErrorToast({ message: error?.response?.data?.message || "Couldn't generate a summary right now." });
      },
    });
  };

  return (
    <div className="ai-summary-card">
      <div className="ai-summary-card-head">
        <h1 className="ai-summary-h-text">Monthly AI Summary</h1>
        <p className="ai-summary-p-text">A written recap of this month's report, grounded in your own numbers.</p>
      </div>

      <QueryState
        isLoading={preferenceQuery.isLoading}
        isError={preferenceQuery.isError}
        isEmpty={false}
        onRetry={preferenceQuery.refetch}
        loadingLabel="Loading your AI summary settings..."
        errorLabel="We couldn't load your AI summary settings."
      >
        {preference && (
          <div className="ai-summary-body">
            <div className="ai-summary-optin-row">
              <label className="ai-summary-optin-label">
                <input
                  type="checkbox"
                  checked={!!preference.optedIn}
                  onChange={handleToggleOptIn}
                  disabled={optInMutation.isPending}
                />
                Enable monthly AI summary
              </label>
              {preference.optedIn && (
                <span className="ai-summary-regen-count">
                  {preference.regenerationsRemaining} of {preference.regenerationsUsed + preference.regenerationsRemaining} regenerations left this month
                </span>
              )}
            </div>

            {preference.optedIn && (
              <>
                <button
                  type="button"
                  className="ai-summary-generate-btn"
                  onClick={handleGenerate}
                  disabled={generateMutation.isPending || preference.regenerationsRemaining <= 0}
                >
                  {generateMutation.isPending
                    ? "Generating..."
                    : generateMutation.data
                    ? "Regenerate summary"
                    : "Generate summary"}
                </button>

                {preference.regenerationsRemaining <= 0 && !generateMutation.data && (
                  <p className="ai-summary-limit-note">You've used all of this month's regenerations.</p>
                )}

                {generateMutation.data?.data && <GeneratedSummary result={generateMutation.data.data} />}
              </>
            )}

            {!preference.optedIn && (
              <p className="ai-summary-optin-hint">
                Turn this on to generate a narrative summary of your month, grounded only in your own report data --
                every number in it traces back to a fact from your report.
              </p>
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}
