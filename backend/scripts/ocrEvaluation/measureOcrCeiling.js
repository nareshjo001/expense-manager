"use strict";

// OCR-006-T02 -- measure the traditional (non-AI) OCR ceiling.
//
// Answers one question for the OCR-006 evidence gate: of the receipts the
// current pipeline gets wrong, how many could a better NON-AI pipeline
// plausibly fix, and how many are recognition failures that only a stronger
// recognizer (e.g. a vision model) might fix?
//
// Three measurements, all on the committed corpus, all local:
//   (a) current   -- the real pipeline's field accuracy (same numbers as
//                    `npm run eval:ocr`, re-derived from the cached raw OCR
//                    output buildFailureCorpus.js writes).
//   (b) extraction ceiling -- accuracy if the extractor were perfect given
//                    the SAME raw OCR text: a field counts if it already
//                    matches OR its correct value is present in the raw
//                    text (buildFailureCorpus.js's matching rules). An
//                    UPPER bound: "present" does not mean an extractor
//                    could have known which occurrence was the answer.
//   (c) recognition-side ceiling -- the same images through cheap
//                    traditional preprocessing (sharp: grayscale, contrast
//                    normalisation, 2x upscale, CLAHE, Otsu binarisation)
//                    crossed with Tesseract page-segmentation modes. Reports
//                    both the best SINGLE fixed configuration (what could
//                    actually ship -- though choosing it on these same 21
//                    receipts makes it optimistic) and the per-field
//                    best-of-all-configurations "oracle" (which needs the
//                    answer to pick the variant, so it is an upper bound,
//                    not a deployable pipeline).
//
// No image or text leaves the machine: OCR is local tesseract.js with the
// language data already on disk; nothing is installed or downloaded.
//
// Usage (from backend/; the variant sweep is ~500 OCR passes, so it is
// resumable -- each invocation works for at most --budget seconds, caches
// progress in results/ocr-variants-cache.json, and writes the report once
// every configuration is done):
//   node scripts/ocrEvaluation/measureOcrCeiling.js [--budget=150] [--no-variants]

const fs = require("fs");
const path = require("path");

const { scoreEntry, aggregateScores } = require("./scoring");
const {
  loadManifest,
  loadOrRunBaseline,
  findAmountInText,
  findDateInText,
  findMerchantInText,
  RESULTS_DIR,
  CORPUS_DIR,
} = require("./buildFailureCorpus");

const VARIANT_CACHE_PATH = path.join(RESULTS_DIR, "ocr-variants-cache.json");
const CEILING_PATH = path.join(RESULTS_DIR, "ocr-ceiling.json");

// Tesseract page segmentation modes tried. tesseract.js initialises its
// worker with PSM 6 (SINGLE_BLOCK), not Tesseract's CLI default of 3
// (AUTO) -- so 6 is what the production pipeline (ocrService.js, which sets
// no PSM) actually runs; the sweep's original/psm6 pass reproduces the
// production text exactly, which the report checks.
const PSM_MODES = ["3", "4", "6", "11"];
const PRODUCTION_PSM = "6";
const MAX_UPSCALED_SIDE = 3000;
const PASS_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

