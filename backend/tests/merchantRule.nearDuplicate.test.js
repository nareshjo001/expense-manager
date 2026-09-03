// CAT-001-T07 -- dedicated near-duplicate/ambiguous merchant-text coverage.
// merchantRule.service.test.js already covers exact-text casing/whitespace
// collapsing, and mlRouter.merchantRules.test.js already covers rule-vs-
// model precedence for a clean hit/miss. What neither covers: merchant
// names that are textually SIMILAR but not identical after normalization
// (punctuation, a shared prefix, an appended qualifier) must never be
// treated as "the same merchant" -- normalizeMerchantKey is deliberately
// exact-match-only (no fuzzy matching), so a rule saved for one near-
// duplicate must stay fully isolated from lookups against another.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const express = require("express");

const MODEL_PATH = "../models/MerchantCategoryRule";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

// A stateful, in-memory stand-in for the real Mongoose model, mirroring the
// shape used by merchantRule.service.test.js's own fake model.
function makeFakeModel() {
  const store = new Map();
  let idCounter = 0;
  const chainable = (result) => ({ lean: async () => result });
  return {
    findOne: jest.fn(({ userId, merchantKey }) => chainable(store.get(`${userId}:${merchantKey}`) || null)),
    find: jest.fn(({ userId }) => {
      const results = [...store.values()].filter((d) => String(d.userId) === String(userId));
      return { sort: () => chainable(results) };
    }),
    findOneAndUpdate: jest.fn(({ userId, merchantKey }, update) => {
      const key = `${userId}:${merchantKey}`;
      const existing = store.get(key);
      const doc = existing
        ? { ...existing, category: update.$set.category }
        : { _id: `rule-${++idCounter}`, userId, merchantKey, category: update.$set.category };
      store.set(key, doc);
      return chainable(doc);
    }),
  };
}

function loadService(fakeModel) {
  jest.resetModules();
  jest.doMock(MODEL_PATH, () => fakeModel);
  return require("../Services/CategorizationServices/merchantRule.service");
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("near-duplicate merchant text -- service-level isolation", () => {
  test.each([
    ["Wal-Mart", "Walmart"],
    ["McDonald's", "McDonalds"],
    ["7-Eleven", "7 Eleven"],
    ["Starbucks Coffee", "Starbucks Coffee Co"],
    ["Amazon", "Amazon.com"],
  ])("a rule saved for %j never matches a lookup for the textually-similar %j", async (ruled, lookedUp) => {
    const model = makeFakeModel();
    const { upsertRule, findRuleForMerchant } = loadService(model);

    await upsertRule(USER_ID, ruled, "Shopping");

    await expect(findRuleForMerchant(USER_ID, lookedUp)).resolves.toBeNull();
  });

  test("near-duplicate merchants sharing a prefix are stored and resolved as fully independent rules", async () => {
    const model = makeFakeModel();
    const { upsertRule, findRuleForMerchant, listRules } = loadService(model);

    await upsertRule(USER_ID, "Starbucks Coffee", "Food");
    await upsertRule(USER_ID, "Starbucks Coffee Downtown", "Entertainment");

    const first = await findRuleForMerchant(USER_ID, "Starbucks Coffee");
    const second = await findRuleForMerchant(USER_ID, "Starbucks Coffee Downtown");

    expect(first.category).toBe("Food");
    expect(second.category).toBe("Entertainment");
    expect(await listRules(USER_ID)).toHaveLength(2);
  });

  test("only whitespace/casing drift of the SAME text -- never punctuation or wording differences -- collapses to one rule", async () => {
    const model = makeFakeModel();
    const { upsertRule, findRuleForMerchant } = loadService(model);

    await upsertRule(USER_ID, "7   Eleven", "Groceries");

    await expect(findRuleForMerchant(USER_ID, "7 ELEVEN")).resolves.toMatchObject({ category: "Groceries" });
    await expect(findRuleForMerchant(USER_ID, "7-Eleven")).resolves.toBeNull();
  });
});

describe("near-duplicate merchant text -- route-level precedence (CAT-001)", () => {
  const RULE_SERVICE_PATH = "../Services/CategorizationServices/merchantRule.service";
  const ML_CLIENT_PATH = "../utils/mlServiceClient";
  const TEST_JWT_SECRET = "merchant-rule-near-duplicate-test-secret";

  function signToken() {
    return jwt.sign({ email: "cat001-near-dup@example.test", _id: USER_ID }, TEST_JWT_SECRET);
  }

  function loadApp(ruleServiceImpl, axiosPostImpl) {
    jest.resetModules();
    jest.doMock(RULE_SERVICE_PATH, () => ({
      findRuleForMerchant: jest.fn(async () => null),
      listRules: jest.fn(async () => []),
      upsertRule: jest.fn(async () => ({})),
      deleteRule: jest.fn(async () => true),
      MerchantRuleValidationError: class extends Error {},
      ...ruleServiceImpl,
    }));
    jest.doMock("axios", () => ({ post: axiosPostImpl }));
    jest.doMock(ML_CLIENT_PATH, () => ({
      buildMlServiceUrl: (path) => `http://ml-service.test${path}`,
      mlOperationsHeaders: () => ({}),
    }));
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.ML_ROUTE = "http://ml-service.test";
    const mlRouter = require("../Routes/ml.router");
    const app = express();
    app.use(express.json());
    app.use("/ml", mlRouter);
    return app;
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("a rule for one near-duplicate merchant never short-circuits prediction for a textually-different one", async () => {
    // Mirrors the real service: only an EXACT normalized-key match returns a rule.
    const findRuleForMerchant = jest.fn(async (userId, rawMerchantName) =>
      rawMerchantName.trim().toLowerCase() === "starbucks coffee" ? { category: "Food" } : null
    );
    const axiosPost = jest.fn(async () => ({
      data: { success: true, predictedCategory: "Entertainment", confidence: 0.6 },
    }));
    const app = loadApp({ findRuleForMerchant }, axiosPost);

    const res = await request(app)
      .post("/ml/predict-category")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ expenseName: "Starbucks Coffee Downtown" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, predictedCategory: "Entertainment", confidence: 0.6, source: "model" });
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });
});
