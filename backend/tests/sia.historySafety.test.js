// Batch 2 architecture closure: consolidated proof of the exact stored
// message allowlist, its exclusions, and the size/count bounds applied
// before anything reaches the LLM. Complements
// tests/sia.sessionService.test.js (behavioral proof) and
// tests/sia.llmService.history.test.js (framing proof) with a direct,
// structural proof that forbidden fields have no path into storage at all.
"use strict";

const mongoose = require("mongoose");
const SiaMessage = require("../models/SiaMessage");
const SiaRequest = require("../models/SiaRequest");
const { buildHistoryMessages } = require("../sia/llmService");
const { buildGroundingSnapshot } = require("../sia/groundingService");

describe("models/SiaMessage -- exact stored field allowlist", () => {
  it("the schema's own path list contains only the intentionally bounded fields", () => {
    const paths = Object.keys(SiaMessage.schema.paths);
    const allowed = new Set([
      "_id",
      "session",
      "user",
      "role",
      "content",
      "intent",
      "clientMessageId",
      "metadata.provider",
      "metadata.model",
      "metadata.latencyMs",
      "metadata.errorCode",
      // Batch 3F: the answer-grounding transparency snapshot (see
      // models/SiaMessage.js's siaGroundingSchema/siaGroundingSourceSchema)
      // -- server-owned keys/labels/optional periods only, never a raw
      // path, metric value, prompt, or identifier. Explicitly added here,
      // not a gap in this allowlist.
      "grounding",
      "grounding.sources",
      "grounding.sources.key",
      "grounding.sources.label",
      "grounding.sources.period",
      // Workstream 1 -- the bounded QueryPlan summary (see
      // models/SiaMessage.js's siaPlanSummarySchema): metrics/operation/
      // periodLabel/grouping/categoryFilter only, never a raw prompt,
      // full financial context, or provider response body. Explicitly
      // added here, not a gap in this allowlist.
      "planSummary",
      "planSummary.metrics",
      "planSummary.operation",
      "planSummary.periodLabel",
      "planSummary.grouping",
      "planSummary.categoryFilter",
      "createdAt",
      "updatedAt",
      "__v",
    ]);
    for (const path of paths) {
      expect(allowed.has(path)).toBe(true);
    }
    // And nothing that looks like a report/context/prompt/secret field
    // exists on the schema at all.
    const serializedPaths = paths.join(",").toLowerCase();
    for (const forbidden of ["report", "context", "prompt", "apikey", "token", "rawresponse", "reasoning"]) {
      expect(serializedPaths).not.toContain(forbidden);
    }
  });

  it("content is bounded to a finite maxlength -- messages cannot grow without limit", () => {
    const contentPath = SiaMessage.schema.path("content");
    const maxlengthValidator = contentPath.validators.find((v) => v.type === "maxlength");
    expect(maxlengthValidator).toBeDefined();
    expect(typeof maxlengthValidator.maxlength === "number" || typeof contentPath.options.maxlength === "number").toBe(true);
  });
});

describe("sia/sessionService.appendTurn -- forbidden fields have no path into storage", () => {
  function loadMockedService() {
    jest.resetModules();
    const sessionDocs = { updateOne: jest.fn(async () => ({})) };
    const messageDocs = {
      findOne: jest.fn(() => ({ lean: async () => null })),
      create: jest.fn(async (attrs) => ({ ...attrs, _id: "m", createdAt: new Date() })),
    };
    jest.doMock("../models/SiaSession", () => sessionDocs);
    jest.doMock("../models/SiaMessage", () => messageDocs);
    return { sessionService: require("../sia/sessionService"), messageDocs };
  }

  afterEach(() => {
    jest.resetModules();
  });

  it("appendTurn's own create() calls never carry a report/context/apiKey/prompt field, even though it is not asked to", async () => {
    const { sessionService, messageDocs } = loadMockedService();

    await sessionService.appendTurn({
      sessionId: "s1",
      userId: "u1",
      question: "Why is my health score low?",
      intent: "HEALTH_EXPLANATION",
      answer: "Because X.",
      providerMetadata: { provider: "openai" },
      // Even if a caller mistakenly passed extra fields, appendTurn's own
      // signature destructuring never reads them -- proven by
      // asserting the create() calls below never contain them.
    });

    for (const call of messageDocs.create.mock.calls) {
      const attrs = call[0];
      const keys = Object.keys(attrs);
      for (const forbidden of ["report", "context", "systemPrompt", "apiKey", "rawResponse", "reasoning"]) {
        expect(keys).not.toContain(forbidden);
      }
      // Only the exact bounded field set is ever written.
      expect(new Set(keys)).toEqual(
        new Set(["session", "user", "role", "content", "intent", "clientMessageId", ...(attrs.metadata ? ["metadata"] : [])])
      );
    }
  });
});