// Same normalisation as ocrService.normalizeLayout (not exported there):
// collapse horizontal whitespace per line, drop blank lines, keep breaks.
const normalizeLayout = (rawText) =>
  String(rawText ?? "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();

// Otsu's threshold over an 8-bit grayscale histogram.
const otsuThreshold = (pixels) => {
  const hist = new Array(256).fill(0);
  for (const p of pixels) hist[p] += 1;
  const total = pixels.length;
  let sumAll = 0;
  for (let i = 0; i < 256; i += 1) sumAll += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
};

const upscaleFactor = (width, height) => Math.max(1, Math.min(2, MAX_UPSCALED_SIDE / Math.max(width, height)));

// Field-level evaluation of one OCR text against one manifest entry.
const evaluateText = (entry, text, parseReceipt) => {
  const gt = entry.groundTruth || {};
  const score = scoreEntry(entry, parseReceipt(text));
  return {
    passed: score.passed,
    amountMatch: score.amountMatch,
    dateMatch: score.dateMatch,
    merchantMatch: score.merchantMatch,
    reasonsMatch: score.reasonsMatch,
    // "Present" for a null ground truth is meaningless -> treat as the match.
    amountPresent: gt.expenseAmount == null ? score.amountMatch : findAmountInText(text, gt.expenseAmount).present,
    datePresent: gt.expenseDate == null ? score.dateMatch : findDateInText(text, gt.expenseDate).present,
    merchantPresent: gt.expenseName ? findMerchantInText(text, gt.expenseName).present : score.merchantMatch,
    extracted: { amount: score.extracted.expenseAmount, date: score.extracted.expenseDate },
  };
};

// Extraction ceiling for one evaluated text: a gated field counts if it
// already matches or the correct value is present in the text.
const extractionCeilingOf = (ev) => ({
  amount: ev.amountMatch || ev.amountPresent,
  date: ev.dateMatch || ev.datePresent,
  passed: (ev.amountMatch || ev.amountPresent) && (ev.dateMatch || ev.datePresent) && ev.reasonsMatch !== false,
});

const summarizeConfig = (evals) => {
  const n = evals.length;
  const count = (fn) => evals.filter(fn).length;
  return {
    total: n,
    passed: count((e) => e.passed),
    amountMatch: count((e) => e.amountMatch),
    dateMatch: count((e) => e.dateMatch),
    merchantMatch: count((e) => e.merchantMatch),
    amountPresent: count((e) => e.amountPresent),
    datePresent: count((e) => e.datePresent),
    extractionCeilingPassed: count((e) => extractionCeilingOf(e).passed),
  };
};

// Status of one currently-failing gated field, most to least optimistic
// about a non-AI fix.
const classifyRecovery = ({ baselinePresent, variantExtractedBy, variantPresentIn }) => {
  if (baselinePresent) return "extraction-fixable";
  if (variantExtractedBy.length) return "recovered-by-preprocessing";
  if (variantPresentIn.length) return "recognised-by-preprocessing-not-extracted";
  return "not-recovered";
};

// ---------------------------------------------------------------------------
// OCR + preprocessing (not unit-tested; real Tesseract + sharp)
// ---------------------------------------------------------------------------

const upscaled = (sharp, buf, meta) =>
  sharp(buf)
    .grayscale()
    .resize(Math.round(meta.width * upscaleFactor(meta.width, meta.height)), null, { kernel: "lanczos3" });

// `production-preprocess` is the preprocessing the real upload paths
// (receiptIngestService.js, billController.js) apply before OCR --
// imageProcessor.preprocessImage(): EXIF rotate, fit inside 1500px without
// enlarging, grayscale, normalise, sharpen. runEvaluation.js (and so the
// 15/21 baseline and T01's failure corpus) feeds Tesseract the ORIGINAL
// image instead, so this variant is what shows the gap between the harness
// and production.
const VARIANTS = {
  original: async (buf) => buf,
  "production-preprocess": async (buf) =>
    require("../../Services/BillServices/imageProcessor").preprocessImage(buf),
  "gray-normalize": async (buf, sharp) => sharp(buf).grayscale().normalise().png().toBuffer(),
  "gray-up": async (buf, sharp, meta) => upscaled(sharp, buf, meta).png().toBuffer(),
  "gray-up-normalize-sharpen": async (buf, sharp, meta) =>
    upscaled(sharp, buf, meta).normalise().sharpen().png().toBuffer(),
  "gray-up-clahe": async (buf, sharp, meta) =>
    upscaled(sharp, buf, meta).clahe({ width: 64, height: 64, maxSlope: 3 }).png().toBuffer(),
  "gray-up-otsu": async (buf, sharp, meta) => {
    const up = await upscaled(sharp, buf, meta).raw().toBuffer({ resolveWithObject: true });
    const t = otsuThreshold(up.data);
    return sharp(up.data, { raw: { width: up.info.width, height: up.info.height, channels: 1 } })
      .threshold(t)
      .png()
      .toBuffer();
  },
};

const loadVariantCache = () =>
  fs.existsSync(VARIANT_CACHE_PATH) ? JSON.parse(fs.readFileSync(VARIANT_CACHE_PATH, "utf8")) : { results: {} };

const saveVariantCache = (cache) => fs.writeFileSync(VARIANT_CACHE_PATH, JSON.stringify(cache));

const cacheKey = (variant, psm, id) => `${variant}|psm${psm}|${id}`;

// Runs every not-yet-cached (variant, psm, entry) OCR pass until the time
// budget runs out. One worker per PSM, reused across images.
const runVariantSweep = async (entries, budgetMs) => {
  const sharp = require("sharp");
  const Tesseract = require("tesseract.js");
  const cache = loadVariantCache();
  const started = Date.now();
  const prepared = new Map();

  const prepare = async (variant, entry) => {
    const key = `${variant}|${entry.id}`;
    if (!prepared.has(key)) {
      const buf = fs.readFileSync(path.join(CORPUS_DIR, entry.image));
      const meta = await sharp(buf).metadata();
      prepared.set(key, await VARIANTS[variant](buf, sharp, meta));
    }
    return prepared.get(key);
  };

  for (const psm of PSM_MODES) {
    const todo = [];
    for (const variant of Object.keys(VARIANTS)) {
      for (const entry of entries) if (!cache.results[cacheKey(variant, psm, entry.id)]) todo.push({ variant, entry });
    }
    if (!todo.length) continue;

    const newWorker = async () => {
      const w = await Tesseract.createWorker("eng");
      await w.setParameters({ tessedit_pageseg_mode: psm });
      return w;
    };
    let worker = await newWorker();
    try {
      for (const { variant, entry } of todo) {
        if (Date.now() - started > budgetMs) {
          saveVariantCache(cache);
          return false;
        }
        const image = await prepare(variant, entry);
        // Same per-attempt budget production uses (ocrService's default
        // OCR_TIMEOUT_MS): a configuration that needs longer than that on
        // a receipt would time out for a real user too, so it is recorded
        // as a timeout (empty text) rather than waited on.
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), PASS_TIMEOUT_MS);
        });
        const result = await Promise.race([worker.recognize(image, {}, { text: true }), timeout]);
        clearTimeout(timer);
        if (result === null) {
          await worker.terminate().catch(() => {});
          worker = await newWorker();
          cache.results[cacheKey(variant, psm, entry.id)] = { text: "", confidence: null, timedOut: true };
          console.log(`timeout: ${variant}/psm${psm}/${entry.id}`);
        } else {
          cache.results[cacheKey(variant, psm, entry.id)] = {
            text: normalizeLayout(result.data.text),
            confidence: typeof result.data.confidence === "number" ? result.data.confidence : null,
          };
        }
        // Persist after every pass: a long sweep can be interrupted, and
        // resuming must not redo finished work.
        saveVariantCache(cache);
      }
    } finally {
      await worker.terminate().catch(() => {});
    }
    console.log(`psm ${psm}: done (${Math.round((Date.now() - started) / 1000)}s elapsed)`);
  }
  saveVariantCache(cache);
  return true;
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const argValue = (name, fallback) => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : fallback;
};

