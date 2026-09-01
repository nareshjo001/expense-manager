// Adversarial security tests (Workstream 5 review) -- static, source-level
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BACKEND_ROOT = path.resolve(__dirname, "..");

// Every file actually added/modified by the two SIA backend workstreams
const TOUCHED_PRODUCTION_FILES = [
  "sia/queryPlan.js",
  "sia/periodResolver.js",
  "sia/financialQueryService.js",
  "sia/factSet.js",
  "sia/semanticRouter.js",
  "sia/prohibitedPhrases.js",
  "sia/semanticPipeline.js",
  "sia/audioContainerSignature.js",
  "sia/transcriptionService.js",
  "sia/config.js",
  "sia/readiness.js",
  "sia/contextBuilder.js",
  "sia/groundingService.js",
  "sia/idempotencyService.js",
  "sia/intentClassifier.js",
  "sia/responseFormatter.js",
  "sia/responseValidator.js",
  "sia/sessionService.js",
  "Controllers/SiaControllers/ask.js",
  "Controllers/SiaControllers/status.js",
  "Controllers/SiaControllers/transcribe.js",
  "Middlewares/audioUpload.js",
  "utils/rateLimiter.js",
  "models/SiaMessage.js",
  "models/SiaRequest.js",
  "Routes/sia.routes.js",
];

// Non-production files also touched by this milestone that are
const APPROVED_NON_PRODUCTION_MILESTONE_FILES = ["sia/README.md"];

function readTouched() {
  return TOUCHED_PRODUCTION_FILES.map((rel) => ({
    rel,
    abs: path.join(BACKEND_ROOT, rel),
    source: fs.readFileSync(path.join(BACKEND_ROOT, rel), "utf8"),
  }));
}

describe("static file-list sanity (self-verifying against git, best-effort)", () => {
  it("every file in TOUCHED_PRODUCTION_FILES actually exists", () => {
    for (const rel of TOUCHED_PRODUCTION_FILES) {
      expect(fs.existsSync(path.join(BACKEND_ROOT, rel))).toBe(true);
    }
  });

  it("every file in APPROVED_NON_PRODUCTION_MILESTONE_FILES actually exists", () => {
    for (const rel of APPROVED_NON_PRODUCTION_MILESTONE_FILES) {
      expect(fs.existsSync(path.join(BACKEND_ROOT, rel))).toBe(true);
    }
  });

  it("cross-checks the hardcoded list against `git status --short backend/` when git is available (skips silently otherwise)", () => {
    let gitOutput;
    try {
      gitOutput = execSync("git status --short backend/", { cwd: path.resolve(BACKEND_ROOT, ".."), encoding: "utf8" });
    } catch (_err) {
      return; // git unavailable in this environment -- not a failure.
    }
    const gitTouchedSiaRelated = gitOutput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^[AM?]+\s+/, "").replace(/^backend\//, ""))
      .filter(
        (p) =>
          p.startsWith("sia/") ||
          p.startsWith("Controllers/SiaControllers/") ||
          p === "Middlewares/audioUpload.js" ||
          p === "utils/rateLimiter.js" ||
          /^models\/Sia.*\.js$/.test(p) ||
          p === "Routes/sia.routes.js"
      );
    // Validated against the UNION of the scanned production files and the
    const knownTouchedPaths = new Set([...TOUCHED_PRODUCTION_FILES, ...APPROVED_NON_PRODUCTION_MILESTONE_FILES]);
    for (const p of gitTouchedSiaRelated) {
      expect(knownTouchedPaths.has(p)).toBe(true);
    }
  });
});

