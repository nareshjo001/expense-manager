"use strict";

// The LLM-authored path for the monthly summary. js's buildMonthlySummary(), which the caller falls back to on any ok:false result here).

const { askLlm, LlmProviderError } = require("./llmService");
const config = require("./config");
const { buildMonthlySummaryPromptRequest } = require("./monthlySummaryPrompt");

// True only when SIA is enabled AND a provider is configured -- the same two-part gate askLlm() itself enforces (isMissingProvider / adapter lookup), checked here first so a disabled/unconfigured deployment never even attempts the request or pays its latency, and so generateLlmMonthlySummary() can report a clear, specific reasonCode instead of relying on askLlm() to throw.
function isLlmAvailable() {
  return config.enabled === true && typeof config.provider === "string" && config.provider.trim() !== "";
}

// Parse step, since a provider can return syntactically valid JSON that still doesn't match the schema we asked for (empty narrative, missing citedFactIds, wrong types).
function isValidStructuredShape(parsed) {
  return Boolean(
    parsed &&
    typeof parsed === "object" &&
    typeof parsed.narrative === "string" &&
    parsed.narrative.trim() !== "" &&
    Array.isArray(parsed.citedFactIds) &&
    parsed.citedFactIds.every((id) => typeof id === "string")
  );
}

// Js's buildMonthlySummary(): this function does not fetch or regenerate a report itself).
async function generateLlmMonthlySummary(report) {
  if (!isLlmAvailable()) {
    return { ok: false, reasonCode: "LLM_NOT_AVAILABLE" };
  }

  const request = buildMonthlySummaryPromptRequest(report);
  if (!Array.isArray(request.context?.facts) || request.context.facts.length === 0) {
    // Nothing eligible to summarize -- never send an empty-context request
    // to a provider just to get an empty/hallucinated narrative back.
    return { ok: false, reasonCode: "NO_ELIGIBLE_FACTS" };
  }

  let result;
  try {
    result = await askLlm(request);
  } catch (err) {
    if (err instanceof LlmProviderError) {
      return { ok: false, reasonCode: "PROVIDER_ERROR", provider: err.provider ?? config.provider };
    }
    // Any other unexpected throw is still normalized, never rethrown --
    // this module's whole contract is "never throws to its caller".
    return { ok: false, reasonCode: "PROVIDER_ERROR", provider: config.provider };
  }

  const parsed = result && result.structuredOutput;
  if (!isValidStructuredShape(parsed)) {
    return {
      ok: false,
      reasonCode: "INVALID_STRUCTURED_OUTPUT",
      provider: config.provider,
      latencyMs: result?.latencyMs,
    };
  }

  return {
    ok: true,
    narrative: parsed.narrative.trim(),
    citedFactIds: parsed.citedFactIds,
    provider: config.provider,
    model: result.model,
    latencyMs: result.latencyMs,
  };
}

module.exports = {
  generateLlmMonthlySummary,
  // Exposed for direct, isolated unit testing without mocking askLlm().
  isLlmAvailable,
  isValidStructuredShape,
};
