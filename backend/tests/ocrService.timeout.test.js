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
    // A timeout already burned its full budget -- it must not be retried.
    expect(worker.recognize).toHaveBeenCalledTimes(1);
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

  it("returns layout-preserving text, overall confidence, and per-line confidence after success", async () => {
    const worker = {
      recognize: jest.fn(async () => ({
        data: {
          text: "Fresh\n\nMart   Total  120",
          confidence: 87.5,
          blocks: [
            {
              paragraphs: [
                {
                  lines: [
                    { text: "Fresh", confidence: 91 },
                    { text: "Mart   Total  120", confidence: 84 },
                  ],
                },
              ],
            },
          ],
        },
      })),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    await expect(extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1_000 })).resolves.toEqual({
      text: "Fresh\nMart Total 120",
      confidence: 87.5,
      lines: [
        { text: "Fresh", confidence: 91 },
        { text: "Mart Total 120", confidence: 84 },
      ],
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("falls back to null confidence and text-derived lines when blocks/confidence weren't returned", async () => {
    const worker = {
      recognize: jest.fn(async () => ({ data: { text: "Fresh\n\nMart   Total  120" } })),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    await expect(extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1_000 })).resolves.toEqual({
      text: "Fresh\nMart Total 120",
      confidence: null,
      lines: [
        { text: "Fresh", confidence: null },
        { text: "Mart Total 120", confidence: null },
      ],
    });
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("retries once after a transient failure and succeeds", async () => {
    let calls = 0;
    const worker = {
      recognize: jest.fn(async () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("transient failure");
        }
        return { data: { text: "Retry Works 42.00", confidence: 70 } };
      }),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    const result = await extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1_000 });

    expect(result.text).toBe("Retry Works 42.00");
    expect(worker.recognize).toHaveBeenCalledTimes(2);
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });

  it("fails with OCR_PROCESSING_FAILED after exhausting retries on repeated transient failures", async () => {
    const worker = {
      recognize: jest.fn(async () => {
        throw new Error("always fails");
      }),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    await expect(extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1_000 })).rejects.toMatchObject({
      code: "OCR_PROCESSING_FAILED",
    });
    // Default maxAttempts is 2: one initial attempt plus one retry.
    expect(worker.recognize).toHaveBeenCalledTimes(2);
  });

  it("respects a custom maxAttempts option", async () => {
    const worker = {
      recognize: jest.fn(async () => {
        throw new Error("always fails");
      }),
      terminate: jest.fn(async () => {}),
    };
    const { extractTextFromImage } = loadOcrService(worker);

    await expect(
      extractTextFromImage(Buffer.from("receipt"), { timeoutMs: 1_000, maxAttempts: 3 })
    ).rejects.toMatchObject({ code: "OCR_PROCESSING_FAILED" });
    expect(worker.recognize).toHaveBeenCalledTimes(3);
  });
});