describe("secret scan across every SIA-touched production file", () => {
  const SECRET_PATTERNS = [
    { name: "OpenAI-style key (sk-...)", pattern: /\bsk-[A-Za-z0-9]{20,}\b/ },
    { name: "Groq-style key (gsk_...)", pattern: /\bgsk_[A-Za-z0-9]{20,}\b/ },
    { name: "Google API key (AIza...)", pattern: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
    { name: "Slack-style token (xoxb-/xoxp-)", pattern: /\bxox[bp]-[A-Za-z0-9-]{10,}\b/ },
    {
      name: "known SIA env var assigned a non-empty literal value",
      pattern: /\b(GROQ_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY)\s*[:=]\s*["'][^"'\s]+["']/,
    },
    {
      name: "generic 32+ char hex/base64 assigned to a key/secret/token-named variable",
      pattern: /\b(?:api[_-]?key|secret|token|password|credential)\b\s*[:=]\s*["'][A-Za-z0-9+/_-]{32,}["']/i,
    },
  ];

  it.each(readTouched().map((f) => [f.rel, f]))("%s contains no hardcoded secret", (_rel, file) => {
    for (const { name, pattern } of SECRET_PATTERNS) {
      const match = file.source.match(pattern);
      expect({ file: file.rel, finding: name, match: match ? match[0] : null }).toEqual({
        file: file.rel,
        finding: name,
        match: null,
      });
    }
  });

  it("every real credential reference in these files is a process.env read, never a literal", () => {
    for (const file of readTouched()) {
      const envVarRefs = file.source.match(/\b(GROQ_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY)\b/g) || [];
      for (const ref of envVarRefs) {
        // Every occurrence of a credential env-var NAME in these files must
        const lines = file.source.split("\n").filter((l) => l.includes(ref));
        for (const line of lines) {
          expect(line).not.toMatch(new RegExp(`${ref}\\s*[:=]\\s*["'][^"'\\s]+["']`));
        }
      }
    }
  });
});

describe("safeLogger.js call-site scan across every SIA-touched file", () => {
  const ALLOWED_LOG_KEYS = new Set(["event", "provider", "errorCode", "latencyMs"]);
  // Variable/property names that must never appear as a VALUE inside a
  const FORBIDDEN_VALUE_IDENTIFIERS = [
    "question",
    "trimmedQuestion",
    "transcript",
    "answer",
    "llmResult",
    "contextResult",
    "context",
    "buffer",
    "req.file.buffer",
    "authorization",
    "req.headers",
    "systemPrompt",
  ];

  function extractLogSiaEventCalls(source) {
    const calls = [];
    const regex = /logSiaEvent\(\s*\{([\s\S]*?)\}\s*\)/g;
    let match = regex.exec(source);
    while (match !== null) {
      calls.push(match[1]);
      match = regex.exec(source);
    }
    return calls;
  }

  it.each(readTouched().map((f) => [f.rel, f]))("%s: every logSiaEvent() call site uses only the 4 allowed keys", (_rel, file) => {
    const calls = extractLogSiaEventCalls(file.source);
    for (const callBody of calls) {
      // Extract top-level `key:` identifiers from the object-literal body
      const keyMatches = callBody.match(/(\w+)\s*:/g) || [];
      const keys = keyMatches.map((k) => k.replace(":", "").trim());
      for (const key of keys) {
        expect(ALLOWED_LOG_KEYS.has(key)).toBe(true);
      }
    }
  });

  it.each(readTouched().map((f) => [f.rel, f]))("%s: no logSiaEvent() call site references raw question/transcript/context/auth content", (_rel, file) => {
    const calls = extractLogSiaEventCalls(file.source);
    for (const callBody of calls) {
      for (const forbidden of FORBIDDEN_VALUE_IDENTIFIERS) {
        const pattern = new RegExp(`[:\\s]${forbidden.replace(".", "\\.")}\\b`);
        expect(pattern.test(callBody)).toBe(false);
      }
    }
  });
});

describe("regression: the pre-existing budget read path is untouched and remains a pure read", () => {
  const BUDGET_READ_FILES = ["Controllers/BudgetControllers/fetchBudgets.js", "Controllers/BudgetControllers/getbudgets.js"];

  it("git diff (whitespace/CRLF-normalized) shows ZERO real content changes to either file, when git is available", () => {
    for (const rel of BUDGET_READ_FILES) {
      let diff;
      try {
        diff = execSync(`git diff --ignore-space-at-eol --ignore-all-space -- backend/${rel}`, {
          cwd: path.resolve(BACKEND_ROOT, ".."),
          encoding: "utf8",
        });
      } catch (_err) {
        return; // git unavailable -- not a failure, just unverifiable here.
      }
      expect(diff.trim()).toBe("");
    }
  });

  it("neither file contains a write operation (Model.create/updateOne/findOneAndUpdate/deleteOne/save) -- both are pure reads", () => {
    for (const rel of BUDGET_READ_FILES) {
      const source = fs.readFileSync(path.join(BACKEND_ROOT, rel), "utf8");
      expect(source).not.toMatch(/\.(create|updateOne|updateMany|findOneAndUpdate|findOneAndDelete|deleteOne|deleteMany|insertMany)\s*\(/);
      // `.save()` on a fetched document is the one legitimate mutation verb
      expect(source).not.toMatch(/\.save\s*\(/);
    }
  });
});

describe("regression: no report-refresh/recovery-recursion pattern was reintroduced in the new SIA files", () => {
  const NEW_SIA_FILES = [
    "sia/queryPlan.js",
    "sia/periodResolver.js",
    "sia/financialQueryService.js",
    "sia/factSet.js",
    "sia/semanticRouter.js",
    "sia/prohibitedPhrases.js",
    "sia/semanticPipeline.js",
  ];
  const FORBIDDEN_IMPORT_PATTERNS = [
    /require\(["'].*report\.controller["']\)/,
    /require\(["'].*reportService["']\)/,
    /require\(["'].*syncRecoveryService["']\)/,
    /require\(["'].*recoveryService["']\)/,
  ];

  it.each(NEW_SIA_FILES)("%s never imports report.controller.js/reportService/syncRecoveryService", (rel) => {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, rel), "utf8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      expect(source).not.toMatch(pattern);
    }
  });

  it("financialQueryService.js's own header comment documents (and the source confirms) it never calls into report generation/recovery", () => {
    const source = fs.readFileSync(path.join(BACKEND_ROOT, "sia/financialQueryService.js"), "utf8");
    expect(source).toMatch(/NEVER calls into report\.controller\.js/i);
    // The only occurrence of "report.controller" anywhere in the file is
    // inside that documentation comment, never a real require/import.
    const occurrences = source.match(/report\.controller/gi) || [];
    expect(occurrences.length).toBe(1);
  });
});
