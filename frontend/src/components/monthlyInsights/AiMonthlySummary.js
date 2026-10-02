import {
  HiSparkles,
  HiArrowPath,
  HiChartBar,
  HiChartPie,
  HiCreditCard,
  HiExclamationTriangle,
  HiCalendarDays,
  HiShieldCheck,
  HiWallet,
  HiTag,
} from "react-icons/hi2";
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



// Determines the financial icon and color theme for each insight row
function getInsightIcon(sectionId, text) {
  if (sectionId === "opening") return { Icon: HiChartBar, tone: "spending" };
  if (sectionId === "budget") return { Icon: HiChartPie, tone: "budget" };
  if (sectionId === "category") return { Icon: HiCreditCard, tone: "category" };
  if (sectionId === "anomalies") return { Icon: HiExclamationTriangle, tone: "alert" };
  if (sectionId === "weeklyPattern") return { Icon: HiCalendarDays, tone: "pattern" };
  if (sectionId === "health") return { Icon: HiShieldCheck, tone: "health" };
  if (sectionId === "forecast") return { Icon: HiSparkles, tone: "forecast" };

  // Fallback for LLM path or undefined sectionId: inspect text keywords
  const lower = (text || "").toLowerCase();
  if (/budget|remaining|exceeded|utilization/.test(lower)) {
    return { Icon: HiChartPie, tone: "budget" };
  }
  if (/category|categories|spent the most|rose/.test(lower)) {
    return { Icon: HiCreditCard, tone: "category" };
  }
  if (/unusual|flagged|anomal/.test(lower)) {
    return { Icon: HiExclamationTriangle, tone: "alert" };
  }
  if (/spent|transaction|daily|average/.test(lower)) {
    return { Icon: HiChartBar, tone: "spending" };
  }
  if (/health|score|strength|weakness/.test(lower)) {
    return { Icon: HiShieldCheck, tone: "health" };
  }
  if (/week|recurring|spike|pattern/.test(lower)) {
    return { Icon: HiCalendarDays, tone: "pattern" };
  }
  return { Icon: HiSparkles, tone: "general" };
}

// Formats insight text with bold emphasis on monetary values, percentages, counts, and category names
function formatHighlightedText(text, categories = []) {
  if (!text) return null;

  const escapedCategories = categories
    .filter(Boolean)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const regexPattern = escapedCategories
    ? `(₹[\\d,]+(?:\\.\\d+)?|[\\d,.]+%|\\b\\d+\\s+transactions?\\b|\\b\\d+\\b(?=\\s+unusually|\\s+unusual)|\\b(?:${escapedCategories})\\b)`
    : `(₹[\\d,]+(?:\\.\\d+)?|[\\d,.]+%|\\b\\d+\\s+transactions?\\b|\\b\\d+\\b(?=\\s+unusually|\\s+unusual))`;

  const regex = new RegExp(regexPattern, "gi");
  const parts = text.split(regex);

  return parts.map((part, idx) => {
    regex.lastIndex = 0;
    if (regex.test(part)) {
      return (
        <strong key={idx} className="ai-summary-highlight">
          {part}
        </strong>
      );
    }
    return part;
  });
}

