"use strict";

// OCR-006-T01 -- failure corpus + failure taxonomy.
//
// OCR-006 (P3, vision-model OCR fallback) may only be planned once there is
// evidence of WHERE the current pipeline fails. "The receipt failed" is not
// enough to decide whether a stronger recognizer (e.g. a vision model) is
// worth its cost and privacy exposure: a failure where the correct value is
// already sitting in Tesseract's raw text is an extractor problem that a
// cheaper, deterministic fix can reach; only a failure where the recognizer
// never produced the value at all is a candidate for a better recognizer.
//
// This script runs the same real pipeline as runEvaluation.js
// (extractTextFromImage() -> parseReceipt() -> scoreEntry()), but also keeps
// the RAW OCR text, which runEvaluation.js's latest.json does not store,
// and classifies every failed field with the deterministic rules below.
//
// Nothing here talks to any network service: OCR is local Tesseract, and
// the only output is local JSON under results/ (gitignored run output).
//
// Usage (from backend/):
//   node scripts/ocrEvaluation/buildFailureCorpus.js           # real OCR run
//   node scripts/ocrEvaluation/buildFailureCorpus.js --reuse   # reuse results/raw-ocr-baseline.json
//
// ---------------------------------------------------------------------------
// Classification rule (documented in docs/ocr/OCR-006-T01-failure-corpus.md)
// ---------------------------------------------------------------------------
// For each failed field (a field is "failed" exactly when scoring.js says it
// does not match -- this script never re-scores):
//
//   recognition -- the correct value does NOT appear anywhere in the raw OCR
//                  text under the normalized matching rule for that field.
//                  The recognizer never produced it; no extractor change
//                  can recover it from this text.
//   extraction  -- the correct value DOES appear in the raw OCR text, but the
//                  extractor returned something else (or nothing).
//   derived     -- reviewReasons only: those codes are computed from the
//                  field results, not read off the receipt.
//
// A ground truth of null (the receipt genuinely has no amount/date) that
// the extractor filled anyway is "extraction" -- a false positive, which
// no recognizer change would fix.
//
// Recognition failures get a sub-category, "near-miss" when a token within
// one digit edit of the correct value is present (e.g. 2028 for 2026, 10700
// for 107000) and "absent" otherwise. This is a heuristic signal that the
// recognizer saw the right region but misread a glyph -- the case where
// traditional preprocessing has the best chance -- and is reported as
// such, never as proof.
//
// "Present in raw text" is a necessary, not sufficient, condition for an
// extractor to get the field right: an amount of 42 can appear on an
// unrelated line. That is why extraction-side numbers derived from this
// rule are an UPPER bound (a ceiling), and why amount evidence also records
// whether the value sits on a line with a payable-total keyword.

const fs = require("fs");
const path = require("path");

const { scoreEntry, aggregateScores, normalizeMerchant } = require("./scoring");

const RESULTS_DIR = path.join(__dirname, "results");
const CORPUS_DIR = path.join(__dirname, "corpus");
const MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");
const RAW_CACHE_PATH = path.join(RESULTS_DIR, "raw-ocr-baseline.json");
const FAILURE_CORPUS_PATH = path.join(RESULTS_DIR, "failure-corpus.json");

// ---------------------------------------------------------------------------
// Pure matching helpers
// ---------------------------------------------------------------------------

// Numeric tokens in OCR text. Commas are treated as thousands separators
// (INR "1,947.00", IDR "107,000", Indian "1,00,000"); a token of the exact
// shape "123,45" is ALSO offered with the comma read as a decimal point,
// because OCR routinely confuses "." and ",". A token is never allowed to
// start in the middle of a longer digit run.
const NUMERIC_TOKEN = /(?<![\d])\d[\d,]*(?:\.\d+)?/g;

const findNumericTokens = (text) => {
  const tokens = [];
  for (const match of String(text ?? "").matchAll(NUMERIC_TOKEN)) {
    const raw = match[0].replace(/,+$/, "");
    if (!raw) continue;
    const values = new Set();
    const stripped = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(stripped)) values.add(stripped);
    if (/^\d+,\d{2}$/.test(raw)) values.add(Number(raw.replace(",", ".")));
    tokens.push({ raw, index: match.index, values: [...values] });
  }
  return tokens;
};

// Keywords that mark a line as a payable-total line. Deliberately wider
// than extractAmount()'s label set: this is evidence about what an
// improved extractor COULD anchor on, not a description of today's one.
const TOTAL_LINE_KEYWORDS = /(total|amount|amt|net|payable|cash|paid|bill|grand|rs\.?|inr|rp)/i;

const lineAt = (text, index) => {
  const source = String(text ?? "");
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const endIdx = source.indexOf("\n", index);
  return source.slice(start, endIdx === -1 ? source.length : endIdx);
};

