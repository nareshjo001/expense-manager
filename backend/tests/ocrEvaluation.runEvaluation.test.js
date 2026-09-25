// OCR-003-T07 -- tests the evaluation harness's orchestration (reading a
// manifest, calling the OCR + parse pipeline per entry, scoring, writing a
// report). Runs deliberately against just the six synthetic fixtures, not
// the full committed corpus.json (which also has real, anonymized receipt
// photos as of 2026-09-25) -- there is no canned OCR text for a real photo
// without actually running Tesseract on it, and mocking real Tesseract
// output convincingly isn't the point of this suite. runEvaluation.main()
// accepts an explicit { entries, corpusType } override for exactly this
// reason; `npm run eval:ocr` (no override) still reads the full manifest.
//
// tesseract.js is never invoked for real here, for the same reason
// ocrService.timeout.test.js never invokes it: a real OCR pass is slow and
// needs network access (to fetch Tesseract's language data) this CI/sandbox
// environment does not reliably have. extractTextFromImage() is mocked to
// return, for each fixture, an OCR result built from that fixture's own
// FIXTURES[].lines -- the exact same text generateSyntheticFixtures.js
// rendered into the corpus image -- so this test exercises the real
// scoring and report-writing logic against realistic OCR-result shapes,
// without needing the real engine.
"use strict";

const fs = require("fs");
const path = require("path");

const { buildOcrResult, buildLine } = require("../Services/BillServices/ocrContract");
const { FIXTURES } = require("../scripts/ocrEvaluation/generateSyntheticFixtures");

const OCR_SERVICE_PATH = "../Services/BillServices/ocrService";
const RUN_EVALUATION_PATH = "../scripts/ocrEvaluation/runEvaluation";
const MANIFEST_PATH = "../scripts/ocrEvaluation/corpus/manifest.json";

// Mirrors the entry shape generateSyntheticFixtures.js writes into
// corpus/manifest.json for each fixture -- built directly from FIXTURES
// rather than read from the live manifest, so this suite stays correct
// regardless of how many real entries have since been appended to it.
const SYNTHETIC_ENTRIES = FIXTURES.map((f) => ({
  id: f.id,
  image: `images/${f.id}.png`,
  source: "synthetic",
  anonymized: true,
  groundTruth: f.groundTruth,
  notes: f.notes,
}));

// Builds a canned OCR result for one fixture, mirroring what
// ocrService.buildLines() would produce for cleanly recognised text: one
// line per rendered line, confidence 95, no bbox (bbox isn't read by
// anything in the scoring path).
const ocrResultForFixture = (fixture) =>
  buildOcrResult({
    text: fixture.lines.join("\n"),
    confidence: 95,
    lines: fixture.lines.map((text) => buildLine(text, 95, null)),
  });

// Loads runEvaluation.js fresh, with extractTextFromImage mocked to return
// one canned result per call, in the order given.
const loadRunEvaluation = (resultsInOrder) => {
  jest.resetModules();
  const extractTextFromImage = jest.fn();
  resultsInOrder.forEach((result) => extractTextFromImage.mockImplementationOnce(async () => result));
  jest.doMock(OCR_SERVICE_PATH, () => ({ extractTextFromImage }));
  return { runEvaluation: require(RUN_EVALUATION_PATH), extractTextFromImage };
};

const runSynthetic = (runEvaluation) =>
  runEvaluation.main({ entries: SYNTHETIC_ENTRIES, corpusType: "synthetic-smoke-test" });

