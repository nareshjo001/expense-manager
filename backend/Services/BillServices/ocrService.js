const Tesseract = require("tesseract.js");
// OCR-003-T01 -- the result shape is now a versioned contract rather than an
// ad-hoc object this module and receiptParser.js happened to agree on.
const { buildOcrResult, buildLine } = require("./ocrContract");
// OBS-001-T05 -- OCR metrics. Receipt processing degrades silently: it does
// not change an HTTP status a user sees, it just starts timing out or
// returning worse text, so request metrics can never reveal it.
const { recordOperation } = require("../../utils/metrics");

class OcrProcessingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const getOcrTimeoutMs = (env = process.env) => {
  const configured = Number(env.OCR_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(configured)) return 30_000;
  return Math.min(Math.max(Math.floor(configured), 1_000), 120_000);
};

// OCR-002: a transient failure (worker crash, a native decode hiccup) can
// succeed on a fresh attempt; a timeout is never retried here -- it has
// already burned its full budget, and retrying inline would just double
// the worst-case request latency for no better odds of success.
const getOcrMaxAttempts = (env = process.env) => {
  const configured = Number(env.OCR_MAX_ATTEMPTS ?? 2);
  if (!Number.isFinite(configured)) return 2;
  return Math.min(Math.max(Math.floor(configured), 1), 5);
};

// Collapse runs of horizontal whitespace within a line and drop blank
// lines, but keep the line breaks between lines. Previously this
// flattened every newline into a space, which destroyed the layout that
// field-level matching (which line the total is on, what sits beside it)
// depends on.
const normalizeLine = (line) => line.replace(/[ \t]+/g, " ").trim();

const normalizeLayout = (rawText) =>
  (rawText || "")
    .split("\n")
    .map(normalizeLine)
    .filter(Boolean)
    .join("\n")
    .trim();

// Build a per-line { text, confidence, bbox } list. Prefers Tesseract's
// block -> paragraph -> line hierarchy (only populated when recognize() is
// called with output.blocks: true) for a real per-line confidence score;
// falls back to the flattened text with null confidence and null bbox when
// blocks weren't returned, so callers can always rely on `lines` being an
// array rather than having to branch on whether OCR gave them detail.
//
// OCR-003-T02 -- each line now also carries its bounding box. Tesseract has
// always returned one alongside the per-line confidence; it was simply
// discarded here. Keeping it is what makes it possible to point at WHERE on
// the receipt a field came from -- to highlight the total the parser used
// when asking a user to confirm it, to crop that region for a re-read, or
// to tell "the total is missing" apart from "the total was found in a place
// that makes no sense". Discarding it meant every one of those needed a
// second OCR pass to recover information the first pass already had.
const buildLines = (blocks, normalizedText) => {
  const fromBlocks = [];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      for (const paragraph of block?.paragraphs || []) {
        for (const line of paragraph?.lines || []) {
          const text = normalizeLine(line?.text || "");
          if (!text) continue;
          fromBlocks.push(buildLine(text, line?.confidence, line?.bbox));
        }
      }
    }
  }
  if (fromBlocks.length) return fromBlocks;

  return normalizedText
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => buildLine(text, null, null));
};

// Runs a single OCR attempt end to end: create a worker, race it (and
// recognition) against the timeout, and always terminate the worker
// before returning or throwing.
const attemptRecognition = async (imageBuffer, timeoutMs) => {
  let worker;
  let timer;
  let terminated;

  const terminateWorker = async () => {
    if (!worker || terminated) return;
    terminated = true;
    await worker.terminate().catch(() => {});
  };

  try {
    let timedOut = false;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        void terminateWorker();
        reject(new OcrProcessingError("OCR_PROCESSING_TIMEOUT", "Receipt processing timed out."));
      }, timeoutMs);
    });
    const workerPromise = Tesseract.createWorker("eng").then(async (createdWorker) => {
      worker = createdWorker;
      if (timedOut) {
        await terminateWorker();
        return new Promise(() => {});
      }
      return worker;
    });
    const activeWorker = await Promise.race([workerPromise, timeout]);
    // output.blocks:true asks Tesseract for the block/paragraph/line
    // hierarchy (each with its own text + confidence + bbox) on top of
    // the flat text it always returns -- this is what buildLines() needs
    // for real per-line confidence.
    const recognition = activeWorker.recognize(imageBuffer, {}, { text: true, blocks: true });
    const result = await Promise.race([recognition, timeout]);

    const normalizedText = normalizeLayout(result.data.text);
    // result.data.confidence (the overall 0-100 mean confidence) is
    // always computed by Tesseract once recognition runs -- no extra
    // output flag needed -- but was previously discarded entirely.
    const confidence = typeof result.data.confidence === "number" ? result.data.confidence : null;
    const lines = buildLines(result.data.blocks, normalizedText);

    return buildOcrResult({ text: normalizedText, confidence, lines });
  } catch (error) {
    if (error instanceof OcrProcessingError) throw error;
    throw new OcrProcessingError("OCR_PROCESSING_FAILED", "Receipt processing failed.");
  } finally {
    if (timer) clearTimeout(timer);
    await terminateWorker();
  }
};

// Extracts a versioned OCR result (see ocrContract.js) from a receipt image, retrying a
// transient (non-timeout) failure up to getOcrMaxAttempts() times total.
// Each attempt gets a fresh worker and the same per-attempt timeout
// budget; a timeout is rethrown immediately without retrying.
const extractTextFromImage = async (
  imageBuffer,
  { timeoutMs = getOcrTimeoutMs(), maxAttempts = getOcrMaxAttempts() } = {}
) => {
  let lastError;
  const startedAt = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await attemptRecognition(imageBuffer, timeoutMs);
      recordOperation({ scope: "ocr", operation: "recognize", outcome: "success", durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      lastError = error;
      if (error instanceof OcrProcessingError && error.code === "OCR_PROCESSING_TIMEOUT") {
        // Timeouts are recorded separately from other failures: they mean
        // "too slow", which is a capacity signal, while a generic failure
        // usually means a decode or worker problem. Merging them would hide
        // whichever is rarer.
        recordOperation({ scope: "ocr", operation: "timeout", outcome: "failure", durationMs: Date.now() - startedAt });
        throw error;
      }
      // Transient failure: fall through and retry unless this was the
      // last allowed attempt, in which case the loop ends and lastError
      // is thrown below.
    }
  }
  recordOperation({ scope: "ocr", operation: "recognize", outcome: "failure", durationMs: Date.now() - startedAt });
  throw lastError;
};

module.exports = {
  OcrProcessingError,
  extractTextFromImage,
  getOcrTimeoutMs,
  getOcrMaxAttempts,
};
