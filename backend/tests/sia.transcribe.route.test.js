// Route/controller tests for POST /sia/transcriptions (Workstream 2):
// backend/Controllers/SiaControllers/transcribe.js,
// backend/Middlewares/audioUpload.js, backend/Routes/sia.routes.js.
//
// backend/sia/config and backend/sia/transcriptionService are mocked --
// no real environment variable (beyond a placeholder GROQ_API_KEY used
// ONLY for readiness's presence check), MongoDB, Redis, ML service, or
// provider call is ever made. Authentication (Middlewares/Auth.js's
// verifyToken) runs for real via a locally-signed JWT, the same pattern
// tests/sia.ask.test.js already established.
//
// Performance note: unlike several sibling SIA test files (e.g.
// tests/sia.readiness.groq.test.js), this file uses jest.mock() (hoisted,
// static, evaluated ONCE) plus a SINGLE require("../app") for the whole
// file, instead of jest.doMock()+jest.resetModules()+require("../app") per
// test. Per-test variation (voice-readiness flags, size limits,
// transcribeAudio's mocked result) is achieved by mutating the shared
// mocked config object's properties and reconfiguring the shared
// transcribeAudio jest.fn()'s implementation, restored in afterEach. This
// sandbox has been observed taking 20-55s for EACH jest.resetModules()+
// require("../app") cycle (see the dedicated note in
// tests/sia.readiness.groq.test.js) -- with ~25+ cases in this file, the
// per-test-cold-load pattern would take this file well past any practical
// budget. The single-load pattern pays that cost once for the whole file.
"use strict";

const { EventEmitter } = require("events");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-transcribe-test-secret";
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

const DEFAULT_TRANSCRIBE_RESULT = {
  transcript: "Show me last month's spending.",
  detectedLanguage: "en",
  durationMs: 2840,
};

// ---------------------------------------------------------------------
// Static, hoisted mocks -- evaluated ONCE for the whole file (see the
// performance note above). `config` is a single mutable object shared by
// every test; each test that needs a different shape mutates it directly
// and afterEach() restores the full default.
// ---------------------------------------------------------------------
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

jest.mock("../utils/mlServiceClient", () => new Proxy(
  {},
  {
    get() {
      return jest.fn(async () => {
        throw new Error("transcriptions must never call the ML service client");
      });
    },
  }
));

const config = require("../sia/config");
const { transcribeAudio: transcribeAudioMock, TranscriptionProviderError } = require("../sia/transcriptionService");
const { askLlm: askLlmMock } = require("../sia/llmService");
const { buildContext: buildContextMock } = require("../sia/contextBuilder");
const sessionServiceMock = require("../sia/sessionService");

// The app is required exactly once for the whole file, AFTER every
// jest.mock() above (jest.mock calls are hoisted above this line by Jest's
// transform regardless of source order, so this is safe).
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
  transcribeAudioMock.mockImplementation(async () => DEFAULT_TRANSCRIBE_RESULT);
  askLlmMock.mockClear();
  buildContextMock.mockClear();
  for (const fn of Object.values(sessionServiceMock)) {
    if (jest.isMockFunction(fn)) fn.mockClear();
  }
});

function signToken(userId) {
  return jwt.sign({ email: "sia-transcribe-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// ---------------------------------------------------------------------
// Fixtures -- minimal synthetic byte buffers, never real audio.
// ---------------------------------------------------------------------
function padTo(buffer, length) {
  if (buffer.length >= length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(length - buffer.length)]);
}

function webmFixture(totalSize = 32) {
  return padTo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]), totalSize);
}

function notAudioFixture() {
  return Buffer.from("this is just a plain text file, not audio at all!!", "utf8");
}

