"use strict";

// OCR-006-T04 -- unit tests for groqVisionBenchmark.js. Every network call
// is mocked (fetchImpl is injected); this suite never talks to a real
// hosted API or a real local Ollama server, same convention as
// ocrEvaluation.runEvaluation.test.js mocking tesseract.js.
const path = require("path");
const {
  PROVIDERS,
  mimeTypeFor,
  extractJsonFromContent,
  callVisionApi,
  scoreVisionEntry,
  aggregate,
  parseArgs,
} = require("../scripts/ocrEvaluation/groqVisionBenchmark");

describe("mimeTypeFor", () => {
  test("maps known extensions and falls back for unknown ones", () => {
    expect(mimeTypeFor("a.jpg")).toBe("image/jpeg");
    expect(mimeTypeFor("a.JPEG")).toBe("image/jpeg");
    expect(mimeTypeFor("a.png")).toBe("image/png");
    expect(mimeTypeFor("a.gif")).toBe("application/octet-stream");
  });
});

describe("extractJsonFromContent", () => {
  test("parses a bare JSON object", () => {
    expect(extractJsonFromContent('{"amount": 100, "date": "2026-01-01"}')).toEqual({
      amount: 100,
      date: "2026-01-01",
    });
  });

  test("strips a ```json fence the model added despite instructions", () => {
    const content = '```json\n{"amount": 42}\n```';
    expect(extractJsonFromContent(content)).toEqual({ amount: 42 });
  });

  test("ignores a leading/trailing sentence around the JSON block", () => {
    const content = 'Here is the result:\n{"amount": 5}\nLet me know if you need anything else.';
    expect(extractJsonFromContent(content)).toEqual({ amount: 5 });
  });

  test("returns null for unparseable content instead of throwing", () => {
    expect(extractJsonFromContent("not json at all")).toBeNull();
    expect(extractJsonFromContent("")).toBeNull();
    expect(extractJsonFromContent(undefined)).toBeNull();
  });
});

describe("PROVIDERS", () => {
  test("ollama needs no API key and points at the local OpenAI-compatible endpoint", () => {
    expect(PROVIDERS.ollama.needsKey).toBe(false);
    expect(PROVIDERS.ollama.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(PROVIDERS.ollama.defaultModel).toBe("qwen3-vl:4b");
  });

  test("ollama gets a much longer timeout than groq, for CPU inference + cold model-load", () => {
    expect(PROVIDERS.ollama.timeoutMs).toBeGreaterThan(PROVIDERS.groq.timeoutMs);
    expect(PROVIDERS.ollama.timeoutMs).toBeGreaterThanOrEqual(120000);
  });

  test("ollama disables thinking via reasoning_effort: none (qwen3-vl is a thinking model)", () => {
    expect(PROVIDERS.ollama.extraBody).toEqual({ reasoning_effort: "none" });
    expect(PROVIDERS.groq.extraBody).toBeUndefined();
  });

  test("groq is kept for history but still declares a key requirement", () => {
    expect(PROVIDERS.groq.needsKey).toBe(true);
    expect(PROVIDERS.groq.apiKeyEnvVar).toBe("GROQ_API_KEY");
  });
});

describe("parseArgs", () => {
  test("defaults to groq with no flags (backward compatible)", () => {
    const args = parseArgs([]);
    expect(args.provider).toBe("groq");
    expect(args.model).toBe(PROVIDERS.groq.defaultModel);
    expect(args.url).toBe(PROVIDERS.groq.url);
    expect(args.delayMs).toBe(PROVIDERS.groq.delayMs);
    expect(args.timeoutMs).toBe(PROVIDERS.groq.timeoutMs);
    expect(args.needsKey).toBe(true);
  });

  test("--provider=ollama switches url/model/delay/timeout/needsKey together", () => {
    const args = parseArgs(["--provider=ollama"]);
    expect(args.provider).toBe("ollama");
    expect(args.model).toBe("qwen3-vl:4b");
    expect(args.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(args.delayMs).toBe(0);
    expect(args.timeoutMs).toBe(PROVIDERS.ollama.timeoutMs);
    expect(args.needsKey).toBe(false);
  });

  test("--timeout-ms overrides the provider's default", () => {
    const args = parseArgs(["--provider=ollama", "--timeout-ms=60000"]);
    expect(args.timeoutMs).toBe(60000);
  });

  test("--model and --base-url override the provider's defaults", () => {
    const args = parseArgs(["--provider=ollama", "--model=glm-ocr", "--base-url=http://localhost:9999/v1/chat/completions"]);
    expect(args.model).toBe("glm-ocr");
    expect(args.url).toBe("http://localhost:9999/v1/chat/completions");
  });

  test("--limit and --delay-ms parse as numbers", () => {
    const args = parseArgs(["--limit=3", "--delay-ms=500"]);
    expect(args.limit).toBe(3);
    expect(args.delayMs).toBe(500);
  });

  test("throws on an unknown provider instead of silently misconfiguring", () => {
    expect(() => parseArgs(["--provider=openai"])).toThrow(/Unknown --provider/);
  });
});

describe("callVisionApi", () => {
  const imagePath = path.join(__dirname, "..", "scripts", "ocrEvaluation", "corpus", "images", "clean-simple.png");

  test("returns parsed structured output on a 200 response", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: '{"merchantName":"Coffee House","amount":245,"currency":"INR","date":"2026-03-12","confidence":"high"}' } }],
        }),
    });

    const result = await callVisionApi({ url: PROVIDERS.ollama.url, apiKey: "unused", imagePath, model: "qwen3-vl:4b", fetchImpl });

    expect(result.ok).toBe(true);
    expect(result.parsed.amount).toBe(245);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe(PROVIDERS.ollama.url);
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("qwen3-vl:4b");
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  test("merges extraBody into the request (e.g. reasoning_effort for ollama)", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
    });
    await callVisionApi({
      url: PROVIDERS.ollama.url,
      apiKey: "unused",
      imagePath,
      model: "qwen3-vl:4b",
      fetchImpl,
      extraBody: PROVIDERS.ollama.extraBody,
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("none");
  });

  test("works with no API key (local provider) by sending a placeholder bearer token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "{}" } }] }),
    });
    await callVisionApi({ url: PROVIDERS.ollama.url, apiKey: undefined, imagePath, model: "qwen3-vl:4b", fetchImpl });
    const [, opts] = fetchImpl.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer unused");
  });

  test("reports a non-2xx response as a failure without throwing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" });
    const result = await callVisionApi({ url: PROVIDERS.groq.url, apiKey: "test-key", imagePath, model: "some-model", fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });

  test("reports an unparseable model reply as a failure without throwing", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "sorry, I can't help with that" } }] }),
    });
    const result = await callVisionApi({ url: PROVIDERS.groq.url, apiKey: "test-key", imagePath, model: "some-model", fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/parseable JSON/);
  });

  test("reports a timeout as a failure without throwing", async () => {
    const fetchImpl = jest.fn(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const result = await callVisionApi({ url: PROVIDERS.groq.url, apiKey: "test-key", imagePath, model: "some-model", fetchImpl, timeoutMs: 5 });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });
});

