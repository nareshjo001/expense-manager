"use strict";

// Json, backend/scripts/ocrEvaluation/corpus/images).

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const { amountMatches, dateMatches, merchantMatches } = require("./scoring");

const CORPUS_DIR = path.join(__dirname, "corpus");
const MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");
const RESULTS_DIR = path.join(__dirname, "results");

const DEFAULT_TIMEOUT_MS = 30000;

// PROVIDERS -- everything that differs between a hosted API and a local Ollama server.
const PROVIDERS = {
  groq: {
    url: "https://api.groq.com/openai/v1/chat/completions",
    defaultModel: "meta-llama/llama-4-scout-17b-16e-instruct",
    needsKey: true,
    apiKeyEnvVar: "GROQ_API_KEY",
    delayMs: 2200, // free tier: 30 req/min; 21 entries well under it even serially.
    timeoutMs: 30000,
  },
  ollama: {
    url: "http://localhost:11434/v1/chat/completions",
    defaultModel: "qwen3-vl:4b",
    needsKey: false,
    apiKeyEnvVar: null,
    delayMs: 0,
    // CPU-only inference for a 4B vision model, plus a cold model-load on the very first request, routinely takes well over 30s per receipt -- that was the actual cause of every request timing out on first real run (2026-09-27, confirmed: server was up, model was pulled, requests were reaching Ollama, they just hadn't finished within the old default).
    timeoutMs: 600000,
    extraBody: { reasoning_effort: "none" },
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
  "    that reads as the amount actually paid). Write it as a plain decimal number exactly as",
  "    printed -- a total printed as 245.00 is the number 245.00 (or 245), NEVER 24500. Do not",
  "    multiply it or remove its decimal point. No currency symbol, no thousands separators.",
  "    null if no total is legible or present.",
  '  "currency": string or null -- your best guess at the currency (e.g. "INR", "IDR"), or null.',
  '  "date": string or null -- the receipt date as ISO 8601 (YYYY-MM-DD). null if no date is',
  "    legible or present. Do not invent a date.",
  '  "confidence": "high" | "medium" | "low" -- your own confidence in amount AND date together.',
  "Do not guess a value you cannot actually read on the image; return null instead.",
].join("\n");

// Strips a ```json ... parse.
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

// Node's global fetch() is built on undici, and undici's default Agent applies its OWN headersTimeout/bodyTimeout (300000ms) to every request -- independent of any AbortSignal a caller passes in.
const nodeFetch = (url, { method, headers, body, signal } = {}) =>
  new Promise((resolve, reject) => {
    const { hostname, port, pathname, search, protocol } = new URL(url);
    const transport = protocol === "https:" ? https : http;
    const req = transport.request({ hostname, port, path: `${pathname}${search}`, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (signal) {
      const onAbort = () => {
        req.destroy();
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    req.end(body);
  });

// fetchImpl is injectable so tests never make a real network call.
async function callVisionApi({ url, apiKey, imagePath, model, fetchImpl, timeoutMs, extraBody }) {
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
        ...extraBody,
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
    const message = err?.message || String(err);
    const cause = err?.cause?.message;
    return { ok: false, status: null, error: cause ? `${message}: ${cause}` : message };
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
  const args = { limit: null, delayMs: null, model: null, provider: "groq", baseUrl: null, timeoutMs: null };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "limit") args.limit = Number(value);
    else if (key === "delay-ms") args.delayMs = Number(value);
    else if (key === "model") args.model = value;
    else if (key === "provider") args.provider = value;
    else if (key === "base-url") args.baseUrl = value;
    else if (key === "timeout-ms") args.timeoutMs = Number(value);
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
    timeoutMs: args.timeoutMs !== null ? args.timeoutMs : providerConfig.timeoutMs,
    needsKey: providerConfig.needsKey,
    apiKeyEnvVar: providerConfig.apiKeyEnvVar,
    extraBody: providerConfig.extraBody,
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
    const res = await callVisionApi({ url: args.url, apiKey, imagePath, model: args.model, fetchImpl: nodeFetch, timeoutMs: args.timeoutMs, extraBody: args.extraBody });
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
  PROMPT,
  mimeTypeFor,
  buildDataUri,
  extractJsonFromContent,
  nodeFetch,
  callVisionApi,
  scoreVisionEntry,
  aggregate,
  parseArgs,
  toMarkdown,
};

if (require.main === module) {
  main();
}
