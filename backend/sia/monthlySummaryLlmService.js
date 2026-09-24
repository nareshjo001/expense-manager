"use strict";

// AI-001-T03 -- the LLM-authored path for the monthly summary. This module
// NEVER throws to its caller: every failure (no provider configured, a
// provider error, malformed/invalid structured output, a schema-invalid
// parsed shape) normalizes into { ok: false, reasonCode }, matching this
// feature's outcome statement ("a non-LLM template fallback" must always be
// available -- see monthlySummaryService.js's buildMonthlySummary(), which
// the caller falls back to on any ok:false result here). This module does
// not decide WHETHER the LLM path should be attempted (that opt-in/enabled
// decision belongs to AI-001-T05's caller) and does not validate the
// answer's factual claims (that is AI-001-T04's monthlySummaryValidator.js,
// a separate, deliberately independent check run by the same caller).

const { askLlm, LlmProviderError } = require("./llmService");
const config = require("./config");
const { buildMonthlySummaryPromptRequest } = require("./monthlySummaryPrompt");

// True only when SIA is enabled AND a provider is configured -- the same
// two-part gate askLlm() itself enforces (isMissingProvider / adapter
// lookup), checked here first so a disabled/unconfigured deployment never
// even attempts the request or pays its latency, and so
// generateLlmMonthlySummary() can report a clear, specific reasonCode
// instead of relying on askLlm() to throw.
function isLlmAvailable() {
  return config.enabled === true && typeof config.provider === "string" && config.provider.trim() !== "";
}

// Narrow shape check on the parsed structured-output JSON -- separate from
// (and stricter than) llmService.js's own JSON.parse step, since a
// provider can return syntactically valid JSON that still doesn't match
// the schema we asked for (empty narrative, missing citedFactIds, wrong
// types). Never throws.
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

// Generates the LLM-authored monthly summary for an already-current report
// (same contract as monthlySummaryService.js's buildMonthlySummary(): this
// function does not fetch or regenerate a report itself). Returns:
//   { ok: true, narrative, citedFactIds, provider, model, latencyMs }
//   { ok: false, reasonCode, provider?, latencyMs? }
// reasonCode is one of: LLM_NOT_AVAILABLE | NO_ELIGIBLE_FACTS |
// PROVIDER_ERROR | INVALID_STRUCTURED_OUTPUT
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
