const Tesseract = require("tesseract.js");

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

const extractTextFromImage = async (imageBuffer, { timeoutMs = getOcrTimeoutMs() } = {}) => {
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
    const recognition = activeWorker.recognize(imageBuffer);
    const result = await Promise.race([recognition, timeout]);
    const rawText = result.data.text
      .replace(/\n+/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
    return rawText;
  } catch (error) {
    if (error instanceof OcrProcessingError) throw error;
    throw new OcrProcessingError("OCR_PROCESSING_FAILED", "Receipt processing failed.");
  } finally {
    if (timer) clearTimeout(timer);
    await terminateWorker();
  }
};

module.exports = {
  OcrProcessingError,
  extractTextFromImage,
  getOcrTimeoutMs,
};
