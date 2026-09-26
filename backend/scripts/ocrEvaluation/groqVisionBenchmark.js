"use strict";

// OCR-006-T04 -- offline structured-output benchmark against a real,
// hosted vision-model provider, run against the SAME corpus T02 measured
// the traditional (Tesseract) OCR ceiling against
// (corpus/manifest.json, backend/scripts/ocrEvaluation/corpus/images).
//
// Provider: Groq (meta-llama/llama-4-scout-17b-16e-instruct, free tier).
// Chosen per OCR-006-T03's provider/privacy review plus the maintainer's
// explicit "free model, can't pay for this" constraint: Groq's Services
// Agreement (Section 4.2) contractually prohibits training on Inputs or
// Outputs on every tier, including free, and offers a self-serve Zero Data
// Retention toggle -- the same bar OpenAI/Gemini were held to in T03.
// Gemini's free tier was excluded there for the opposite reason (it DOES
// train on submitted data); this script never talks to Gemini.
//
// This is a manual, on-demand tool, not a CI gate, for two reasons: (1) it
// needs a real network call to a third-party API with a real API key,
// which this repo's CI/cloud sandbox environments cannot make (see
// corpus/README.md's note about eval:ocr for the same reason); (2) unlike
// runEvaluation.js's exact-match pass/fail against Tesseract, this run's
// PURPOSE is producing the raw numbers for OCR-006-T04/T05, not gating a
// build.
//
// Deliberately does NOT reuse scoring.js's scoreEntry(): that function's
// pass/fail gate also asserts reviewReasons against Tesseract-specific
// confidence-derived codes (LOW_AMOUNT_CONFIDENCE, NO_AMOUNT_FOUND, ...)
// that describe how the OCR+regex pipeline reasons about a receipt, not
// how a vision model does. Asserting those here would score a vision
// model against a taxonomy that was never meant to describe it. Amount
// and date matching (the two fields that put a number in someone's
// finances) ARE reused as-is from scoring.js for a fair, identical
// comparison against T02's numbers.
//
// Usage:
//   GROQ_API_KEY=gsk_... node scripts/ocrEvaluation/groqVisionBenchmark.js
//   node scripts/ocrEvaluation/groqVisionBenchmark.js --limit=3 --delay-ms=500
//
// Needs network access to api.groq.com; run it from an ordinary terminal
// with real internet access, not this repo's device-bridge/cloud sandbox
// (both are behind an egress allowlist that does not include api.groq.com).

const fs = require("fs");
const path = require("path");

const { amountMatches, dateMatches, merchantMatches } = require("./scoring");

const CORPUS_DIR = path.join(__dirname, "corpus");
const MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");
const RESULTS_DIR = path.join(__dirname, "results");

const DEFAULT_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_DELAY_MS = 2200; // free tier: 30 req/min: 21 entries well under it even serially.
const DEFAULT_TIMEOUT_MS = 30000;

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const mimeTypeFor = (imagePath) => MIME_BY_EXT[path.extname(imagePath).toLowerCase()] || "application/octet-stream";

const loadManifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const buildDataUri = (imagePath) => {
  const buffer = fs.readFileSync(imagePath);
  return `data:${mimeTypeFor(imagePath)};base64,${buffer.toString("base64")}`;
};

const PROMPT = [
  "You are extracting structured data from a photo of a retail/restaurant receipt.",
  "Return ONLY a single JSON object, no markdown fences, no commentary, with exactly these keys:",
  '  "merchantName": string or null -- the business name printed on the receipt.',
  '  "amount": number or null -- the final total the customer paid (prefer a line labelled',
  "    Grand Total/Total over a pre-tax Sub Total; if several totals conflict, pick the one",
  "    that reads as the amount actually paid). Digits only, no currency symbol, no thousands",
  "    separators. null if no total is legible or present.",
  '  "currency": string or null -- your best guess at the currency (e.g. "INR", "IDR"), or null.',
  '  "date": string or null -- the receipt date as ISO 8601 (YYYY-MM-DD). null if no date is',
  "    legible or present. Do not invent a date.",
  '  "confidence": "high" | "medium" | "low" -- your own confidence in amount AND date together.',
  "Do not guess a value you cannot actually read on the image; return null instead.",
].join("\n");

