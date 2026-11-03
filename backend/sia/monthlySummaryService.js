"use strict";

// Template-only baseline monthly summary.

const { getFact } = require("../analytics/monthlySummaryFacts");
// T03/T04 -- the optional LLM-authored path and its numeric-claim validator.
const { generateLlmMonthlySummary } = require("./monthlySummaryLlmService");
const { validateMonthlySummaryAnswer } = require("./monthlySummaryValidator");
// Js's existing generic "sia_provider" operation metrics (OBS-001-T05), which record every SIA LLM call -- chat included -- under the provider's own name and cannot distinguish a monthly-summary call from a chat call.
const { recordOperation } = require("../utils/metrics");

// Collects every citedFactId a section actually used and resolves them once, in call order, for the caller's citedFacts array -- so a fact referenced twice (rare, but possible if two sections cite the same metric) only appears once.
const buildCitedFacts = (report, factIds) => {
  const seen = new Set();
  const citedFacts = [];
  factIds.forEach((factId) => {
    if (seen.has(factId)) return;
    const fact = getFact(report, factId);
    if (!fact) return; // defensive: a section should never cite an ineligible fact, but never trust that blindly
    seen.add(factId);
    citedFacts.push(fact);
  });
  return citedFacts;
};

const round1 = (value) => Math.round(value * 10) / 10;

// -- Section builders ------------------------------------------------- Each returns { id, text, citedFactIds } or null when its required facts aren't eligible.

const buildOpeningSection = (report) => {
  const totalSpent = getFact(report, "summary.totalSpent");
  const transactionCount = getFact(report, "summary.transactionCount");
  if (!totalSpent || !transactionCount) return null;

  const cited = ["summary.totalSpent", "summary.transactionCount"];
  let text = `You spent ₹${totalSpent.value} across ${transactionCount.value} transaction${
    transactionCount.value === 1 ? "" : "s"
  } this month`;

  const isNewSpending = getFact(report, "trends.monthlyTrend.isNewSpending");
  const pctChange = getFact(report, "trends.monthlyTrend.percentageChange");
  const direction = getFact(report, "trends.monthlyTrend.direction");

  if (isNewSpending && isNewSpending.value === true) {
    text += ", compared to no recorded spending last month";
    cited.push("trends.monthlyTrend.isNewSpending");
  } else if (pctChange && direction) {
    if (direction.value === "same") {
      text += ", about the same as last month";
    } else {
      const verb = direction.value === "up" ? "up" : "down";
      text += `, ${verb} ${Math.abs(pctChange.value)}% from last month`;
    }
    cited.push("trends.monthlyTrend.percentageChange", "trends.monthlyTrend.direction");
  }
  text += ".";

  return { id: "opening", text, citedFactIds: cited };
};

const buildBudgetSection = (report) => {
  const status = getFact(report, "budgets.status");
  if (!status) return null;
  const cited = ["budgets.status"];

  if (status.value === "Overspent") {
    const exceededBy = getFact(report, "budgets.exceededBy");
    if (exceededBy) {
      cited.push("budgets.exceededBy");
      return {
        id: "budget",
        text: `Your budget was exceeded by ₹${exceededBy.value} this month.`,
        citedFactIds: cited,
      };
    }
  }

  const utilization = getFact(report, "budgets.utilization");
  const remaining = getFact(report, "budgets.remainingBudget");
  if (utilization && remaining) {
    cited.push("budgets.utilization", "budgets.remainingBudget");
    let text = `You've used ${utilization.value}% of this month's budget, with ₹${remaining.value} remaining.`;

    const projectedPct = getFact(report, "budgets.projectedOverspendPercent");
    if (projectedPct) {
      cited.push("budgets.projectedOverspendPercent");
      text += ` At the current pace, you're on track to exceed it by about ${projectedPct.value}%.`;
    }
    return { id: "budget", text, citedFactIds: cited };
  }

  return null;
};

