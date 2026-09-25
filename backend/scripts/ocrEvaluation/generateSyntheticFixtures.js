"use strict";

// OCR-003-T07 -- generates the corpus/images/*.png smoke-test fixtures and
// corpus/manifest.json committed alongside this script.
//
// These are SYNTHETIC, not real receipts. They exist to exercise the
// evaluation harness itself (does the wiring, scoring and reporting work at
// all) and to catch regressions in the deterministic parts of the pipeline
// (amount selection/ambiguity, date matching, the heading-collision guess,
// the no-amount/no-date/no-text paths). They are NOT a representative
// evaluation set: rendered SVG text has none of the thermal-print fade,
// skew, crumpling or lighting variance that make real OCR hard, and their
// ground truth deliberately excludes Tesseract's confidence output for
// exactly that reason (see scoring.js's CONFIDENCE_REVIEW_REASONS). See
// corpus/README.md for what actually closes that gap.
//
// Run manually -- not part of `npm test` or CI -- whenever a fixture needs
// to change: `node scripts/ocrEvaluation/generateSyntheticFixtures.js`.

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMAGES_DIR = path.join(__dirname, "corpus", "images");
const MANIFEST_PATH = path.join(__dirname, "corpus", "manifest.json");

const escapeXml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Renders `lines` (top to bottom) as a plain white receipt-shaped PNG.
// Deliberately large, high-contrast, single monospace font: legibility is
// not the thing under test here -- see the module comment above.
const renderReceipt = (lines) => {
  const width = 480;
  const lineHeight = 34;
  const paddingTop = 30;
  const height = paddingTop + Math.max(1, lines.length) * lineHeight + 20;
  const textEls = lines
    .map(
      (line, i) =>
        `<text x="20" y="${paddingTop + i * lineHeight}" font-family="monospace" font-size="24" fill="black">${escapeXml(line)}</text>`
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${textEls}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

// Each fixture's `lines` are the exact text this script renders AND the
// text ocrEvaluation.runEvaluation.test.js feeds back through a mocked
// extractTextFromImage() -- one source of truth for both the image and the
// canned-OCR test double, so they cannot silently drift apart.
const FIXTURES = [
  {
    id: "clean-simple",
    lines: ["Coffee House", "1 Latte", "Total 245.00", "12/03/2026"],
    groundTruth: {
      expenseName: "Coffee House",
      expenseAmount: 245,
      expenseDate: "2026-03-12",
      expectReviewReasons: [],
    },
    notes: "Baseline: clean single total, unambiguous date, no heading collision.",
  },
  {
    id: "ambiguous-total",
    lines: ["Green Grocer", "Subtotal 100.00", "Total 100.00", "Total 118.00", "05/01/2026"],
    groundTruth: {
      // Two disagreeing "Total"-labelled lines with no grand total present:
      // the selection rule takes the LAST one. The ground truth below is
      // the value that rule is expected to pick, not an independently
      // "true" total -- this fixture tests the selection + the
      // AMBIGUOUS_AMOUNT flag, not real-world total detection.
      expenseName: "Green Grocer",
      expenseAmount: 118,
      expenseDate: "2026-01-05",
      expectReviewReasons: ["AMBIGUOUS_AMOUNT"],
    },
    notes: "Two differing Total lines -- exercises extractAmount's ambiguity flag.",
  },
  {
    id: "no-amount",
    lines: ["Book Nook", "1 Novel", "1 Bookmark", "18/07/2026"],
    groundTruth: {
      expenseName: "Book Nook",
      expenseAmount: null,
      expenseDate: "2026-07-18",
      expectReviewReasons: ["NO_AMOUNT_FOUND"],
    },
    notes: "No total/grand total keyword anywhere -- exercises NO_AMOUNT_FOUND.",
  },
  {
    id: "no-date",
    lines: ["Corner Bakery", "Total 60.00"],
    groundTruth: {
      expenseName: "Corner Bakery",
      expenseAmount: 60,
      expenseDate: null,
      expectReviewReasons: ["NO_DATE_FOUND"],
    },
    notes: "No date pattern anywhere -- exercises NO_DATE_FOUND.",
  },
  {
    id: "heading-collision",
    lines: ["Tax Invoice", "Star Mart", "Total 320.50", "22/09/2026"],
    groundTruth: {
      // extractMerchant() is positional over the WHOLE document, so it
      // reads "Tax Invoice" (the first two words), not the true merchant
      // "Star Mart" on the next line -- the documented limitation in
      // receiptExtractors.js, deliberately kept as a caution flag rather
      // than a silent rewrite. merchantMatch is therefore expected to be
      // FALSE for this entry; that is the point of the fixture, not a
      // failure (merchant match is informational only -- see scoring.js).
      expenseName: "Star Mart",
      expenseAmount: 320.5,
      expenseDate: "2026-09-22",
      expectReviewReasons: ["MERCHANT_LOOKS_LIKE_HEADING"],
    },
    notes: "First line is a document heading -- exercises MERCHANT_LOOKS_LIKE_HEADING.",
  },
  {
    id: "blank-image",
    lines: [],
    groundTruth: {
      expenseName: "",
      expenseAmount: null,
      expenseDate: null,
      expectReviewReasons: ["NO_TEXT_RECOGNISED", "NO_AMOUNT_FOUND", "NO_DATE_FOUND"],
    },
    notes: "No text at all -- exercises NO_TEXT_RECOGNISED (and the amount/date reasons it implies).",
  },
];

async function main() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const manifest = {
    version: 1,
    generatedBy: "scripts/ocrEvaluation/generateSyntheticFixtures.js",
    corpusType: "synthetic-smoke-test",
    note: "SYNTHETIC ONLY -- not a representative evaluation set. See corpus/README.md.",
    entries: [],
  };

  for (const fixture of FIXTURES) {
    // Sequential on purpose (not Promise.all): a handful of small fixtures,
    // run manually and rarely, and sequential keeps output order matching
    // FIXTURES order, which the paired test relies on.
    const buf = await renderReceipt(fixture.lines);
    const filename = `${fixture.id}.png`;
    fs.writeFileSync(path.join(IMAGES_DIR, filename), buf);
    manifest.entries.push({
      id: fixture.id,
      image: `images/${filename}`,
      source: "synthetic",
      anonymized: true,
      groundTruth: fixture.groundTruth,
      notes: fixture.notes,
    });
    console.log(`wrote ${filename}`);
  }

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote manifest.json (${manifest.entries.length} entries)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("generateSyntheticFixtures crashed:", err);
    process.exit(1);
  });
}

module.exports = { FIXTURES, renderReceipt, IMAGES_DIR, MANIFEST_PATH };