describe("scoreVisionEntry", () => {
  const entry = {
    id: "clean-simple",
    source: "synthetic",
    groundTruth: { expenseName: "Coffee House", expenseAmount: 245, expenseDate: "2026-03-12" },
  };

  test("passes when amount and date both match, regardless of merchant wording", () => {
    const scored = scoreVisionEntry(entry, {
      merchantName: "THE COFFEE HOUSE LTD",
      amount: 245,
      date: "2026-03-12",
      confidence: "high",
    });
    expect(scored.passed).toBe(true);
    expect(scored.amountMatch).toBe(true);
    expect(scored.dateMatch).toBe(true);
    expect(scored.merchantMatch).toBe(true);
  });

  test("fails on an amount mismatch even if the date matches", () => {
    const scored = scoreVisionEntry(entry, { merchantName: "Coffee House", amount: 999, date: "2026-03-12" });
    expect(scored.passed).toBe(false);
    expect(scored.amountMatch).toBe(false);
    expect(scored.dateMatch).toBe(true);
  });

  test("treats a null amount/date as matching a null ground truth", () => {
    const noAmountEntry = { id: "no-amount", source: "synthetic", groundTruth: { expenseName: "Book Nook", expenseAmount: null, expenseDate: "2026-07-18" } };
    const scored = scoreVisionEntry(noAmountEntry, { merchantName: "Book Nook", amount: null, date: "2026-07-18" });
    expect(scored.amountMatch).toBe(true);
    expect(scored.passed).toBe(true);
  });

  test("does not throw when the model call failed and parsed is undefined-shaped", () => {
    const scored = scoreVisionEntry(entry, {});
    expect(scored.amountMatch).toBe(false);
    expect(scored.passed).toBe(false);
  });
});

describe("aggregate", () => {
  test("separates API call failures from scored pass/fail and computes rates over scored entries only", () => {
    const results = [
      { id: "a", passed: true, amountMatch: true, dateMatch: true, merchantMatch: true, callFailed: false },
      { id: "b", passed: false, amountMatch: false, dateMatch: true, merchantMatch: true, callFailed: false },
      { id: "c", callFailed: true, error: "timed out" },
    ];
    const agg = aggregate(results);
    expect(agg.total).toBe(3);
    expect(agg.scored).toBe(2);
    expect(agg.callFailed).toBe(1);
    expect(agg.passed).toBe(1);
    expect(agg.passRate).toBe(50);
    expect(agg.failingIds).toEqual(["b"]);
    expect(agg.callFailedIds).toEqual(["c"]);
  });
});
