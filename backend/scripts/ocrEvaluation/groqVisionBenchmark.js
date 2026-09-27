"use strict";

// OCR-006-T04 -- offline structured-output benchmark against a real
// vision-model provider, run against the SAME corpus T02 measured the
// traditional (Tesseract) OCR ceiling against (corpus/manifest.json,
// backend/scripts/ocrEvaluation/corpus/images).
//
// Supports two providers, both zero-cost, both verified live against this
// corpus:
//
//   groq   -- kept for the file name/history, but NOT currently usable:
//             both of Groq's vision-capable models were retired
//             (meta-llama/llama-4-scout-17b-16e-instruct, deprecated
//             2026-07-17; meta-llama/llama-4-maverick-17b-128e-instruct,
//             deprecated 2026-03-09), replaced by openai/gpt-oss-120b,
//             which is text-only. Confirmed live via GET
//             /openai/v1/models against a real key: no image-capable
//             model is offered to any account any more. Left in this file
//             (provider config + tests) so the OCR-006-T03 privacy
//             reasoning about Groq's Services Agreement stays attached to
//             working code if Groq ever reintroduces a vision model.
//   ollama -- runs entirely on the maintainer's own machine via Ollama's
//             OpenAI-compatible endpoint (http://localhost:11434, no key,
//             no network egress, no third party ever sees a receipt
//             image). This is what OCR-006-T04's actual numbers are
//             from. Default model: qwen3-vl:4b (`ollama pull qwen3-vl:4b`,
//             ~3.3GB, general-purpose vision+instruction-following, runs
//             on modest/CPU-only hardware). glm-ocr is a smaller
//             OCR-specialist alternative if a receipt's total/date still
//             isn't legible to qwen3-vl:4b, but specialist OCR models are
//             tuned for raw transcription and may not reliably follow the
//             structured-JSON instruction below -- try qwen3-vl first.
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
//   ollama pull qwen3-vl:4b   # once
//   node scripts/ocrEvaluation/groqVisionBenchmark.js --provider=ollama
//   node scripts/ocrEvaluation/groqVisionBenchmark.js --provider=ollama --limit=3
//
// The ollama provider needs nothing but a running local `ollama serve`;
// the groq provider (if Groq ever ships a vision model again) needs
// GROQ_API_KEY and real internet access -- run it from an ordinary
// terminal, not this repo's device-bridge/cloud sandbox, both of which
// sit behind an egress allowlist that does not include api.groq.com.

const fs = require("fs");
const path = require("path");

const { amountMatches, dateMatches, merchantMatches } = require("./scoring");

const CORPUS_DIR = path.join(__dirname, "corpus");
const MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");
const RESULTS_DIR = path.join(__dirname, "results");

const DEFAULT_TIMEOUT_MS = 30000;

// PROVIDERS -- everything that differs between a hosted API and a local
// Ollama server. `needsKey: false` means no Authorization header is
// required at all (Ollama ignores whatever is sent); `delayMs` is the
// per-request pacing needed to stay under a free-tier rate limit (0 for a
// local server, since there is no rate limit to respect).
const PROVIDERS = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    needsKey: true,
    apiKeyEnvVar: "GROQ_API_KEY",
    delayMs: 2200, // free tier: 30 req/min; 21 entries well under it even serially.
  },
  ollama: {
    url: "http://localhost:11434/v1/chat/completions",
    defaultModel: "qwen3-vl:4b",
    needsKey: false,
    apiKeyEnvVar: null,
    delayMs: 0,
  },
};

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
async function callVisionApi({ url, apiKey, imagePath, model, fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || "unused"}`,
      },
      body: JSON.stringify({
        model,
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
  const args = { limit: null, delayMs: null, model: null, provider: "groq", baseUrl: null };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "limit") args.limit = Number(value);
    else if (key === "delay-ms") args.delayMs = Number(value);
    else if (key === "model") args.model = value;
    else if (key === "provider") args.provider = value;
    else if (key === "base-url") args.baseUrl = value;
  }
  const providerConfig = PROVIDERS[args.provider];
  if (!providerConfig) {
    throw new Error(`Unknown --provider "${args.provider}". Known providers: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  return {
    limit: args.limit,
    provider: args.provider,
    model: args.model || providerConfig.defaultModel,
    url: args.baseUrl || providerConfig.url,
    delayMs: args.delayMs !== null ? args.delayMs : providerConfig.delayMs,
    needsKey: providerConfig.needsKey,
    apiKeyEnvVar: providerConfig.apiKeyEnvVar,
  };
};

const toMarkdown = (meta, agg, results) => {
  const lines = [
    `# ${meta.provider} vision-model benchmark (OCR-006-T04)`,
    "",
    `Run at: ${meta.runAt}`,
    `Provider: ${meta.provider}    Model: ${meta.model}`,
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
  const args = parseArgs(process.argv.slice(2));
  const apiKey = args.needsKey ? process.env[args.apiKeyEnvVar] : "unused";
  if (args.needsKey && !apiKey) {
    console.error(`${args.apiKeyEnvVar} is not set. Get a free key and set it in your shell.`);
    process.exitCode = 1;
    return;
  }
  const manifest = loadManifest();
  const entries = args.limit ? manifest.entries.slice(0, args.limit) : manifest.entries;

  const results = [];
  for (const entry of entries) {
    const imagePath = path.join(CORPUS_DIR, entry.image);
    // Deliberately serial (not Promise.all): stays under a hosted free-tier's RPM limit
    // (a no-op consideration for the local ollama provider, whose delayMs defaults to 0).
    const res = await callVisionApi({ url: args.url, apiKey, imagePath, model: args.model, fetchImpl: fetch, timeoutMs: DEFAULT_TIMEOUT_MS });
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
  const meta = { runAt: new Date().toISOString(), provider: args.provider, model: args.model, corpusType: manifest.corpusType };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(RESULTS_DIR, `vision-${args.provider}-latest.json`), JSON.stringify({ meta, aggregate: agg, results }, null, 2));
  const md = toMarkdown(meta, agg, results);
  fs.writeFileSync(path.join(RESULTS_DIR, `vision-${args.provider}-latest.md`), md);

  console.log("\n" + md);
}

module.exports = {
  PROVIDERS,
  mimeTypeFor,
  buildDataUri,
  extractJsonFromContent,
  callVisionApi,
  scoreVisionEntry,
  aggregate,
  parseArgs,
  toMarkdown,
};

if (require.main === module) {
  main();
}