// Levenshtein distance, used only for near-miss sub-classification.
const editDistance = (a, b) => {
  const s = String(a);
  const t = String(b);
  const prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= t.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (s[i - 1] === t[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[t.length];
};

const integerDigits = (value) => String(Math.trunc(Math.abs(value)));

// Is the expected amount present as a numeric token anywhere in the text?
const findAmountInText = (text, expected) => {
  if (typeof expected !== "number") return { present: false, matches: [], labelled: false, nearMisses: [] };
  const tokens = findNumericTokens(text);
  const matches = tokens.filter((t) => t.values.some((v) => Math.abs(v - expected) < 0.005));
  const labelled = matches.some((t) => TOTAL_LINE_KEYWORDS.test(lineAt(text, t.index)));

  // Near miss: an integer part one digit edit (substitution, insertion or
  // deletion) away from the expected one, where BOTH have 3+ integer digits
  // -- for short numbers almost anything is one edit away (a "40" from a
  // "23:40" timestamp is one deletion from 640), which would make the
  // signal noise.
  const want = integerDigits(expected);
  const nearMisses =
    want.length >= 3
      ? tokens
          .filter((t) => !matches.includes(t))
          .filter((t) =>
            t.values.some((v) => integerDigits(v).length >= 3 && editDistance(integerDigits(v), want) === 1)
          )
          .map((t) => t.raw)
      : [];

  return { present: matches.length > 0, matches: matches.map((t) => t.raw), labelled, nearMisses };
};

// Date candidates in OCR text, day-first (the same Indian-convention
// assumption scoring.js documents), plus ISO and worded forms. Separators
// may be / - . with at most one space either side, never a line break.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const SEP = "[ \\t]?[-/.][ \\t]?";
const DATE_PATTERNS = [
  { kind: "iso", re: new RegExp(`(?<!\\d)(\\d{4})${SEP}(\\d{1,2})${SEP}(\\d{1,2})(?!\\d)`, "g"), order: "ymd" },
  { kind: "dmy", re: new RegExp(`(?<!\\d)(\\d{1,2})${SEP}(\\d{1,2})${SEP}(\\d{4}|\\d{2})(?!\\d)`, "g"), order: "dmy" },
  {
    kind: "d-mon-y",
    re: new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?[ \\t]*[-/., ]?[ \\t]*${MONTH_RE}[ \\t]*[-/., ]?[ \\t]*(\\d{4}|\\d{2})(?!\\d)`, "gi"),
    order: "dMy",
  },
  {
    kind: "mon-d-y",
    re: new RegExp(`${MONTH_RE}[ \\t]*(\\d{1,2})(?:st|nd|rd|th)?,?[ \\t]*(\\d{4})(?!\\d)`, "gi"),
    order: "Mdy",
  },
];

const expandYear = (y) => (String(y).length <= 2 ? Number(y) + 2000 : Number(y));

const toIso = (year, month, day) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

// Returns every date-shaped token with its components (valid or not --
// near-miss detection needs the invalid ones too) and its ISO form when
// the components form a real calendar date.
const findDateCandidates = (text) => {
  const source = String(text ?? "");
  const out = [];
  for (const { kind, re, order } of DATE_PATTERNS) {
    for (const m of source.matchAll(re)) {
      let day;
      let month;
      let year;
      if (order === "ymd") [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else if (order === "dmy") [day, month, year] = [Number(m[1]), Number(m[2]), expandYear(m[3])];
      else if (order === "dMy") [day, month, year] = [Number(m[1]), MONTHS.indexOf(m[2].toLowerCase()) + 1, expandYear(m[3])];
      else [month, day, year] = [MONTHS.indexOf(m[1].toLowerCase()) + 1, Number(m[2]), Number(m[3])];
      out.push({ kind, raw: m[0], day, month, year, iso: toIso(year, month, day) });
    }
  }
  return out;
};

const ddmmyyyy = ({ day, month, year }) =>
  `${String(day).padStart(2, "0")}${String(month).padStart(2, "0")}${String(year).padStart(4, "0")}`;

const hamming = (a, b) => {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
};

const findDateInText = (text, expectedIso) => {
  if (!expectedIso) return { present: false, matches: [], nearMisses: [] };
  const candidates = findDateCandidates(text);
  const matches = candidates.filter((c) => c.iso === expectedIso);
  const [y, m, d] = expectedIso.split("-").map(Number);
  const want = ddmmyyyy({ day: d, month: m, year: y });
  const nearMisses = candidates
    .filter((c) => c.iso !== expectedIso && hamming(ddmmyyyy(c), want) === 1)
    .map((c) => c.raw);
  return { present: matches.length > 0, matches: [...new Set(matches.map((c) => c.raw))], nearMisses: [...new Set(nearMisses)] };
};

// Merchant: every word of 3+ characters in the normalized ground-truth name
// must appear somewhere in the normalized raw text. Informational only,
// like merchant scoring itself.
const findMerchantInText = (text, expectedName) => {
  const hay = normalizeMerchant(String(text ?? "").replace(/\n/g, " "));
  const words = normalizeMerchant(expectedName).split(" ").filter((w) => w.length >= 3);
  if (!words.length) return { present: false, missingWords: [] };
  const missingWords = words.filter((w) => !hay.includes(w));
  return { present: missingWords.length === 0, missingWords };
};

// Classify one failed field. `expected` null with a non-null extraction is a
// false positive -> extraction. Empty raw text is always recognition.
const classifyFieldFailure = (field, { expected, rawText }) => {
  if (field === "reviewReasons") return { category: "derived", subcategory: null, evidence: {} };
  if (expected === null || expected === undefined || expected === "") {
    return { category: "extraction", subcategory: "false-positive", evidence: {} };
  }
  if (!String(rawText ?? "").trim()) {
    return { category: "recognition", subcategory: "absent", evidence: { reason: "no text recognised" } };
  }

  let evidence;
  if (field === "amount") evidence = findAmountInText(rawText, expected);
  else if (field === "date") evidence = findDateInText(rawText, expected);
  else if (field === "merchant") evidence = findMerchantInText(rawText, expected);
  else throw new Error(`classifyFieldFailure: unknown field ${field}`);

  if (evidence.present) {
    // For amounts, record whether the value sits on a line that carries a
    // payable-total keyword ("labelled-line") or only on some other line
    // ("unlabelled-line"). The latter is still an extraction failure by the
    // rule above, but one an improved extractor can only reach with
    // weaker anchors (fuzzy labels, payment lines, arithmetic cross-checks).
    const subcategory = field === "amount" ? (evidence.labelled ? "labelled-line" : "unlabelled-line") : null;
    return { category: "extraction", subcategory, evidence };
  }
  const near = Array.isArray(evidence.nearMisses) && evidence.nearMisses.length > 0;
  return { category: "recognition", subcategory: near ? "near-miss" : "absent", evidence };
};

// Build the per-receipt record for one scored entry. `score` is scoreEntry()
// output; `rawText` is the raw OCR text for that entry.
const buildFailureRecord = (entry, score, rawText, confidence) => {
  const gt = entry.groundTruth || {};
  const fields = {
    amount: { expected: gt.expenseAmount ?? null, extracted: score.extracted.expenseAmount, match: score.amountMatch },
    date: { expected: gt.expenseDate ?? null, extracted: score.extracted.expenseDate, match: score.dateMatch },
    reviewReasons: {
      expected: gt.expectReviewReasons ?? null,
      extracted: score.extracted.reviewReasons,
      match: score.reasonsMatch,
    },
    merchant: {
      expected: gt.expenseName ?? null,
      extracted: score.extracted.expenseName,
      match: score.merchantMatch,
      informational: true,
    },
  };

  for (const [name, f] of Object.entries(fields)) {
    if (f.match === false) Object.assign(f, classifyFieldFailure(name, { expected: f.expected, rawText }));
  }

  const gatedFailures = ["amount", "date", "reviewReasons"].filter((n) => fields[n].match === false);
  return {
    id: entry.id,
    source: entry.source,
    passed: score.passed,
    gatedFailures,
    overallConfidence: confidence,
    fields,
    rawText,
  };
};

const emptyCounts = () => ({ failures: 0, recognition: 0, recognitionNearMiss: 0, extraction: 0, derived: 0, ids: [] });

// Per-field taxonomy counts across a list of records (all entries, not just
// failing ones, so merchant-only mismatches are counted too).
const summarizeTaxonomy = (records) => {
  const summary = { amount: emptyCounts(), date: emptyCounts(), reviewReasons: emptyCounts(), merchant: emptyCounts() };
  for (const r of records) {
    for (const [name, f] of Object.entries(r.fields)) {
      if (f.match !== false) continue;
      const s = summary[name];
      s.failures += 1;
      s[f.category] += 1;
      if (f.category === "recognition" && f.subcategory === "near-miss") s.recognitionNearMiss += 1;
      s.ids.push(`${r.id} (${f.category}${f.subcategory ? `/${f.subcategory}` : ""})`);
    }
  }
  const gated = ["amount", "date", "reviewReasons"];
  summary.gatedTotal = {
    fieldFailures: gated.reduce((n, k) => n + summary[k].failures, 0),
    recognition: gated.reduce((n, k) => n + summary[k].recognition, 0),
    extraction: gated.reduce((n, k) => n + summary[k].extraction, 0),
    derived: gated.reduce((n, k) => n + summary[k].derived, 0),
  };
  return summary;
};

// ---------------------------------------------------------------------------
// Orchestration (real OCR; not unit-tested -- same stance as runEvaluation.js)
// ---------------------------------------------------------------------------

const loadManifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

// Runs the real pipeline over every manifest entry and caches the full OCR
// result (text + confidence + lines) so T02 and --reuse can re-parse
// without another OCR pass. parseReceipt() is deterministic given the OCR
// result, so a re-parse of the cache equals the original run.
const runBaselineOcr = async (entries) => {
  // Required lazily so the pure helpers above can be imported (by tests,
  // by measureOcrCeiling.js) without loading tesseract.js.
  const { extractTextFromImage } = require("../../Services/BillServices/ocrService");
  const out = [];
  for (const entry of entries) {
    const buffer = fs.readFileSync(path.join(CORPUS_DIR, entry.image));
    const ocr = await extractTextFromImage(buffer);
    out.push({ id: entry.id, ocr });
    console.log(`ocr ${entry.id} (${ocr.text.length} chars, conf ${ocr.confidence})`);
  }
  const cache = {
    meta: {
      runAt: new Date().toISOString(),
      tesseractJs: require("tesseract.js/package.json").version,
      note: "Raw OCR output of the real pipeline (ocrService.extractTextFromImage) per corpus entry. Run output, gitignored.",
    },
    entries: out,
  };
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RAW_CACHE_PATH, JSON.stringify(cache, null, 2));
  return cache;
};

const loadOrRunBaseline = async ({ reuse, entries }) => {
  if (reuse && fs.existsSync(RAW_CACHE_PATH)) {
    const cache = JSON.parse(fs.readFileSync(RAW_CACHE_PATH, "utf8"));
    const ids = new Set(cache.entries.map((e) => e.id));
    if (entries.every((e) => ids.has(e.id))) return cache;
    console.log("raw OCR cache does not cover the manifest; re-running OCR");
  }
  return runBaselineOcr(entries);
};

async function main({ reuse = process.argv.includes("--reuse") } = {}) {
  const { parseReceipt } = require("../../Services/BillServices/receiptParser");
  const manifest = loadManifest();
  const cache = await loadOrRunBaseline({ reuse, entries: manifest.entries });
  const byId = new Map(cache.entries.map((e) => [e.id, e.ocr]));

  const scores = [];
  const records = [];
  for (const entry of manifest.entries) {
    const ocr = byId.get(entry.id);
    const score = scoreEntry(entry, parseReceipt(ocr));
    scores.push(score);
    records.push(buildFailureRecord(entry, score, ocr.text, ocr.confidence));
  }

  const aggregate = aggregateScores(scores);
  const taxonomy = summarizeTaxonomy(records);
  const failing = records.filter((r) => r.gatedFailures.length > 0);
  const merchantOnly = records
    .filter((r) => r.gatedFailures.length === 0 && r.fields.merchant.match === false)
    .map((r) => ({ id: r.id, merchant: r.fields.merchant }));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      ocrRunAt: cache.meta.runAt,
      tesseractJs: cache.meta.tesseractJs,
      corpusType: manifest.corpusType,
      corpusSize: manifest.entries.length,
      rule:
        "recognition = correct value absent from raw OCR text under the field's normalized matching rule; extraction = present but not extracted (or a value extracted where ground truth is null); derived = reviewReasons. See docs/ocr/OCR-006-T01-failure-corpus.md.",
    },
    aggregate,
    taxonomy,
    failingReceipts: failing,
    merchantOnlyMismatches: merchantOnly,
  };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(FAILURE_CORPUS_PATH, JSON.stringify(report, null, 2));

  console.log("");
  console.log(`${aggregate.passed}/${aggregate.total} passed; ${failing.length} failing receipts`);
  for (const f of ["amount", "date", "reviewReasons", "merchant"]) {
    const t = taxonomy[f];
    console.log(
      `${f}: ${t.failures} failures -> recognition ${t.recognition} (near-miss ${t.recognitionNearMiss}), extraction ${t.extraction}, derived ${t.derived}`
    );
  }
  console.log(`Written: ${path.relative(process.cwd(), FAILURE_CORPUS_PATH)}`);
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("buildFailureCorpus crashed:", err);
    process.exit(1);
  });
}

module.exports = {
  findNumericTokens,
  findAmountInText,
  findDateCandidates,
  findDateInText,
  findMerchantInText,
  classifyFieldFailure,
  buildFailureRecord,
  summarizeTaxonomy,
  editDistance,
  loadManifest,
  loadOrRunBaseline,
  main,
  RAW_CACHE_PATH,
  FAILURE_CORPUS_PATH,
  RESULTS_DIR,
  CORPUS_DIR,
};
