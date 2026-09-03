// CAT-001 -- backend/Routes/ml.router.js: merchant-rule precedence and CRUD.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const express = require("express");

const AUTH_PATH = "../Middlewares/Auth";
const RULE_SERVICE_PATH = "../Services/CategorizationServices/merchantRule.service";
const ML_CLIENT_PATH = "../utils/mlServiceClient";

const TEST_JWT_SECRET = "ml-router-merchant-rules-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
let originalJwtSecret;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function signToken() {
  return jwt.sign({ email: "cat001-test@example.test", _id: USER_ID }, TEST_JWT_SECRET);
}

// Loads a fresh express app mounting the real ml.router.js, with the
// merchant-rule service and the ML-service HTTP client mocked -- verifies
// the ROUTE's wiring/precedence logic, not axios or Mongoose themselves.
function loadApp({ ruleServiceImpl = {}, axiosPostImpl } = {}) {
  jest.resetModules();

  jest.doMock(RULE_SERVICE_PATH, () => ({
    findRuleForMerchant: jest.fn(async () => null),
    listRules: jest.fn(async () => []),
    upsertRule: jest.fn(async () => ({})),
    deleteRule: jest.fn(async () => true),
    MerchantRuleValidationError: class MerchantRuleValidationError extends Error {
      constructor(message, code) {
        super(message);
        this.statusCode = 400;
        this.code = code || "INVALID_MERCHANT_RULE";
      }
    },
    ...ruleServiceImpl,
  }));

  if (axiosPostImpl) {
    jest.doMock("axios", () => ({ post: axiosPostImpl }));
  }

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

describe("POST /ml/predict-category -- merchant rule precedence (CAT-001)", () => {
  test("a matching rule short-circuits the ML call entirely", async () => {
    const findRuleForMerchant = jest.fn(async () => ({ category: "Groceries" }));
    const axiosPost = jest.fn();
    const app = loadApp({ ruleServiceImpl: { findRuleForMerchant }, axiosPostImpl: axiosPost });

    const res = await request(app)
      .post("/ml/predict-category")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ expenseName: "Whole Foods" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, predictedCategory: "Groceries", confidence: 1, source: "rule" });
    expect(axiosPost).not.toHaveBeenCalled();
  });

  test("falls back to the ML call and tags the response source when no rule matches", async () => {
    const axiosPost = jest.fn(async () => ({ data: { success: true, predictedCategory: "Food", confidence: 0.8 } }));
    const app = loadApp({ axiosPostImpl: axiosPost });

    const res = await request(app)
      .post("/ml/predict-category")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ expenseName: "Some New Merchant" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, predictedCategory: "Food", confidence: 0.8, source: "model" });
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });

  test("still requires authentication", async () => {
    const app = loadApp({});
    const res = await request(app).post("/ml/predict-category").send({ expenseName: "x" });
    expect(res.status).toBe(401);
  });
});

describe("Merchant rule CRUD routes (CAT-001)", () => {
  test("GET /ml/merchant-rules lists the caller's rules", async () => {
    const listRules = jest.fn(async (userId) => (userId === USER_ID ? [{ merchantKey: "starbucks", category: "Food" }] : []));
    const app = loadApp({ ruleServiceImpl: { listRules } });

    const res = await request(app).get("/ml/merchant-rules").set("Authorization", `Bearer ${signToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(listRules).toHaveBeenCalledWith(USER_ID);
  });

  test("POST /ml/merchant-rules saves a rule and returns it", async () => {
    const upsertRule = jest.fn(async () => ({ merchantKey: "starbucks", category: "Food" }));
    const app = loadApp({ ruleServiceImpl: { upsertRule } });

    const res = await request(app)
      .post("/ml/merchant-rules")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ merchantName: "Starbucks", category: "Food" });

    expect(res.status).toBe(200);
    expect(res.body.data.category).toBe("Food");
    expect(upsertRule).toHaveBeenCalledWith(USER_ID, "Starbucks", "Food");
  });

  test("POST /ml/merchant-rules surfaces a validation error as 400 with a stable error code", async () => {
    class FakeValidationError extends Error {
      constructor(message, code) {
        super(message);
        this.statusCode = 400;
        this.code = code;
      }
    }
    const upsertRule = jest.fn(async () => {
      throw new FakeValidationError("category is required and must be valid.", "INVALID_CATEGORY");
    });
    const app = loadApp({ ruleServiceImpl: { upsertRule, MerchantRuleValidationError: FakeValidationError } });

    const res = await request(app)
      .post("/ml/merchant-rules")
      .set("Authorization", `Bearer ${signToken()}`)
      .send({ merchantName: "Starbucks", category: "" });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_CATEGORY");
  });

  test("DELETE /ml/merchant-rules/:ruleId deletes an owned rule", async () => {
    const deleteRule = jest.fn(async () => true);
    const app = loadApp({ ruleServiceImpl: { deleteRule } });

    const res = await request(app)
      .delete("/ml/merchant-rules/64f1a2b3c4d5e6f7a8b9c0cc")
      .set("Authorization", `Bearer ${signToken()}`);

    expect(res.status).toBe(200);
    expect(deleteRule).toHaveBeenCalledWith(USER_ID, "64f1a2b3c4d5e6f7a8b9c0cc");
  });

  test("DELETE /ml/merchant-rules/:ruleId returns 404 when the rule doesn't exist or isn't owned by the caller", async () => {
    const deleteRule = jest.fn(async () => false);
    const app = loadApp({ ruleServiceImpl: { deleteRule } });

    const res = await request(app)
      .delete("/ml/merchant-rules/64f1a2b3c4d5e6f7a8b9c0cc")
      .set("Authorization", `Bearer ${signToken()}`);

    expect(res.status).toBe(404);
  });

  test("DELETE /ml/merchant-rules/:ruleId rejects a malformed ruleId before querying", async () => {
    const deleteRule = jest.fn(async () => true);
    const app = loadApp({ ruleServiceImpl: { deleteRule } });

    const res = await request(app)
      .delete("/ml/merchant-rules/not-an-object-id")
      .set("Authorization", `Bearer ${signToken()}`);

    expect(res.status).toBe(400);
    expect(deleteRule).not.toHaveBeenCalled();
  });

  test("all three routes require authentication", async () => {
    const app = loadApp({});

    expect((await request(app).get("/ml/merchant-rules")).status).toBe(401);
    expect((await request(app).post("/ml/merchant-rules").send({})).status).toBe(401);
    expect((await request(app).delete("/ml/merchant-rules/64f1a2b3c4d5e6f7a8b9c0cc")).status).toBe(401);
  });
});