const buildCategorySection = (report) => {
  const topCategory = getFact(report, "categories.monthly.topCategory.category");
  const topTotal = getFact(report, "categories.monthly.topCategory.total");
  if (!topCategory || !topTotal) return null;

  const cited = ["categories.monthly.topCategory.category", "categories.monthly.topCategory.total"];
  let text = `${topCategory.value} was your top spending category this month at ₹${topTotal.value}`;

  const concentration = getFact(report, "categories.monthly.top3Concentration");
  if (concentration) {
    cited.push("categories.monthly.top3Concentration");
    text += `, and your top 3 categories together account for ${concentration.value}% of spend`;
  }
  text += ".";

  const jumpCategory = getFact(report, "categories.monthly.biggestJump.category");
  const jumpPct = getFact(report, "categories.monthly.biggestJump.growthPercentage");
  if (jumpCategory && jumpPct) {
    cited.push("categories.monthly.biggestJump.category", "categories.monthly.biggestJump.growthPercentage");
    text += ` ${jumpCategory.value} rose the most, up ${jumpPct.value}% versus last month.`;
  }

  return { id: "category", text, citedFactIds: cited };
};

const buildWeeklyPatternSection = (report) => {
  const changeRatio = getFact(report, "insights.weeklyChange.changeRatio");
  const direction = getFact(report, "insights.weeklyChange.direction");
  const isSignificant = getFact(report, "insights.weeklyChange.isSignificant");

  if (changeRatio && direction && isSignificant && isSignificant.value === true && direction.value !== "same") {
    const pct = round1(changeRatio.value * 100);
    const verb = direction.value === "up" ? "risen" : "fallen";
    return {
      id: "weeklyPattern",
      text: `Spending this week has ${verb} noticeably (about ${pct}%) compared to last week.`,
      citedFactIds: [
        "insights.weeklyChange.changeRatio",
        "insights.weeklyChange.direction",
        "insights.weeklyChange.isSignificant",
      ],
    };
  }

  const classification = getFact(report, "insights.categoryPattern.classification");
  const dominantCategory = getFact(report, "insights.categoryPattern.dominantCategory");
  if (classification && dominantCategory) {
    const phrase = classification.value === "Spike" ? "a one-off spike" : "a steady, recurring habit";
    return {
      id: "weeklyPattern",
      text: `Your ${dominantCategory.value} spending looks like ${phrase} rather than a random change.`,
      citedFactIds: ["insights.categoryPattern.classification", "insights.categoryPattern.dominantCategory"],
    };
  }

  return null;
};

const RISK_PHRASE = {
  Low: "low",
  Medium: "moderate",
  High: "elevated",
};

const buildHealthSection = (report) => {
  const overall = getFact(report, "financialHealth.overall");
  const risk = getFact(report, "financialHealth.risk");
  if (!overall || !risk) return null;

  const cited = ["financialHealth.overall", "financialHealth.risk"];
  const riskPhrase = RISK_PHRASE[risk.value] ?? risk.value.toLowerCase();
  let text = `Your overall financial health score is ${overall.value}, with ${riskPhrase} risk.`;

  const weaknessMetric = getFact(report, "financialHealth.topWeakness.metric");
  const weaknessValue = getFact(report, "financialHealth.topWeakness.value");
  if (weaknessMetric && weaknessValue) {
    cited.push("financialHealth.topWeakness.metric", "financialHealth.topWeakness.value");
    text += ` The area needing the most attention is ${weaknessMetric.value} (${weaknessValue.value}).`;
  } else {
    const strengthMetric = getFact(report, "financialHealth.topStrength.metric");
    const strengthValue = getFact(report, "financialHealth.topStrength.value");
    if (strengthMetric && strengthValue) {
      cited.push("financialHealth.topStrength.metric", "financialHealth.topStrength.value");
      text += ` Your strongest area is ${strengthMetric.value} (${strengthValue.value}).`;
    }
  }

  return { id: "health", text, citedFactIds: cited };
};

const buildAnomalySection = (report) => {
  const flaggedCount = getFact(report, "anomalies.flaggedCount");
  if (!flaggedCount) return null;

  const text =
    flaggedCount.value === 0
      ? "No unusually large transactions were flagged this month."
      : `${flaggedCount.value} unusually large transaction${flaggedCount.value === 1 ? " was" : "s were"} flagged this month, relative to your own spending history.`;

  return { id: "anomalies", text, citedFactIds: ["anomalies.flaggedCount"] };
};

const buildForecastSection = (report) => {
  const estimate = getFact(report, "forecast.nextMonthEstimate");
  if (!estimate) return null;

  return {
    id: "forecast",
    text: `Based on your recent spending pattern, next month is projected at about ₹${estimate.value}.`,
    citedFactIds: ["forecast.nextMonthEstimate"],
  };
};

