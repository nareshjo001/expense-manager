// OCR-003-T07 -- tests the evaluation harness's orchestration (reading the
// manifest, calling the OCR + parse pipeline per entry, scoring, writing a
// report) against the real committed synthetic corpus.
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
// one canned result per manifest entry, in manifest order (matches
// FIXTURES order -- generateSyntheticFixtures.js writes the manifest by
// iterating FIXTURES).
const loadRunEvaluation = (resultsInOrder) => {
  jest.resetModules();
  const extractTextFromImage = jest.fn();
  resultsInOrder.forEach((result) => extractTextFromImage.mockImplementationOnce(async () => result));
  jest.doMock(OCR_SERVICE_PATH, () => ({ extractTextFromImage }));
  return { runEvaluation: require(RUN_EVALUATION_PATH), extractTextFromImage };
};

describe("runEvaluation against the committed synthetic corpus", () => {
  afterEach(() => {
    jest.dontMock(OCR_SERVICE_PATH);
    delete process.env.OCR_EVAL_STRICT;
  });

  test("the manifest has exactly one entry per FIXTURES item, in the same order", () => {
    const { loadManifest } = loadRunEvaluation(FIXTURES.map(ocrResultForFixture)).runEvaluation;
    const manifest = loadManifest();
    expect(manifest.entries.map((e) => e.id)).toEqual(FIXTURES.map((f) => f.id));
  });

  test("every synthetic fixture passes when OCR reads its rendered text back cleanly", async () => {
    const { runEvaluation, extractTextFromImage } = loadRunEvaluation(FIXTURES.map(ocrResultForFixture));

    const { aggregate, results } = await runEvaluation.main();

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
    await runEvaluation.main();

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
    const { aggregate } = await runEvaluation.main();

    expect(aggregate.failed).toBe(1);
    expect(aggregate.failingIds).toEqual(["clean-simple"]);
  });

  test("OCR_EVAL_STRICT=1 sets a non-zero exit code only when something fails", async () => {
    const canned = FIXTURES.map(ocrResultForFixture);

    process.env.OCR_EVAL_STRICT = "1";
    const passingRun = loadRunEvaluation(canned);
    delete process.exitCode;
    await passingRun.runEvaluation.main();
    expect(process.exitCode).toBeUndefined();

    const cleanSimpleIndex = FIXTURES.findIndex((f) => f.id === "clean-simple");
    const failingCanned = FIXTURES.map(ocrResultForFixture);
    failingCanned[cleanSimpleIndex] = buildOcrResult({ text: "no total here", confidence: 95, lines: [] });
    const failingRun = loadRunEvaluation(failingCanned);
    delete process.exitCode;
    await failingRun.runEvaluation.main();
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  test("without OCR_EVAL_STRICT, a failing entry does not set a non-zero exit code", async () => {
    const canned = FIXTURES.map(ocrResultForFixture);
    const cleanSimpleIndex = FIXTURES.findIndex((f) => f.id === "clean-simple");
    canned[cleanSimpleIndex] = buildOcrResult({ text: "no total here", confidence: 95, lines: [] });

    const { runEvaluation } = loadRunEvaluation(canned);
    delete process.exitCode;
    const { aggregate } = await runEvaluation.main();

    expect(aggregate.failed).toBe(1);
    expect(process.exitCode).toBeUndefined();
  });
});