// Extracts key metrics from citedFacts to render in the bottom summary metric strip
function extractSummaryMetrics(result) {
  if (!result) return [];

  const facts = result.citedFacts || [];
  const factsById = new Map(facts.map((f) => [f.factId, f]));

  const metrics = [];

  // Metric 1: Total spent
  const spentFact = factsById.get("summary.totalSpent");
  if (spentFact && spentFact.value != null) {
    metrics.push({
      id: "spent",
      Icon: HiWallet,
      tone: "spending",
      value: `₹${Math.round(Number(spentFact.value))}`,
      label: "spent",
    });
  }

  // Metric 2: Budget utilization
  const budgetFact = factsById.get("budgets.utilization");
  if (budgetFact && budgetFact.value != null) {
    const rounded = Math.round(Number(budgetFact.value) * 100) / 100;
    metrics.push({
      id: "budget",
      Icon: HiChartPie,
      tone: "budget",
      value: `${rounded}%`,
      label: "budget used",
    });
  }

  // Metric 3: Top category
  const topCatFact = factsById.get("categories.monthly.topCategory.category");
  if (topCatFact && topCatFact.value) {
    metrics.push({
      id: "top-category",
      Icon: HiTag,
      tone: "category",
      value: String(topCatFact.value),
      label: "top category",
    });
  }

  // Metric 4: Unusual transactions (flagged anomalies)
  const anomalyFact = factsById.get("anomalies.flaggedCount");
  if (anomalyFact && anomalyFact.value != null) {
    const count = Number(anomalyFact.value);
    metrics.push({
      id: "anomalies",
      Icon: HiExclamationTriangle,
      tone: "alert",
      value: String(count),
      label: count === 1 ? "unusual transaction" : "unusual transactions",
    });
  }

  // Fallbacks if fewer than 4 metrics found:
  if (metrics.length < 4) {
    const txCountFact = factsById.get("summary.transactionCount");
    if (txCountFact && txCountFact.value != null && !metrics.some((m) => m.id === "tx-count")) {
      metrics.push({
        id: "tx-count",
        Icon: HiChartBar,
        tone: "spending",
        value: String(txCountFact.value),
        label: "transactions",
      });
    }
  }

  if (metrics.length < 4) {
    const forecastFact = factsById.get("forecast.nextMonthEstimate");
    if (forecastFact && forecastFact.value != null && !metrics.some((m) => m.id === "forecast")) {
      metrics.push({
        id: "forecast",
        Icon: HiSparkles,
        tone: "general",
        value: `₹${Math.round(Number(forecastFact.value))}`,
        label: "projected next",
      });
    }
  }

  return metrics;
}