const SECTION_BUILDERS = [
  buildOpeningSection,
  buildBudgetSection,
  buildCategorySection,
  buildWeeklyPatternSection,
  buildHealthSection,
  buildAnomalySection,
  buildForecastSection,
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const resolvePeriodLabel = (report) => {
  const period = report?.metadata?.reportPeriod;
  if (!period || !Number.isInteger(period.month) || !Number.isInteger(period.year)) return null;
  const monthName = MONTH_NAMES[period.month - 1];
  return monthName ? `${monthName} ${period.year}` : null;
};

// Js's getReport()/refreshReport() output -- this function does not fetch or regenerate a report itself; callers own that).
const buildMonthlySummary = (report) => {
  const generatedAt = new Date().toISOString();
  const contractVersion = typeof report?.metadata?.version === "number" ? report.metadata.version : null;
  const periodLabel = resolvePeriodLabel(report);

  if (!report || report?.spending?.hasData !== true) {
    return {
      hasData: false,
      isFallback: true,
      contractVersion,
      periodLabel,
      generatedAt,
      narrative: "No expenses have been recorded yet this month, so there isn't a summary to show.",
      sections: [],
      citedFacts: [],
    };
  }

  const sections = SECTION_BUILDERS.map((build) => build(report)).filter(Boolean);

  const allCitedFactIds = sections.flatMap((section) => section.citedFactIds);
  const citedFacts = buildCitedFacts(report, allCitedFactIds);

  const narrative = sections.map((section) => section.text).join(" ");

  return {
    hasData: true,
    isFallback: true,
    contractVersion,
    periodLabel,
    generatedAt,
    narrative,
    sections,
    citedFacts,
  };
};

// T03/T04 -- the single public entry point callers (AI-001-T05's opt-in/rate-limited route) should use.
async function generateMonthlySummaryInner(report, { allowLlm = false } = {}) {
  const templateResult = buildMonthlySummary(report);

  if (!allowLlm || templateResult.hasData !== true) {
    return { ...templateResult, source: "template" };
  }

  const llmResult = await generateLlmMonthlySummary(report);
  // Grounding signal #1: did the provider even return a usable, schema-valid structured response?
  recordOperation({
    scope: "ai_summary",
    operation: "llm_call",
    outcome: llmResult.ok ? "success" : "failure",
    durationMs: llmResult.latencyMs,
  });
  if (!llmResult.ok) {
    return { ...templateResult, source: "template", llmAttempted: true, llmReasonCode: llmResult.reasonCode };
  }

  const validation = validateMonthlySummaryAnswer({
    narrative: llmResult.narrative,
    citedFactIds: llmResult.citedFactIds,
    report,
  });
  // Grounding signal #2: of the responses the provider actually returned, how many pass AI-001-T04's numeric-claim/citation check?
  recordOperation({
    scope: "ai_summary",
    operation: "grounding_validation",
    outcome: validation.valid ? "success" : "failure",
  });
  if (!validation.valid) {
    return {
      ...templateResult,
      source: "template",
      llmAttempted: true,
      llmReasonCode: `VALIDATION_${validation.reasonCode}`,
    };
  }

  const citedFacts = buildCitedFacts(report, llmResult.citedFactIds);
  return {
    hasData: true,
    isFallback: false,
    contractVersion: templateResult.contractVersion,
    periodLabel: templateResult.periodLabel,
    generatedAt: new Date().toISOString(),
    narrative: llmResult.narrative,
    sections: null, // no per-sentence section breakdown for LLM-authored prose -- citedFacts still supports AI-001-T06's rendering
    citedFacts,
    source: "llm",
    provider: llmResult.provider,
    model: llmResult.model,
    llmLatencyMs: llmResult.latencyMs,
  };
}

async function generateMonthlySummary(report, opts = {}) {
  const startedAt = Date.now();
  try {
    const result = await generateMonthlySummaryInner(report, opts);
    // Overall wall-clock latency for this call, whichever path it took (template-only calls are cheap/synchronous; LLM calls include the provider round trip above).
    recordOperation({ scope: "ai_summary", operation: "generate", outcome: "success", durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    // GenerateMonthlySummaryInner() is not expected to throw (every failure inside it is normalized to a template fallback), but this catch exists so an unexpected bug here is itself visible as a metrics failure rather than only an unhandled rejection -- and it re-throws, since swallowing an unexpected error would hide it from the caller too.
    recordOperation({ scope: "ai_summary", operation: "generate", outcome: "failure", durationMs: Date.now() - startedAt });
    throw err;
  }
}

module.exports = {
  buildMonthlySummary,
  generateMonthlySummary,
};