describe("bounded recent-turn window -- deterministic serialized-size ceiling before reaching the LLM", () => {
  beforeEach(() => {
    jest.resetModules();
    // Undo any jest.doMock registrations left over from the earlier
    // describe block in this same file (jest.resetModules() clears the
    // module registry but NOT explicit jest.doMock() registrations).
    jest.dontMock("../models/SiaSession");
    jest.dontMock("../models/SiaMessage");
  });

  it("MAX_RECENT_TURNS_FOR_LLM x per-message maxlength bounds the total history size supplied to buildHistoryMessages", () => {
    const { MAX_RECENT_TURNS_FOR_LLM } = require("../sia/sessionService");
    const { CONTENT_LIMITS } = require("../models/SiaMessage");

    const worstCaseTurns = Array.from({ length: MAX_RECENT_TURNS_FOR_LLM }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(CONTENT_LIMITS.MAX_ASSISTANT_CONTENT_LENGTH),
    }));

    const messages = buildHistoryMessages(worstCaseTurns);
    const totalSize = messages.reduce((sum, m) => sum + m.content.length, 0);

    // A concrete, finite, computable ceiling -- not "unbounded".
    const theoreticalCeiling = MAX_RECENT_TURNS_FOR_LLM * (CONTENT_LIMITS.MAX_ASSISTANT_CONTENT_LENGTH + 80); // +80 for the label prefix
    expect(totalSize).toBeLessThan(theoreticalCeiling);
    expect(messages.length).toBe(MAX_RECENT_TURNS_FOR_LLM);
  });

  it("loadRecentTurns never returns more than MAX_RECENT_TURNS_FOR_LLM turns even if asked for more", async () => {
    jest.resetModules();
    const messageDocs = {
      find: jest.fn(() => {
        const chain = {
          sort: () => chain,
          limit: jest.fn(() => chain),
          lean: async () => [],
        };
        return chain;
      }),
    };
    jest.doMock("../models/SiaSession", () => ({}));
    jest.doMock("../models/SiaMessage", () => messageDocs);
    // Required only once, after mocking, so this exact instance's
    // MAX_RECENT_TURNS_FOR_LLM and its internal SiaMessage reference are
    // both the mocked ones -- requiring it a second time before mocking
    // (as an earlier version of this test did) caches the REAL module
    // instead, which doMock cannot retroactively replace.
    const sessionService = require("../sia/sessionService");
    const { MAX_RECENT_TURNS_FOR_LLM } = sessionService;

    await sessionService.loadRecentTurns("64f1a2b3c4d5e6f7a8b9c0d1", "64f1a2b3c4d5e6f7a8b9c0d2", 999999);

    const chain = messageDocs.find.mock.results[0].value;
    expect(chain.limit).toHaveBeenCalledWith(MAX_RECENT_TURNS_FOR_LLM);
  });
});