describe("runEvaluation against the synthetic fixtures", () => {
  afterEach(() => {
    jest.dontMock(OCR_SERVICE_PATH);
    delete process.env.OCR_EVAL_STRICT;
  });

  test("the committed manifest's synthetic entries match FIXTURES, in order", () => {
    // A regression check on the committed corpus/manifest.json itself: its
    // synthetic-sourced entries should never drift from generateSyntheticFixtures.js's
    // FIXTURES (real, anonymized entries are appended after them and are not
    // asserted on here -- see the module comment above).
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, MANIFEST_PATH), "utf8"));
    const syntheticIds = manifest.entries.filter((e) => e.source === "synthetic").map((e) => e.id);
    expect(syntheticIds).toEqual(FIXTURES.map((f) => f.id));
  });

  test("every synthetic fixture passes when OCR reads its rendered text back cleanly", async () => {
    const { runEvaluation, extractTextFromImage } = loadRunEvaluation(FIXTURES.map(ocrResultForFixture));

    const { aggregate, results } = await runSynthetic(runEvaluation);

    expect(extractTextFromImage).toHaveBeenCalledTimes(FIXTURES.length);
    expect(aggregate.total).toBe(FIXTURES.length);
    expect(aggregate.failed).toBe(0);
    expect(aggregate.failingIds).toEqual([]);
    results.forEach((r) => expect(r.passed).toBe(true));

    // heading-collision is the one fixture where a merchant mismatch is
    // expected BY DESIGN (see generateSyntheticFixtures.js) -- it still
    // has to pass overall, since merchant is informational only.
    const headingCollision = results.find((r) => r.id === "heading-collision");
    expect(headingCollision.merchantMatch).toBe(false);
    expect(headingCollision.passed).toBe(true);
  });

  test("writes a JSON and a Markdown report to results/", async () => {
    const { runEvaluation } = loadRunEvaluation(FIXTURES.map(ocrResultForFixture));
    await runSynthetic(runEvaluation);

    const jsonPath = path.join(runEvaluation.RESULTS_DIR, "latest.json");
    const mdPath = path.join(runEvaluation.RESULTS_DIR, "latest.md");
    expect(fs.existsSync(jsonPath)).toBe(true);
    expect(fs.existsSync(mdPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    expect(written.aggregate.total).toBe(FIXTURES.length);

    const markdown = fs.readFileSync(mdPath, "utf8");
    expect(markdown).toContain("# OCR evaluation report");
    expect(markdown).toContain("synthetic only");
  });

  test("a genuine regression is reported as a failing entry", async () => {
    const canned = FIXTURES.map(ocrResultForFixture);
    // Corrupt the "clean-simple" entry's OCR text so the amount cannot be
    // found -- simulates a real pipeline regression, not a fixture change.
    const cleanSimpleIndex = FIXTURES.findIndex((f) => f.id === "clean-simple");
    canned[cleanSimpleIndex] = buildOcrResult({ text: "Coffee House\n1 Latte", confidence: 95, lines: [] });

    const { runEvaluation } = loadRunEvaluation(canned);
    const { aggregate } = await runSynthetic(runEvaluation);

    expect(aggregate.failed).toBe(1);
    expect(aggregate.failingIds).toEqual(["clean-simple"]);
  });

  test("OCR_EVAL_STRICT=1 sets a non-zero exit code only when something fails", async () => {
    const canned = FIXTURES.map(ocrResultForFixture);

    process.env.OCR_EVAL_STRICT = "1";
    const passingRun = loadRunEvaluation(canned);
    delete process.exitCode;
    await runSynthetic(passingRun.runEvaluation);
    expect(process.exitCode).toBeUndefined();

    const cleanSimpleIndex = FIXTURES.findIndex((f) => f.id === "clean-simple");
    const failingCanned = FIXTURES.map(ocrResultForFixture);
    failingCanned[cleanSimpleIndex] = buildOcrResult({ text: "no total here", confidence: 95, lines: [] });
    const failingRun = loadRunEvaluation(failingCanned);
    delete process.exitCode;
    await runSynthetic(failingRun.runEvaluation);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  test("without OCR_EVAL_STRICT, a failing entry does not set a non-zero exit code", async () => {
    const canned = FIXTURES.map(ocrResultForFixture);
    const cleanSimpleIndex = FIXTURES.findIndex((f) => f.id === "clean-simple");
    canned[cleanSimpleIndex] = buildOcrResult({ text: "no total here", confidence: 95, lines: [] });

    const { runEvaluation } = loadRunEvaluation(canned);
    delete process.exitCode;
    const { aggregate } = await runSynthetic(runEvaluation);

    expect(aggregate.failed).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });
});