// Best single fixed configuration: most receipts passed, then most amount
// matches, then most date matches, then declaration order (stable sort).
const rankConfigs = (configs) =>
  configs
    .slice()
    .sort(
      (a, b) =>
        b.summary.passed - a.summary.passed ||
        b.summary.amountMatch - a.summary.amountMatch ||
        b.summary.dateMatch - a.summary.dateMatch
    );

const buildRecognitionCeiling = ({ entries, cache, baseById, baseEvals, currentScores, parseReceipt }) => {
  // Sanity check: does the sweep's own original/psm6 pass (production's
  // effective settings) reproduce the production pipeline's text? If not,
  // variant numbers are not directly comparable to (a).
  const reproduced = entries.filter(
    (e) => cache.results[cacheKey("original", PRODUCTION_PSM, e.id)].text === baseById.get(e.id).text
  ).length;

  const configs = [];
  for (const variant of Object.keys(VARIANTS)) {
    for (const psm of PSM_MODES) {
      const evals = entries.map((e) => ({
        id: e.id,
        ...evaluateText(e, cache.results[cacheKey(variant, psm, e.id)].text, parseReceipt),
      }));
      configs.push({ variant, psm, summary: summarizeConfig(evals), evals });
    }
  }

  const best = rankConfigs(configs)[0];

  // What production actually runs (preprocessImage() + tesseract.js's
  // default PSM), next to the harness baseline, per entry.
  const production = configs.find((c) => c.variant === "production-preprocess" && c.psm === PRODUCTION_PSM);
  const productionPath = {
    variant: production.variant,
    psm: production.psm,
    ...production.summary,
    failing: production.evals.filter((ev) => !ev.passed).map((ev) => ({
      id: ev.id,
      amountMatch: ev.amountMatch,
      dateMatch: ev.dateMatch,
      amountPresent: ev.amountPresent,
      datePresent: ev.datePresent,
      extracted: ev.extracted,
    })),
    note: "runEvaluation.js skips imageProcessor.preprocessImage(); this row is the pipeline the upload endpoints actually run.",
  };
  const baseScoreById = new Map(currentScores.map((s) => [s.id, s]));
  const bestRegressions = best.evals.filter((ev) => baseScoreById.get(ev.id).passed && !ev.passed).map((ev) => ev.id);
  const bestFixes = best.evals.filter((ev) => !baseScoreById.get(ev.id).passed && ev.passed).map((ev) => ev.id);

  // Oracle: per entry per field, any configuration (baseline included).
  const oracle = entries.map((e, i) => {
    const all = [baseEvals[i], ...configs.map((c) => c.evals[i])];
    const amount = all.some((ev) => ev.amountMatch);
    const date = all.some((ev) => ev.dateMatch);
    const amountPresent = all.some((ev) => ev.amountPresent);
    const datePresent = all.some((ev) => ev.datePresent);
    return { id: e.id, extracted: amount && date, present: (amount || amountPresent) && (date || datePresent), amount, date, amountPresent, datePresent };
  });

  // Every currently failing gated field and what, if anything, recovers it.
  const failureRecovery = [];
  currentScores.forEach((s, i) => {
    const entry = entries[i];
    for (const field of ["amount", "date"]) {
      if (s[`${field}Match`]) continue;
      const cfg = (pred) => configs.filter((c) => pred(c.evals[i])).map((c) => `${c.variant}/psm${c.psm}`);
      const variantExtractedBy = cfg((ev) => ev[`${field}Match`]);
      const variantPresentIn = cfg((ev) => ev[`${field}Present`]);
      const baselinePresent = baseEvals[i][`${field}Present`];
      failureRecovery.push({
        id: entry.id,
        field,
        expected: field === "amount" ? entry.groundTruth.expenseAmount : entry.groundTruth.expenseDate,
        baselineExtracted: field === "amount" ? s.extracted.expenseAmount : s.extracted.expenseDate,
        status: classifyRecovery({ baselinePresent, variantExtractedBy, variantPresentIn }),
        variantExtractedBy,
        variantPresentIn,
      });
    }
  });

  const failureRecoveryCounts = {};
  for (const f of failureRecovery) failureRecoveryCounts[f.status] = (failureRecoveryCounts[f.status] || 0) + 1;

  return {
    variants: Object.keys(VARIANTS),
    psmModes: PSM_MODES,
    configurations: configs.length,
    productionPsm: PRODUCTION_PSM,
    baselineReproducedByOriginalProductionPsm: `${reproduced}/${entries.length}`,
    productionPath,
    bestSingleConfig: {
      variant: best.variant,
      psm: best.psm,
      ...best.summary,
      fixes: bestFixes,
      regressions: bestRegressions,
      note: "Chosen on the same receipts it is scored on -> optimistic.",
    },
    oracle: {
      passedWithCurrentExtractor: oracle.filter((o) => o.extracted).length,
      passedIfExtractorPerfect: oracle.filter((o) => o.present).length,
      amount: oracle.filter((o) => o.amount).length,
      date: oracle.filter((o) => o.date).length,
      amountPresent: oracle.filter((o) => o.amount || o.amountPresent).length,
      datePresent: oracle.filter((o) => o.date || o.datePresent).length,
      total: entries.length,
      note: "Per-field best of all configurations; needs the ground truth to pick the variant, so it is an upper bound, not a pipeline.",
    },
    failureRecovery,
    failureRecoveryCounts,
    configTable: configs.map((c) => ({ variant: c.variant, psm: c.psm, ...c.summary })),
  };
};

