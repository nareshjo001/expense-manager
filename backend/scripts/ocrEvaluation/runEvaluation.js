"use strict";

// OCR-003-T07 -- the evaluation harness. Runs the real OCR + parsing
// pipeline (extractTextFromImage() -> parseReceipt(), the same two
// functions receiptIngestService.js calls for a real upload) against every
// corpus/manifest.json entry, scores the result against its ground truth
// (scoring.js), and writes a report.
//
// This talks to a real Tesseract worker -- no mocked OCR -- but nothing
// else: no database, no Redis, no other service to start (see
// corpus/README.md: "no live infrastructure required" means no service to
// start, not "no OCR"). It is a manual/on-demand tool (`npm run eval:ocr`),
// not a CI gate: the existing Jest suite always mocks tesseract.js
// (ocrService.timeout.test.js, and this feature's own
// ocrEvaluation.runEvaluation.test.js), because a real OCR pass is slow and
// needs network access to fetch Tesseract's language data on first run,
// which this repo's CI/sandbox environments do not reliably have.
const fs = require("fs");
const path = require("path");

const { extractTextFromImage } = require("../../Services/BillServices/ocrService");
const { parseReceipt } = require("../../Services/BillServices/receiptParser");
const { scoreEntry, aggregateScores } = require("./scoring");

const CORPUS_DIR = path.join(__dirname, "corpus");
const MANIFEST_PATH = path.join(CORPUS_DIR, "manifest.json");
const RESULTS_DIR = path.join(__dirname, "results");

const loadManifest = () => JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const runOne = async (entry) => {
  const imagePath = path.join(CORPUS_DIR, entry.image);
  const imageBuffer = fs.readFileSync(imagePath);
  const ocrResult = await extractTextFromImage(imageBuffer);
  const parsed = parseReceipt(ocrResult);
  return scoreEntry(entry, parsed);
};

const toMarkdown = (meta, aggregate, results) => {
  const lines = [
    "# OCR evaluation report",
    "",
    `Run at: ${meta.runAt}`,
    `Corpus: ${meta.corpusType} (${aggregate.total} entries)`,
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Pass rate | ${aggregate.passRate}% (${aggregate.passed}/${aggregate.total}) |`,
    `| Amount match rate | ${aggregate.amountMatchRate}% |`,
    `| Date match rate | ${aggregate.dateMatchRate}% |`,
    `| Merchant match rate (informational) | ${aggregate.merchantMatchRate}% |`,
    `| reviewReasons pass rate | ${aggregate.reviewReasonsPassRate}% (${aggregate.reviewReasonsAssertedCount} asserted) |`,
    "",
  ];

  if (aggregate.failingIds.length) {
    lines.push("## Failing entries", "");
    for (const id of aggregate.failingIds) {
      const r = results.find((x) => x.id === id);
      lines.push(
        `- **${id}** -- amountMatch=${r.amountMatch} dateMatch=${r.dateMatch} reasonsMatch=${r.reasonsMatch}`,
        `  extracted: ${JSON.stringify(r.extracted)}`
      );
    }
    lines.push("");
  }

  if (meta.corpusType === "synthetic-smoke-test") {
    lines.push(
      "> This corpus is synthetic only -- see corpus/README.md. A passing run here does not establish real-world OCR accuracy."
    );
  }

  return lines.join("\n");
};

// By default, runs the full committed manifest (what `npm run eval:ocr`
// does). `entries`/`corpusType` can be overridden together --
// ocrEvaluation.runEvaluation.test.js passes just the synthetic subset
// (with corpusType: "synthetic-smoke-test") so it can mock a small, fixed
// number of OCR calls instead of one per real photo in the manifest,
// independent of whatever the committed manifest currently contains.
async function main({ entries, corpusType } = {}) {
  if (!entries) {
    const manifest = loadManifest();
    entries = manifest.entries;
    corpusType = manifest.corpusType;
  }
  const results = [];

  for (const entry of entries) {
    // Sequential on purpose: extractTextFromImage() creates and tears down
    // a real Tesseract worker per call, and running several concurrently
    // would multiply memory/CPU for no speed benefit this tool needs.
    const result = await runOne(entry);
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}`);
  }

  const aggregate = aggregateScores(results);
  const meta = { runAt: new Date().toISOString(), corpusType };

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RESULTS_DIR, "latest.json"),
    JSON.stringify({ meta, aggregate, results }, null, 2)
  );
  fs.writeFileSync(path.join(RESULTS_DIR, "latest.md"), toMarkdown(meta, aggregate, results));

  console.log("");
  console.log(`${aggregate.passed}/${aggregate.total} passed (${aggregate.passRate}%)`);
  console.log("Report written to scripts/ocrEvaluation/results/latest.{json,md}");

  // Opt-in strict gate: OCR_EVAL_STRICT=1 npm run eval:ocr fails the
  // process on any failing entry, for a manual pre-release check. Not
  // enabled by default because the only corpus committed today is the
  // synthetic smoke set (see corpus/README.md) -- defaulting to a hard
  // failure on a corpus that's explicitly not representative would train
  // people to ignore it.
  if (process.env.OCR_EVAL_STRICT === "1" && aggregate.failed > 0) {
    process.exitCode = 1;
  }

  return { meta, aggregate, results };
}

if (require.main === module) {
  main().catch((err) => {
    console.error("runEvaluation crashed:", err);
    process.exit(1);
  });
}

module.exports = { main, runOne, loadManifest, toMarkdown, CORPUS_DIR, MANIFEST_PATH, RESULTS_DIR };