function GeneratedSummary({ result }) {
  const hasSections = Array.isArray(result.sections) && result.sections.length > 0;

  // Extract category names to highlight in text
  const categories = (result.citedFacts || [])
    .filter((f) => f.factId.includes("Category") || f.factId.includes("category"))
    .map((f) => String(f.value))
    .filter(Boolean);

  const metrics = extractSummaryMetrics(result);

  return (
    <div className="ai-summary-result">
      {/* 1. Summary Content Panel: soft-pink inner panel with individual insight rows */}
      <div className="ai-summary-panel">
        {hasSections ? (
          <div className="ai-summary-sections">
            {result.sections.map((section) => {
              const { Icon, tone } = getInsightIcon(section.id, section.text);
              return (
                <div key={section.id} className={`ai-summary-insight-row ai-summary-row-${tone}`}>
                  <div className={`ai-summary-insight-icon-badge ai-summary-badge-${tone}`} aria-hidden="true">
                    <Icon size={18} />
                  </div>
                  <div className="ai-summary-insight-content">
                    <p className="ai-summary-section-text">
                      {formatHighlightedText(section.text, categories)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="ai-summary-narrative-container">
            {result.narrative ? (
              <div className="ai-summary-sections">
                {result.narrative
                  .split(/(?<=[.?!])\s+(?=[A-Z0-9₹])/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((sentence, index) => {
                    const { Icon, tone } = getInsightIcon(null, sentence);
                    return (
                      <div key={index} className={`ai-summary-insight-row ai-summary-row-${tone}`}>
                        <div className={`ai-summary-insight-icon-badge ai-summary-badge-${tone}`} aria-hidden="true">
                          <Icon size={18} />
                        </div>
                        <div className="ai-summary-insight-content">
                          <p className="ai-summary-section-text ai-summary-narrative">
                            {formatHighlightedText(sentence, categories)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* 2. Summary Metric Strip: compact row of key metrics */}
      {metrics.length > 0 && (
        <div className="ai-summary-metrics-strip">
          {metrics.map((metric) => {
            const MetricIcon = metric.Icon;
            return (
              <div key={metric.id} className="ai-summary-metric-card">
                <div className={`ai-summary-metric-icon-tile ai-summary-badge-${metric.tone}`} aria-hidden="true">
                  <MetricIcon size={20} />
                </div>
                <div className="ai-summary-metric-text-group">
                  <span className="ai-summary-metric-value">{metric.value}</span>
                  <span className="ai-summary-metric-label">{metric.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AiMonthlySummary() {
  const preferenceQuery = useAiSummaryPreferenceQuery();
  const optInMutation = useSaveAiSummaryOptInMutation();
  const generateMutation = useGenerateAiMonthlySummaryMutation();

  const preference = preferenceQuery.data?.data;
  const summaryData = generateMutation.data?.data;

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
      {/* Decorative AI visual on right -- rendered only in initial ungenerated state */}
      {!summaryData && (
        <div className="ai-summary-art-container" aria-hidden="true">
          <div className="ai-summary-art-glow" />
          <div className="ai-summary-art-sparkle-left">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="#f472b6">
              <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
            </svg>
          </div>
          <div className="ai-summary-art-card">
            <div className="ai-summary-art-line-pill" />
            <div className="ai-summary-art-line" />
            <div className="ai-summary-art-line" />
            <div className="ai-summary-art-line" />
          </div>
          <div className="ai-summary-art-sparkle-top">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#ec4899">
              <path d="M12 0L14.5 9.5L24 12L14.5 14.5L12 24L9.5 14.5L0 12L9.5 9.5L12 0Z" />
            </svg>
          </div>
        </div>
      )}

      <div className="ai-summary-inner">
        <div className="ai-summary-top-row">
          <div className="ai-summary-card-head">
            <div className="ai-summary-icon-tile">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3.5" y="4.5" width="13" height="16" rx="2.5" stroke="#db2777" strokeWidth="1.75" />
                <line x1="6.5" y1="9" x2="11.5" y2="9" stroke="#db2777" strokeWidth="1.75" strokeLinecap="round" />
                <line x1="6.5" y1="12.5" x2="13.5" y2="12.5" stroke="#db2777" strokeWidth="1.75" strokeLinecap="round" />
                <line x1="6.5" y1="16" x2="10.5" y2="16" stroke="#db2777" strokeWidth="1.75" strokeLinecap="round" />
                <path d="M19 1.5L19.8 4.2L22.5 5L19.8 5.8L19 8.5L18.2 5.8L15.5 5L18.2 4.2L19 1.5Z" fill="#db2777" />
                <path d="M15 8L15.5 9.5L17 10L15.5 10.5L15 12L14.5 10.5L13 10L14.5 9.5L15 8Z" fill="#db2777" />
              </svg>
            </div>
            <div className="ai-summary-head-text-group">
              <h1 className="ai-summary-h-text">Monthly AI Summary</h1>
              <p className="ai-summary-p-text">A written recap of this month's report, grounded in your own numbers.</p>

              {/* Source badge and period label below subtitle when summary is generated */}
              {summaryData && (
                <div className="ai-summary-meta-row">
                  <span className={`ai-summary-source-badge ai-summary-source-${summaryData.source}`}>
                    {summaryData.source === "llm" ? "AI-generated" : "Template-based"}
                  </span>
                  {summaryData.periodLabel && (
                    <>
                      <span className="ai-summary-meta-divider" aria-hidden="true">|</span>
                      <span className="ai-summary-period">{summaryData.periodLabel}</span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {preference?.optedIn && (
            <div className="ai-summary-regen-badge">
              <span className="ai-summary-regen-count">
                <HiArrowPath className="ai-summary-regen-icon" aria-hidden="true" />
                {preference.regenerationsRemaining} of {preference.regenerationsUsed + preference.regenerationsRemaining} regenerations left this month
              </span>
            </div>
          )}
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
              <div className="ai-summary-controls-row">
                <label className="ai-summary-optin-label">
                  <input
                    type="checkbox"
                    className="ai-summary-checkbox-custom"
                    checked={!!preference.optedIn}
                    onChange={handleToggleOptIn}
                    disabled={optInMutation.isPending}
                  />
                  <span>Enable monthly AI summary</span>
                </label>

                {preference.optedIn && (
                  <button
                    type="button"
                    className="ai-summary-generate-btn"
                    onClick={handleGenerate}
                    disabled={generateMutation.isPending || preference.regenerationsRemaining <= 0}
                  >
                    <HiSparkles className="ai-summary-btn-sparkle" aria-hidden="true" />
                    {generateMutation.isPending
                      ? "Generating..."
                      : summaryData
                      ? "Regenerate summary"
                      : "Generate summary"}
                  </button>
                )}
              </div>

              {preference.optedIn && (
                <>
                  {preference.regenerationsRemaining <= 0 && !summaryData && (
                    <p className="ai-summary-limit-note">You've used all of this month's regenerations.</p>
                  )}

                  {summaryData && <GeneratedSummary result={summaryData} />}
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
    </div>
  );
}
