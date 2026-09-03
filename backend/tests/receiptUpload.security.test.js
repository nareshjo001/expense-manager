const express = require("express");
const request = require("supertest");
const sharp = require("sharp");

const makePng = () => sharp({
  create: { width: 1, height: 1, channels: 3, background: { r: 255, g: 255, b: 255 } },
}).png().toBuffer();

const loadRoute = () => {
  jest.resetModules();
  jest.doMock("../Middlewares/Auth", () => (req, _res, next) => {
    req.userId = "receipt-test-user";
    next();
  });
  jest.doMock("../utils/rateLimiter", () => ({
    receiptLimiter: (_req, _res, next) => next(),
  }));
  jest.doMock("../Services/BillServices/imageProcessor", () => ({
    preprocessImage: jest.fn(async (buffer) => buffer),
  }));
  jest.doMock("../Services/BillServices/ocrService", () => ({
    extractTextFromImage: jest.fn(async () => "Fresh Mart Grand Total 125.50"),
  }));

  const app = express();
  app.use(require("../Routes/bill.routes"));
  return app;
};

describe("receipt upload security", () => {
  let originalInfo;

  beforeAll(() => {
    originalInfo = console.info;
    console.info = jest.fn();
  });

  afterAll(() => {
    console.info = originalInfo;
  });

  afterEach(() => {
    jest.dontMock("../Middlewares/Auth");
    jest.dontMock("../utils/rateLimiter");
    jest.dontMock("../Services/BillServices/imageProcessor");
    jest.dontMock("../Services/BillServices/ocrService");
  });

  it("processes a genuine PNG in memory and never returns its full OCR transcript", async () => {
    const app = loadRoute();
    const sensitiveFilename = "customer-financial-receipt.png";
    const response = await request(app)
      .post("/bill-upload")
      .attach("bill", await makePng(), { filename: sensitiveFilename, contentType: "image/png" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      success: true,
      parsedReceipt: expect.objectContaining({ expenseName: "Fresh Mart", expenseAmount: 125.5 }),
    }));
    expect(response.body.parsedReceipt.extractedText).toBeUndefined();
    expect(JSON.stringify(console.info.mock.calls)).not.toContain(sensitiveFilename);
  });

  it("rejects non-image bytes that falsely claim to be a PNG", async () => {
    const app = loadRoute();
    const response = await request(app)
      .post("/bill-upload")
      .attach("bill", Buffer.from("not-an-image"), { filename: "receipt.png", contentType: "image/png" });

    expect(response.status).toBe(415);
    expect(response.body.code).toBe("RECEIPT_UNSUPPORTED_FILE");
  });

  it("rejects content whose declared MIME type disagrees with its signature", async () => {
    const app = loadRoute();
    const response = await request(app)
      .post("/bill-upload")
      .attach("bill", await makePng(), { filename: "receipt.jpg", contentType: "image/jpeg" });

    expect(response.status).toBe(415);
    expect(response.body.code).toBe("RECEIPT_MIME_MISMATCH");
  });

  it("rejects corrupted bytes that begin with a valid PNG signature", async () => {
    const app = loadRoute();
    const corruptedPng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24)]);
    const response = await request(app)
      .post("/bill-upload")
      .attach("bill", corruptedPng, { filename: "receipt.png", contentType: "image/png" });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("RECEIPT_IMAGE_INVALID");
  });

  it("rejects unsupported PDFs before they enter a decoder", async () => {
    const app = loadRoute();
    const response = await request(app)
      .post("/bill-upload")
      .attach("bill", Buffer.from("%PDF-1.7"), { filename: "receipt.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(415);
    expect(response.body.code).toBe("RECEIPT_UNSUPPORTED_FILE_TYPE");
  });

  it("rejects an upload over the byte limit before receipt processing", async () => {
    const app = loadRoute();
    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
    oversized.set(await makePng());
    const response = await request(app)
      .post("/bill-upload")
      .attach("bill", oversized, { filename: "receipt.png", contentType: "image/png" });

    expect(response.status).toBe(413);
    expect(response.body.code).toBe("RECEIPT_FILE_TOO_LARGE");
  });

  it("rejects a valid image whose decoded pixel count exceeds the limit", async () => {
    const { validateReceiptFile } = require("../Services/BillServices/receiptSecurity.service");
    const oversizedPixels = await sharp({
      create: { width: 5_000, height: 4_001, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    await expect(validateReceiptFile({
      buffer: oversizedPixels,
      size: oversizedPixels.length,
      mimetype: "image/png",
    })).rejects.toMatchObject({ code: "RECEIPT_IMAGE_TOO_LARGE", status: 413 });
  });

  it("rejects extra multipart fields before OCR work begins", async () => {
    const app = loadRoute();
    const response = await request(app)
      .post("/bill-upload")
      .field("unexpected", "field")
      .attach("bill", await makePng(), { filename: "receipt.png", contentType: "image/png" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("RECEIPT_UPLOAD_INVALID");
  });

  it("keeps receipt upload processing out of disk storage", () => {
    const uploadSource = require("fs").readFileSync(require.resolve("../Middlewares/upload"), "utf8");
    const controllerSource = require("fs").readFileSync(require.resolve("../Controllers/BillControllers/billController"), "utf8");

    expect(uploadSource).toContain("multer.memoryStorage()");
    expect(uploadSource).not.toContain("diskStorage");
    expect(controllerSource).not.toMatch(/fs\.unlink|req\.file\.path/);
  });

  it("enforces the authenticated receipt processing limit separately from the general API limit", async () => {
    jest.resetModules();
    const { receiptLimiter } = require("../utils/rateLimiter");
    const app = express();
    app.post("/receipt", (req, _res, next) => {
      req.userId = req.get("X-Test-User");
      next();
    }, receiptLimiter, (_req, res) => res.status(204).end());

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await request(app).post("/receipt").set("X-Test-User", "receipt-rate-user").expect(204);
    }

    const limited = await request(app).post("/receipt").set("X-Test-User", "receipt-rate-user");
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RECEIPT_RATE_LIMITED");
  });
});