describe("POST /sia/transcriptions", () => {
  describe("authentication", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app).post("/sia/transcriptions").attach("audio", webmFixture(), {
        filename: "clip.webm",
        contentType: "audio/webm",
      });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: "Authorization token missing" });
    });

    it("returns 401 for an invalid token", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", "Bearer not-a-valid-token")
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(401);
    });
  });

  describe("readiness gate", () => {
    it("returns 503 when voice input is not configured (voiceEnabled=false), before any upload parsing", async () => {
      config.voiceEnabled = false;
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-1")}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, message: "SIA voice input is temporarily unavailable." });
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });

    it("returns 503 when GROQ_API_KEY is absent", async () => {
      delete process.env.GROQ_API_KEY;
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-1b")}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(503);
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });
  });

  describe("upload field validation", () => {
    it("returns 400 when the audio field is entirely missing", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-2")}`)
        .field("languageHint", "en");

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });

    it("returns 400 when the file is attached under the wrong field name", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-3")}`)
        .attach("file", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(400);
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });

    it("returns 413 when the file exceeds SIA_STT_MAX_BYTES", async () => {
      config.sttMaxBytes = 16;
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-4")}`)
        .attach("audio", webmFixture(64), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(413);
      expect(res.body).toEqual({ success: false, message: "Audio file exceeds the maximum allowed size." });
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });

    it("returns 400 for an invalid languageHint", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-5")}`)
        .field("languageHint", "not a valid hint!!!")
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(400);
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });
  });

  describe("container-signature validation (never trusts the client Content-Type/filename)", () => {
    it("returns 415 for a text file renamed to .webm with a lying Content-Type", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-6")}`)
        .attach("audio", notAudioFixture(), { filename: "recording.webm", contentType: "audio/webm" });

      expect(res.status).toBe(415);
      expect(res.body).toEqual({ success: false, message: "Unsupported or unrecognized audio format." });
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });

    it("returns 415 for real bytes that simply don't match any accepted container", async () => {
      const randomBytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-7")}`)
        .attach("audio", randomBytes, { filename: "clip.bin", contentType: "audio/webm" });

      expect(res.status).toBe(415);
      expect(transcribeAudioMock).not.toHaveBeenCalled();
    });

    it("accepts a genuine WebM signature even if the client's Content-Type header disagrees", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-8")}`)
        // Client lies and claims JSON; the real bytes are still WebM.
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "application/json" });

      expect(res.status).toBe(200);
      expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
      expect(transcribeAudioMock.mock.calls[0][0].mimeType).toBe("audio/webm");
    });
  });

  describe("success", () => {
    it("returns exactly { success: true, transcript, detectedLanguage, durationMs } for a valid upload", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-9")}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        success: true,
        transcript: "Show me last month's spending.",
        detectedLanguage: "en",
        durationMs: 2840,
      });
    });

    it("ignores the client-supplied filename entirely (never forwarded to the provider)", async () => {
      await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-10")}`)
        .attach("audio", webmFixture(), { filename: "../../etc/passwd.webm", contentType: "audio/webm" });

      expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
      expect(transcribeAudioMock.mock.calls[0][0].filename).not.toContain("passwd");
      expect(transcribeAudioMock.mock.calls[0][0].filename).not.toContain("etc");
    });

    it("never accepts or acts on a `question` field, and never touches the answer/session/ML pipeline", async () => {
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-11")}`)
        .field("question", "What did I spend last month?")
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("answer");
      expect(res.body).not.toHaveProperty("intent");
      expect(res.body).not.toHaveProperty("sessionId");
      expect(askLlmMock).not.toHaveBeenCalled();
      expect(buildContextMock).not.toHaveBeenCalled();
      expect(sessionServiceMock.createSession).not.toHaveBeenCalled();
      expect(sessionServiceMock.appendTurn).not.toHaveBeenCalled();
      expect(sessionServiceMock.findOwnedSession).not.toHaveBeenCalled();
    });
  });

  describe("provider failure mapping", () => {
    it("maps PROVIDER_EMPTY_OUTPUT to 422", async () => {
      transcribeAudioMock.mockImplementation(async () => {
        throw new TranscriptionProviderError("no usable transcript", {
          code: "PROVIDER_EMPTY_OUTPUT",
          provider: "groq",
        });
      });
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-12")}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain("groq");
      expect(JSON.stringify(res.body)).not.toContain("PROVIDER_EMPTY_OUTPUT");
    });

    it.each([
      "PROVIDER_TIMEOUT",
      "PROVIDER_NETWORK_ERROR",
      "PROVIDER_HTTP_ERROR",
      "PROVIDER_MALFORMED_RESPONSE",
      "PROVIDER_NOT_CONFIGURED",
      "PROVIDER_API_KEY_NOT_CONFIGURED",
      "PROVIDER_NOT_IMPLEMENTED",
      "MODEL_NOT_CONFIGURED",
    ])("maps %s to a generic 503 with no provider/key/model/code detail", async (code) => {
      transcribeAudioMock.mockImplementation(async () => {
        throw new TranscriptionProviderError("internal failure detail SENSITIVE_MARKER", {
          code,
          provider: "groq",
        });
      });
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken(`user-13-${code}`)}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, message: "SIA voice input is temporarily unavailable." });
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain("groq");
      expect(raw).not.toContain(code);
      expect(raw).not.toContain("SENSITIVE_MARKER");
    });

    it("maps an unexpected thrown error (not a TranscriptionProviderError) to a generic 503, never crashing", async () => {
      transcribeAudioMock.mockImplementation(async () => {
        throw new Error("some unexpected internal detail SENSITIVE_MARKER");
      });
      const res = await request(app)
        .post("/sia/transcriptions")
        .set("Authorization", `Bearer ${signToken("user-14")}`)
        .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

      expect(res.status).toBe(503);
      expect(JSON.stringify(res.body)).not.toContain("SENSITIVE_MARKER");
    });
  });

  describe("rate limiting -- siaVoiceLimiter is a SEPARATE bucket from siaLimiter", () => {
    it("exhausting the voice limiter's budget does not affect a sibling route guarded by siaLimiter", async () => {
      // A bare, minimal app (not backend/app.js) exercising the REAL
      // utils/rateLimiter.js exports directly -- proves siaLimiter and
      // siaVoiceLimiter are two independently-exhaustible rate-limit
      // instances/stores, without needing a full authenticated round trip
      // per request, and without touching the shared `app` above (so it
      // never pollutes that app's own siaVoiceLimiter budget for other
      // tests in this file).
      const express = require("express");
      const { siaLimiter, siaVoiceLimiter } = jest.requireActual("../utils/rateLimiter");

      const testApp = express();
      testApp.get("/voice-guarded", siaVoiceLimiter, (req, res) => res.status(200).json({ ok: true }));
      testApp.get("/ask-guarded", siaLimiter, (req, res) => res.status(200).json({ ok: true }));

      // siaVoiceLimiter's budget is 15/15min (see utils/rateLimiter.js) --
      // exhaust it with 16 requests from the same (test) IP.
      let lastVoiceStatus;
      for (let i = 0; i < 16; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(testApp).get("/voice-guarded");
        lastVoiceStatus = res.status;
      }
      expect(lastVoiceStatus).toBe(429);

      // The sibling route, guarded by the DIFFERENT siaLimiter instance,
      // must still be open -- proving the two limiters do not share a
      // store/bucket.
      const askGuardedRes = await request(testApp).get("/ask-guarded");
      expect(askGuardedRes.status).toBe(200);
    });

    it("siaLimiter and siaVoiceLimiter are distinct middleware instances", () => {
      const { siaLimiter, siaVoiceLimiter } = jest.requireActual("../utils/rateLimiter");
      expect(siaLimiter).not.toBe(siaVoiceLimiter);
    });
  });

  describe("privacy: no audio/transcript/Authorization-header content is ever logged", () => {
    it("logs only safe metadata (event/provider/errorCode/latencyMs) on success -- never the transcript or audio bytes", async () => {
      const uniqueTranscriptMarker = "SIA_TEST_TRANSCRIPT_MARKER_9f3e";
      transcribeAudioMock.mockImplementation(async () => ({
        transcript: uniqueTranscriptMarker,
        detectedLanguage: "en",
        durationMs: 1234,
      }));
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const audioBuffer = webmFixture();
      const authHeaderValue = `Bearer ${signToken("user-15")}`;

      try {
        const res = await request(app)
          .post("/sia/transcriptions")
          .set("Authorization", authHeaderValue)
          .attach("audio", audioBuffer, { filename: "clip.webm", contentType: "audio/webm" });

        expect(res.status).toBe(200);

        for (const call of logSpy.mock.calls) {
          const serializedCall = JSON.stringify(call);
          expect(serializedCall).not.toContain(uniqueTranscriptMarker);
          expect(serializedCall).not.toContain(authHeaderValue);
          expect(serializedCall).not.toContain(audioBuffer.toString("base64"));
        }
      } finally {
        logSpy.mockRestore();
      }
    });

    it("logs only safe metadata on failure -- never a raw provider detail, audio bytes, or Authorization header", async () => {
      transcribeAudioMock.mockImplementation(async () => {
        throw new TranscriptionProviderError("SENSITIVE_PROVIDER_DETAIL_MARKER", {
          code: "PROVIDER_HTTP_ERROR",
          provider: "groq",
        });
      });
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const authHeaderValue = `Bearer ${signToken("user-16")}`;

      try {
        const res = await request(app)
          .post("/sia/transcriptions")
          .set("Authorization", authHeaderValue)
          .attach("audio", webmFixture(), { filename: "clip.webm", contentType: "audio/webm" });

        expect(res.status).toBe(503);

        for (const call of logSpy.mock.calls) {
          const serializedCall = JSON.stringify(call);
          expect(serializedCall).not.toContain("SENSITIVE_PROVIDER_DETAIL_MARKER");
          expect(serializedCall).not.toContain(authHeaderValue);
        }
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("no disk persistence / no retained buffer reference", () => {
    it("uses multer.memoryStorage() -- Middlewares/audioUpload.js never configures diskStorage", () => {
      const audioUploadSource = require("fs").readFileSync(
        require.resolve("../Middlewares/audioUpload.js"),
        "utf8"
      );
      expect(audioUploadSource).toContain("memoryStorage");
      expect(audioUploadSource).not.toContain("diskStorage");
    });
  });

  describe("no accidental ML_ROUTE / ml-service import", () => {
    it("transcribe.js and transcriptionService.js never actually `require()` the ML service client or router (comments mentioning them by name are fine)", () => {
      const fs = require("fs");
      const transcribeSource = fs.readFileSync(
        require.resolve("../Controllers/SiaControllers/transcribe.js"),
        "utf8"
      );
      const serviceSource = fs.readFileSync(require.resolve("../sia/transcriptionService.js"), "utf8");
      // Matches only an actual `require("...mlServiceClient...")` /
      // `require("...ml.router...")` call -- never a plain-English mention
      // of those module names inside a documentation comment (this file's
      // own header comments legitimately explain what is NOT imported,
      // which would otherwise trip a naive whole-source substring check).
      const REQUIRES_ML_SERVICE_CLIENT = /require\(\s*["'][^"']*mlServiceClient[^"']*["']\s*\)/;
      const REQUIRES_ML_ROUTER = /require\(\s*["'][^"']*ml\.router[^"']*["']\s*\)/;
      for (const source of [transcribeSource, serviceSource]) {
        expect(source).not.toMatch(REQUIRES_ML_SERVICE_CLIENT);
        expect(source).not.toMatch(REQUIRES_ML_ROUTER);
        expect(source).not.toMatch(/process\.env\.ML_ROUTE/);
      }
    });
  });

  // Abort lifecycle contract (found by diagnosing a production
  // PROVIDER_REQUEST_ABORTED failure at ~5-16ms latency -- far too fast
  // for a real Groq round trip to ever complete). Root cause: Node's `req`
  // (http.IncomingMessage) fires its 'close' event once the request body
  // has been FULLY READ -- which happens on every normal request, shortly
  // after multer finishes parsing the multipart body, regardless of
  // whether the client is still connected or a response has been sent yet.
  // The previous implementation treated that event as proof of a
  // disconnected client and aborted the in-flight Groq call almost
  // immediately on every request. The corrected contract below is what
  // Controllers/SiaControllers/transcribe.js must implement:
  //   - normal upload completion (req 'close' alone) must NOT abort;
  //   - req 'aborted' MUST abort (a genuine connection-level abort);
  //   - res 'close' aborts ONLY when res.writableEnded is still false
  //     (the connection died before the response finished sending);
  //   - a res 'close' that fires after normal completion must NOT abort;
  //   - both listeners must be removed once the request settles, so a
  //     stray late event is always a no-op;
  //   - the provider timeout (SIA_STT_TIMEOUT_MS, enforced independently
  //     inside sia/transcriptionService.js's axios call) is unaffected by
  //     any of this and is exercised by sia.transcriptionService.test.js.
  describe("abort lifecycle: only a genuine client disconnect cancels the in-flight provider call", () => {
    // Both req and res are real EventEmitters (matching Node's actual
    // http.IncomingMessage/http.ServerResponse) so 'close'/'aborted' can be
    // emitted deterministically without depending on real socket teardown
    // timing. `res.writableEnded` mirrors the real flag the corrected
    // implementation must consult -- false until .json() (standing in for
    // .end()) has actually been called, exactly like the real response
    // object.
    function buildReqRes() {
      const req = new EventEmitter();
      req.file = { buffer: webmFixture() };
      req.body = {};

      let respondedStatus = null;
      let respondedBody = null;
      const res = new EventEmitter();
      res.headersSent = false;
      res.writableEnded = false;
      res.status = function status(code) {
        respondedStatus = code;
        return this;
      };
      res.json = function json(body) {
        respondedBody = body;
        this.headersSent = true;
        this.writableEnded = true;
        return this;
      };

      return { req, res, getResponded: () => ({ status: respondedStatus, body: respondedBody }) };
    }

    // A provider call that stays pending until either the abort signal
    // fires (rejects with PROVIDER_REQUEST_ABORTED, mirroring
    // transcriptionService.js's real axios-abort mapping) or the test
    // explicitly resolves it via resolveNow() -- lets a single test prove
    // BOTH "an early event does not touch this call" and "the call still
    // completes normally afterward".
    function pendingTranscribeMock() {
      let capturedSignal;
      let settle;
      const pending = new Promise((resolve, reject) => {
        settle = { resolve, reject };
      });
      transcribeAudioMock.mockImplementation(({ signal }) => {
        capturedSignal = signal;
        signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.code = "PROVIDER_REQUEST_ABORTED";
          settle.reject(err);
        });
        return pending;
      });
      return {
        getSignal: () => capturedSignal,
        resolveNow: () => settle.resolve(DEFAULT_TRANSCRIBE_RESULT),
      };
    }

    it("a plain req 'close' event (normal body-read completion) does NOT abort the in-flight provider call", async () => {
      const { req, res, getResponded } = buildReqRes();
      const { getSignal, resolveNow } = pendingTranscribeMock();
      const { transcribe } = require("../Controllers/SiaControllers/transcribe");

      const transcribePromise = transcribe(req, res);
      await new Promise((resolve) => setImmediate(resolve));
      expect(getSignal()).toBeDefined();

      // Fires on EVERY normal request once the body has been fully read --
      // well before the response has been produced -- never a disconnect
      // signal on its own.
      req.emit("close");
      await new Promise((resolve) => setImmediate(resolve));

      expect(getSignal().aborted).toBe(false);
      expect(getResponded().status).toBeNull();

      // The (never-aborted) provider call still completes normally.
      resolveNow();
      await transcribePromise;

      expect(getResponded().status).toBe(200);
      expect(getResponded().body).toEqual({
        success: true,
        transcript: DEFAULT_TRANSCRIBE_RESULT.transcript,
        detectedLanguage: DEFAULT_TRANSCRIBE_RESULT.detectedLanguage,
        durationMs: DEFAULT_TRANSCRIBE_RESULT.durationMs,
      });
    });

    it("req 'aborted' aborts the in-flight provider call and responds with the generic 503", async () => {
      const { req, res, getResponded } = buildReqRes();
      const { getSignal } = pendingTranscribeMock();
      const { transcribe } = require("../Controllers/SiaControllers/transcribe");

      const unhandledRejections = [];
      const onUnhandledRejection = (err) => unhandledRejections.push(err);
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        const transcribePromise = transcribe(req, res);
        await new Promise((resolve) => setImmediate(resolve));
        expect(getSignal()).toBeDefined();

        req.emit("aborted");
        await transcribePromise;
        await new Promise((resolve) => setImmediate(resolve));

        expect(getSignal().aborted).toBe(true);
        expect(getResponded().status).toBe(503);
        expect(getResponded().body).toEqual({
          success: false,
          message: "SIA voice input is temporarily unavailable.",
        });
        expect(unhandledRejections).toHaveLength(0);
      } finally {
        process.removeListener("unhandledRejection", onUnhandledRejection);
      }
    });

    it("res 'close' while the response has not finished writing (res.writableEnded === false) aborts the in-flight call", async () => {
      const { req, res, getResponded } = buildReqRes();
      const { getSignal } = pendingTranscribeMock();
      const { transcribe } = require("../Controllers/SiaControllers/transcribe");

      const unhandledRejections = [];
      const onUnhandledRejection = (err) => unhandledRejections.push(err);
      process.on("unhandledRejection", onUnhandledRejection);

      try {
        const transcribePromise = transcribe(req, res);
        await new Promise((resolve) => setImmediate(resolve));
        expect(getSignal()).toBeDefined();
        expect(res.writableEnded).toBe(false);

        res.emit("close");
        await transcribePromise;
        await new Promise((resolve) => setImmediate(resolve));

        expect(getSignal().aborted).toBe(true);
        expect(getResponded().status).toBe(503);
        expect(unhandledRejections).toHaveLength(0);
      } finally {
        process.removeListener("unhandledRejection", onUnhandledRejection);
      }
    });

    it("a res 'close' that fires only after the response has already been sent (normal completion) never touches the abort controller", async () => {
      const { req, res, getResponded } = buildReqRes();
      const { getSignal, resolveNow } = pendingTranscribeMock();
      const { transcribe } = require("../Controllers/SiaControllers/transcribe");

      const transcribePromise = transcribe(req, res);
      await new Promise((resolve) => setImmediate(resolve));
      resolveNow();
      await transcribePromise;

      expect(getResponded().status).toBe(200);
      expect(res.writableEnded).toBe(true);

      // Node fires 'close' on the response too, once the underlying socket
      // is done with an ordinary completed response -- must never
      // retroactively abort anything or throw.
      expect(() => res.emit("close")).not.toThrow();
      expect(getSignal().aborted).toBe(false);
    });

    it("listeners are removed once the request settles via a provider failure, so a later aborted/close event is a no-op", async () => {
      const { req, res, getResponded } = buildReqRes();
      transcribeAudioMock.mockImplementation(async () => {
        throw new TranscriptionProviderError("boom", { code: "PROVIDER_HTTP_ERROR", provider: "groq" });
      });
      const { transcribe } = require("../Controllers/SiaControllers/transcribe");

      await transcribe(req, res);
      expect(getResponded().status).toBe(503);

      expect(() => req.emit("aborted")).not.toThrow();
      expect(() => res.emit("close")).not.toThrow();
    });
  });
});