async function main({
  budgetMs = Number(argValue("budget", "150")) * 1000,
  variants = !process.argv.includes("--no-variants"),
} = {}) {
  const { parseReceipt } = require("../../Services/BillServices/receiptParser");
  const manifest = loadManifest();
  const entries = manifest.entries;
  const baseline = await loadOrRunBaseline({ reuse: true, entries });
  const baseById = new Map(baseline.entries.map((e) => [e.id, e.ocr]));

  // (a) current -- via the real OCR result object, exactly like eval:ocr.
  const currentScores = entries.map((e) => scoreEntry(e, parseReceipt(baseById.get(e.id))));
  const current = aggregateScores(currentScores);

  // (b) extraction ceiling on the same raw text.
  const baseEvals = entries.map((e) => ({ id: e.id, ...evaluateText(e, baseById.get(e.id).text, parseReceipt) }));

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      ocrRunAt: baseline.meta.runAt,
      tesseractJs: baseline.meta.tesseractJs,
      corpusType: manifest.corpusType,
      corpusSize: entries.length,
      realEntries: entries.filter((e) => e.source === "anonymized-real").length,
    },
    current: {
      total: current.total,
      passed: current.passed,
      amountMatch: currentScores.filter((s) => s.amountMatch).length,
      dateMatch: currentScores.filter((s) => s.dateMatch).length,
      merchantMatch: currentScores.filter((s) => s.merchantMatch).length,
    },
    extractionCeiling: {
      total: entries.length,
      passed: baseEvals.filter((e) => extractionCeilingOf(e).passed).length,
      amount: baseEvals.filter((e) => extractionCeilingOf(e).amount).length,
      date: baseEvals.filter((e) => extractionCeilingOf(e).date).length,
      merchantPresent: baseEvals.filter((e) => e.merchantPresent).length,
      note: "Upper bound: a field counts if its correct value appears anywhere in the same raw OCR text.",
    },
  };

  if (variants) {
    const done = await runVariantSweep(entries, budgetMs);
    if (!done) {
      const cached = Object.keys(loadVariantCache().results).length;
      const expected = Object.keys(VARIANTS).length * PSM_MODES.length * entries.length;
      console.log(`variant sweep incomplete: ${cached}/${expected} OCR passes cached; re-run to continue`);
      return null;
    }
    report.recognitionCeiling = buildRecognitionCeiling({
      entries,
      cache: loadVariantCache(),
      baseById,
      baseEvals,
      currentScores,
      parseReceipt,
    });
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(CEILING_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ current: report.current, extractionCeiling: report.extractionCeiling }, null, 2));
  if (report.recognitionCeiling) {
    const { bestSingleConfig, oracle, failureRecoveryCounts, baselineReproducedByOriginalProductionPsm } =
      report.recognitionCeiling;
    console.log(
      JSON.stringify({ baselineReproducedByOriginalProductionPsm, bestSingleConfig, oracle, failureRecoveryCounts }, null, 2)
    );
  }
  console.log(`Written: ${path.relative(process.cwd(), CEILING_PATH)}`);
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("measureOcrCeiling crashed:", err);
    process.exit(1);
  });
}

module.exports = {
  normalizeLayout,
  otsuThreshold,
  upscaleFactor,
  evaluateText,
  extractionCeilingOf,
  summarizeConfig,
  classifyRecovery,
  rankConfigs,
  VARIANTS,
  PSM_MODES,
  main,
  CEILING_PATH,
};
