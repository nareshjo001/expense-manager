const OCR_SERVICE_PATH = "../Services/BillServices/ocrService";

const loadOcrService = (worker) => {
  jest.resetModules();
  jest.doMock("tesseract.js", () => ({
    createWorker: jest.fn(async () => worker),
  }));
  return require(OCR_SERVICE_PATH);
};

describe("receipt OCR worker lifetime", () => {
  afterEach(() => {
    jest.dontMock("tesseract.js");
  });

  it("terminates the OCR worker after a timeout", async () => {
    const worker = {
      recognize: jest.fn(() => new Promise(() => {})),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    await expect(extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1 })).rejects.toMatchObject({
      code: "OCR_PROCESSING_TIMEOUT",
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates a worker that finishes starting after the timeout", async () => {
    let resolveWorker;
    const worker = {
      recognize: jest.fn(),
      terminate: jest.fn(async () => {}),
    };
    jest.resetModules();
    jest.doMock("tesseract.js", () => ({
      createWorker: jest.fn(() => new Promise((resolve) => {
        resolveWorker = resolve;
      })),
    }));
    const { extractTextFromImage } = require(OCR_SERVICE_PATH);

    await expect(extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1 })).rejects.toMatchObject({
      code: "OCR_PROCESSING_TIMEOUT",
    });
    resolveWorker(worker);
    await new Promise((resolve) => setImmediate(resolve));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("returns normalized text and terminates the worker after success", async () => {
    const worker = {
      recognize: jest.fn(async () => ({ data: { text: "Fresh\n\nMart   Total  120" } })),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    await expect(extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1_000 })).resolves.toBe("Fresh Mart Total 120");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