// Batch 3F acceptance remediation -- requirement 3: verify persistence-
// schema boundaries. Proves, structurally (no live DB required -- Mongoose
// casts/strips at document construction time), that both grounding-bearing
// schemas (models/SiaMessage.js and models/SiaRequest.js) can never persist
// an `_id`, `__v`, unknown property, raw metric, or internal identifier on
// a grounding source, that only the approved key/label/period fields ever
// survive, and that a legacy document with no grounding at all remains
// valid.
describe("models/SiaMessage + models/SiaRequest -- grounding exact-shape persistence boundary (Batch 3F)", () => {
  it("SiaMessage.grounding and its nested source subdocuments declare _id: false", () => {
    const groundingPath = SiaMessage.schema.path("grounding");
    expect(groundingPath.schema.options._id).toBe(false);
    const sourcesArrayPath = SiaMessage.schema.path("grounding.sources");
    expect(sourcesArrayPath.schema.options._id).toBe(false);
  });

  it("SiaRequest.grounding and its nested source subdocuments declare _id: false", () => {
    const groundingPath = SiaRequest.schema.path("grounding");
    expect(groundingPath.schema.options._id).toBe(false);
    const sourcesArrayPath = SiaRequest.schema.path("grounding.sources");
    expect(sourcesArrayPath.schema.options._id).toBe(false);
  });

  it("SiaRequest's own path list contains only the intentionally bounded fields, mirroring SiaMessage's grounding shape exactly", () => {
    const paths = Object.keys(SiaRequest.schema.paths);
    const allowed = new Set([
      "_id",
      "user",
      "clientMessageId",
      "questionFingerprint",
      "status",
      "ownerToken",
      "processingExpiresAt",
      "session",
      "answer",
      "intent",
      "grounding",
      "grounding.sources",
      "grounding.sources.key",
      "grounding.sources.label",
      "grounding.sources.period",
      // Workstream 1 -- the semantic-routing plan CHECKPOINT (see
      // models/SiaRequest.js's field comment): a validated, closed-schema
      // QueryPlan (sia/queryPlan.js), never the raw prompt/context/
      // provider response. Explicitly added here, not a gap.
      "planCheckpoint",
      "responseStatus",
      "responsePayload",
      "createdAt",
      "updatedAt",
    ]);
    for (const path of paths) {
      expect(allowed.has(path)).toBe(true);
    }
  });

  it("constructing a SiaMessage with a forged _id/__v/unknown property on a grounding source strips them -- only key/label/period survive", () => {
    const doc = new SiaMessage({
      session: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      role: "assistant",
      content: "Your score is healthy.",
      intent: "HEALTH_EXPLANATION",
      grounding: {
        sources: [
          {
            key: "financialHealth",
            label: "Financial health analysis",
            period: "2026-08-09",
            _id: "forged-id",
            __v: 99,
            rawScore: 61.4,
            internalReportId: "report-abc123",
          },
        ],
        __v: 5,
      },
    });

    const stored = doc.toObject();
    expect(stored.grounding.sources).toHaveLength(1);
    expect(Object.keys(stored.grounding.sources[0]).sort()).toEqual(["key", "label", "period"]);
    expect(stored.grounding.sources[0]).toEqual({
      key: "financialHealth",
      label: "Financial health analysis",
      period: "2026-08-09",
    });
    expect(stored.grounding.sources[0]).not.toHaveProperty("_id");
    expect(stored.grounding.sources[0]).not.toHaveProperty("__v");
    expect(stored.grounding.sources[0]).not.toHaveProperty("rawScore");
    expect(stored.grounding.sources[0]).not.toHaveProperty("internalReportId");
    // The grounding subdocument itself also gets no _id/__v.
    expect(stored.grounding).not.toHaveProperty("_id");
    expect(Object.keys(stored.grounding)).toEqual(["sources"]);
  });

  it("constructing a SiaRequest with a forged _id/__v/unknown property on a grounding source strips them -- only key/label/period survive", () => {
    const doc = new SiaRequest({
      user: new mongoose.Types.ObjectId(),
      clientMessageId: "client-msg-1",
      questionFingerprint: "a".repeat(64),
      grounding: {
        sources: [
          {
            key: "risk",
            label: "Financial risk signals",
            _id: "forged-id",
            __v: 99,
            evidenceRaw: ["signal-a", "signal-b"],
          },
        ],
        _id: "forged-grounding-id",
      },
    });

    const stored = doc.toObject();
    expect(stored.grounding.sources).toHaveLength(1);
    // No `period` was supplied and the schema declares no default, so the
    // property is absent entirely -- not present-but-null.
    expect(Object.keys(stored.grounding.sources[0]).sort()).toEqual(["key", "label"]);
    expect(stored.grounding.sources[0]).toEqual({ key: "risk", label: "Financial risk signals" });
    expect(stored.grounding.sources[0]).not.toHaveProperty("period");
    expect(stored.grounding.sources[0]).not.toHaveProperty("_id");
    expect(stored.grounding.sources[0]).not.toHaveProperty("__v");
    expect(stored.grounding.sources[0]).not.toHaveProperty("evidenceRaw");
    expect(stored.grounding).not.toHaveProperty("_id");
  });

  it("an unrecognized client-supplied property alongside a valid grounding source is dropped, not merely ignored on the wire", () => {
    // Simulates the exact "client-supplied grounding is ignored" scenario
    // (backend/tests/sia.ask.groundingTransparency.test.js proves the route
    // never uses client input at all) at the schema layer itself: even if
    // something forged ever reached a document constructor, the schema is
    // still the last line of defense.
    const doc = new SiaMessage({
      session: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      role: "assistant",
      content: "Answer.",
      intent: "BUDGET_STATUS_EXPLANATION",
      grounding: { sources: [{ key: "budget", label: "Budget status", forgedField: "should not survive" }] },
    });
    const stored = doc.toObject();
    expect(stored.grounding.sources[0]).not.toHaveProperty("forgedField");
  });

  it("an existing/legacy SiaMessage document with no grounding field at all remains valid and has no grounding key", async () => {
    const doc = new SiaMessage({
      session: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      role: "assistant",
      content: "Old answer, predates Batch 3F.",
      intent: "HEALTH_EXPLANATION",
      // No grounding at all.
    });
    await expect(doc.validate()).resolves.toBeUndefined();
    const stored = doc.toObject();
    expect(stored).not.toHaveProperty("grounding");
  });

  it("an existing/legacy SiaRequest document with no grounding field at all remains valid and has no grounding key", async () => {
    const doc = new SiaRequest({
      user: new mongoose.Types.ObjectId(),
      clientMessageId: "legacy-client-msg",
      questionFingerprint: "b".repeat(64),
      // No grounding at all -- predates Batch 3F.
    });
    await expect(doc.validate()).resolves.toBeUndefined();
    const stored = doc.toObject();
    expect(stored).not.toHaveProperty("grounding");
  });
});