// Strips a ```json ... ``` (or bare ```) fence if the model added one anyway,
// and takes the first {...} block found, so a stray leading/trailing
// sentence doesn't break JSON.parse.
const extractJsonFromContent = (content) => {
  const text = String(content ?? "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// fetchImpl is injectable so tests never make a real network call.
async function callGroqVision({ apiKey, imagePath, model, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(GROQ_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: buildDataUri(imagePath) } },
            ],
          },
        ],
      }),
    });
    const bodyText = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, error: bodyText.slice(0, 500) };
    }
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return { ok: false, status: res.status, error: "response was not valid JSON" };
    }
    const content = body?.choices?.[0]?.message?.content;
    const parsed = extractJsonFromContent(content);
    if (!parsed) {
      return { ok: false, status: res.status, error: "model reply did not contain parseable JSON", raw: content };
    }
    return { ok: true, status: res.status, parsed, raw: content };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, status: null, error: `timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms` };
    }
    return { ok: false, status: null, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Deliberately independent of scoring.js's scoreEntry() -- see file header.
const scoreVisionEntry = (entry, parsed) => {
  const groundTruth = entry.groundTruth || {};
  const merchantMatch = merchantMatches(parsed?.merchantName, groundTruth.expenseName);
  const amountMatch = amountMatches(typeof parsed?.amount === "number" ? parsed.amount : null, groundTruth.expenseAmount);
  const dateMatch = dateMatches(parsed?.date, groundTruth.expenseDate);
  return {
    id: entry.id,
    source: entry.source,
    passed: amountMatch && dateMatch,
    merchantMatch,
    amountMatch,
    dateMatch,
    extracted: {
      merchantName: parsed?.merchantName ?? null,
      amount: parsed?.amount ?? null,
      currency: parsed?.currency ?? null,
      date: parsed?.date ?? null,
      confidence: parsed?.confidence ?? null,
    },
    groundTruth: {
      expenseName: groundTruth.expenseName ?? null,
      expenseAmount: groundTruth.expenseAmount ?? null,
      expenseDate: groundTruth.expenseDate ?? null,
    },
  };
};

const percent = (numerator, denominator) => (denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0);

const aggregate = (results) => {
  const total = results.length;
  const scored = results.filter((r) => !r.callFailed);
  const passed = scored.filter((r) => r.passed).length;
  return {
    total,
    callFailed: results.filter((r) => r.callFailed).length,
    scored: scored.length,
    passed,
    failed: scored.length - passed,
    passRate: percent(passed, scored.length),
    amountMatchRate: percent(scored.filter((r) => r.amountMatch).length, scored.length),
    dateMatchRate: percent(scored.filter((r) => r.dateMatch).length, scored.length),
    merchantMatchRate: percent(scored.filter((r) => r.merchantMatch).length, scored.length),
    failingIds: scored.filter((r) => !r.passed).map((r) => r.id),
    callFailedIds: results.filter((r) => r.callFailed).map((r) => r.id),
  };
};

const parseArgs = (argv) => {
  const args = { limit: null, delayMs: DEFAULT_DELAY_MS, model: DEFAULT_MODEL };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "limit") args.limit = Number(value);
    else if (key === "delay-ms") args.delayMs = Number(value);
    else if (key === "model") args.model = value;
  }
  return args;
};

const toMarkdown = (meta, agg, results) => {
  const lines = [
    "# Groq vision-model benchmark (OCR-006-T04)",
    "",
    `Run at: ${meta.runAt}`,
    `Model: ${meta.model}`,
    `Corpus: ${meta.corpusType} (${agg.total} entries; ${agg.scored} scored, ${agg.callFailed} API call failure(s))`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Pass rate (amount AND date) | ${agg.passRate}% (${agg.passed}/${agg.scored}) |`,
    `| Amount match rate | ${agg.amountMatchRate}% |`,
    `| Date match rate | ${agg.dateMatchRate}% |`,
    `| Merchant match rate (informational) | ${agg.merchantMatchRate}% |`,
    "",
  ];
  if (agg.failingIds.length) {
    lines.push("## Failing entries", "");
    for (const id of agg.failingIds) {
      const r = results.find((x) => x.id === id);
      lines.push(
        `- **${id}** (${r.source}): extracted amount=${r.extracted.amount}, date=${r.extracted.date}` +
          ` vs truth amount=${r.groundTruth.expenseAmount}, date=${r.groundTruth.expenseDate}` +
          ` (amountMatch=${r.amountMatch}, dateMatch=${r.dateMatch}, confidence=${r.extracted.confidence})`
      );
    }
    lines.push("");
  }
  if (agg.callFailedIds.length) {
    lines.push("## API call failures", "");
    for (const id of agg.callFailedIds) {
      const r = results.find((x) => x.id === id);
      lines.push(`- **${id}**: ${r.error}`);
    }
    lines.push("");
  }
  return lines.join("\n");
};

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error("GROQ_API_KEY is not set. Get a free key at https://console.groq.com and set it in your shell.");
    process.exitCode = 1;
    return;
  }
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const entries = args.limit ? manifest.entries.slice(0, args.limit) : manifest.entries;

  const results = [];
  for (const entry of entries) {
    const imagePath = path.join(CORPUS_DIR, entry.image);
    // Deliberately serial (not Promise.all): stays under the free-tier RPM limit.
    const res = await callGroqVision({ apiKey, imagePath, model: args.model, fetchImpl: fetch, timeoutMs: DEFAULT_TIMEOUT_MS });
    if (!res.ok) {
      console.log(`[FAIL-CALL] ${entry.id}: ${res.error}`);
      results.push({ id: entry.id, source: entry.source, callFailed: true, error: res.error });
    } else {
      const scored = scoreVisionEntry(entry, res.parsed);
      console.log(
        `[${scored.passed ? "PASS" : "FAIL"}] ${entry.id} (${entry.source}) amount=${scored.extracted.amount}` +
          ` date=${scored.extracted.date} confidence=${scored.extracted.confidence}`
      );
      results.push({ ...scored, callFailed: false });
    }
    if (args.delayMs) await sleep(args.delayMs);
  }

  const agg = aggregate(results);
  const meta = { runAt: new Date().toISOString(), model: args.model, corpusType: manifest.corpusType };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, "groq-vision-latest.json"), JSON.stringify({ meta, aggregate: agg, results }, null, 2));
  const md = toMarkdown(meta, agg, results);
  fs.writeFileSync(path.join(RESULTS_DIR, "groq-vision-latest.md"), md);

  console.log("\n" + md);
}

module.exports = {
  mimeTypeFor,
  buildDataUri,
  extractJsonFromContent,
  callGroqVision,
  scoreVisionEntry,
  aggregate,
  parseArgs,
  toMarkdown,
  DEFAULT_MODEL,
  GROQ_API_URL,
};

if (require.main === module) {
  main();
}