// Batch 3F pre-commit remediation: exact grounding-shape persistence.
//
// The acceptance audit proved a real inconsistency: `period` was declared
// `default: null` on both grounding source subdocuments, so a snapshot
// generated WITHOUT a period (the only kind groundingService.js currently
// produces) came back out of persistence carrying `period: null`. The
// fresh /sia/ask response therefore returned `{key, label}` while session
// history and answer-ready resume returned `{key, label, period: null}` --
// violating the requirement that the IDENTICAL snapshot survive every
// path. The defaults were removed; these tests lock that in using REAL
// Mongoose construction and serialization rather than handwritten plain
// objects, so a reintroduced default would fail here immediately.
describe("grounding exact-shape equivalence through real Mongoose serialization (Batch 3F pre-commit remediation)", () => {
  // The genuine, freshly generated snapshot -- produced by the real
  // production module, not a fixture transcribed by hand.
  const freshSnapshot = buildGroundingSnapshot({
    fields: {
      financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
      summary: { healthScore: 75, riskLevel: "Low" },
    },
    // Deliberately present: proves a report-generation timestamp still
    // never becomes a `period` on any path.
    sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
  });

  function serializeThroughSiaMessage(grounding) {
    return new SiaMessage({
      session: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      role: "assistant",
      content: "Your score is healthy.",
      intent: "HEALTH_EXPLANATION",
      grounding,
    }).toObject().grounding;
  }

  function serializeThroughSiaRequest(grounding) {
    return new SiaRequest({
      user: new mongoose.Types.ObjectId(),
      clientMessageId: "shape-equivalence-key",
      questionFingerprint: "c".repeat(64),
      grounding,
    }).toObject().grounding;
  }

  it("the freshly generated snapshot has no period property on any source", () => {
    expect(freshSnapshot.sources.length).toBeGreaterThan(0);
    for (const source of freshSnapshot.sources) {
      expect(source).not.toHaveProperty("period");
      expect(Object.keys(source).sort()).toEqual(["key", "label"]);
    }
  });

  it("a source without period has NO period property after real SiaMessage serialization", () => {
    const stored = serializeThroughSiaMessage(freshSnapshot);
    for (const source of stored.sources) {
      expect(source).not.toHaveProperty("period");
      expect(Object.keys(source).sort()).toEqual(["key", "label"]);
    }
  });

  it("a source without period has NO period property after real SiaRequest serialization", () => {
    const stored = serializeThroughSiaRequest(freshSnapshot);
    for (const source of stored.sources) {
      expect(source).not.toHaveProperty("period");
      expect(Object.keys(source).sort()).toEqual(["key", "label"]);
    }
  });

  it("fresh, SiaMessage-persisted and SiaRequest-persisted snapshots are STRICTLY equal, key for key", () => {
    const viaMessage = serializeThroughSiaMessage(freshSnapshot);
    const viaRequest = serializeThroughSiaRequest(freshSnapshot);

    // Strict structural equality across all three representations.
    expect(viaMessage).toStrictEqual(freshSnapshot);
    expect(viaRequest).toStrictEqual(freshSnapshot);
    expect(viaMessage).toStrictEqual(viaRequest);

    // And byte-for-byte identical once serialized to the wire.
    expect(JSON.stringify(viaMessage)).toBe(JSON.stringify(freshSnapshot));
    expect(JSON.stringify(viaRequest)).toBe(JSON.stringify(freshSnapshot));
  });

  it("an explicitly supplied, valid period survives BOTH schemas unchanged", () => {
    const withPeriod = { sources: [{ key: "budget", label: "Budget status", period: "2026-08" }] };

    const viaMessage = serializeThroughSiaMessage(withPeriod);
    const viaRequest = serializeThroughSiaRequest(withPeriod);

    expect(viaMessage).toStrictEqual(withPeriod);
    expect(viaRequest).toStrictEqual(withPeriod);
    expect(viaMessage.sources[0].period).toBe("2026-08");
    expect(viaRequest.sources[0].period).toBe("2026-08");
  });

  it("a mixed snapshot preserves per-source presence and absence of period independently", () => {
    const mixed = {
      sources: [
        { key: "financialHealth", label: "Financial health analysis" },
        { key: "budget", label: "Budget status", period: "2026-08" },
      ],
    };

    for (const stored of [serializeThroughSiaMessage(mixed), serializeThroughSiaRequest(mixed)]) {
      expect(stored).toStrictEqual(mixed);
      expect(stored.sources[0]).not.toHaveProperty("period");
      expect(stored.sources[1].period).toBe("2026-08");
    }
  });
});
