// BUD-001-T03 -- GET/PUT/DELETE /api/category-budgets. Mounts the REAL
// Routes/api.routes.js (so the wiring and the verifyToken guard are what is
// under test) on a bare express app, like mlRouter.merchantRules.test.js,
// instead of booting app.js. The service is mocked: its rules are covered
// by categoryBudget.service.test.js; this file proves HTTP mapping only.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const express = require("express");

const SERVICE_PATH = "../Services/BudgetServices/categoryBudget.service";
const TEST_JWT_SECRET = "category-budget-routes-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";
const BUDGET_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

const serviceMocks = {
  getSummary: jest.fn(),
  upsertCategoryBudget: jest.fn(),
  deleteCategoryBudget: jest.fn(),
};
let app;
let UserModel;
let currentMonth;
let originalJwtSecret;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  jest.resetModules();
  jest.doMock(SERVICE_PATH, () => ({
    getSummary: (...args) => serviceMocks.getSummary(...args),
    upsertCategoryBudget: (...args) => serviceMocks.upsertCategoryBudget(...args),
    deleteCategoryBudget: (...args) => serviceMocks.deleteCategoryBudget(...args),
  }));
  const apiRouter = require("../Routes/api.routes");
  ({ UserModel } = require("../config/Schemas"));
  ({ currentMonth } = require("../Services/BudgetServices/categoryBudgetContract"));
  app = express();
  app.use(express.json());
  app.use("/api", apiRouter);
}, 120000);

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  jest.resetModules();
});

const SUMMARY = { month: "2026-09", rolloverPolicy: "none", categories: [] };

beforeEach(() => {
  serviceMocks.getSummary = jest.fn(async () => SUMMARY);
  serviceMocks.upsertCategoryBudget = jest.fn();
  serviceMocks.deleteCategoryBudget = jest.fn();
  jest.spyOn(UserModel, "findById").mockImplementation(async (id) => ({ _id: id }));
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function auth() {
  return `Bearer ${jwt.sign({ _id: USER_ID, email: "bud001@example.test" }, TEST_JWT_SECRET)}`;
}

describe("authentication", () => {
  test.each([
    ["get", "/api/category-budgets"],
    ["put", "/api/category-budgets"],
    ["delete", `/api/category-budgets/${BUDGET_ID}`],
  ])("%s %s without a token is 401 and never reaches the service", async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(401);
    expect(serviceMocks.getSummary).not.toHaveBeenCalled();
    expect(serviceMocks.upsertCategoryBudget).not.toHaveBeenCalled();
    expect(serviceMocks.deleteCategoryBudget).not.toHaveBeenCalled();
  });

  test("a valid token for a user that no longer exists is 401", async () => {
    UserModel.findById.mockResolvedValue(null);
    const res = await request(app).get("/api/category-budgets").set("Authorization", auth());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, contractVersion: 1 });
    expect(serviceMocks.getSummary).not.toHaveBeenCalled();
  });
});

describe("GET /api/category-budgets", () => {
  test("defaults to the current month and returns the versioned summary", async () => {
    const res = await request(app).get("/api/category-budgets").set("Authorization", auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, contractVersion: 1, data: SUMMARY });
    const [userId, month] = serviceMocks.getSummary.mock.calls[0];
    expect(String(userId)).toBe(USER_ID);
    expect(month).toBe(currentMonth(new Date()));
  });

  test("accepts any valid month, including past ones", async () => {
    const res = await request(app).get("/api/category-budgets?month=2021-03").set("Authorization", auth());
    expect(res.status).toBe(200);
    expect(serviceMocks.getSummary.mock.calls[0][1]).toBe("2021-03");
  });

  test("an invalid month is 400 INVALID_MONTH", async () => {
    const res = await request(app).get("/api/category-budgets?month=Sep%202026").set("Authorization", auth());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, contractVersion: 1, errorCode: "INVALID_MONTH", field: "month" });
    expect(typeof res.body.message).toBe("string");
  });

  test("an unexpected error is a generic 500", async () => {
    serviceMocks.getSummary = jest.fn(async () => { throw new Error("db down: secret detail"); });
    const res = await request(app).get("/api/category-budgets").set("Authorization", auth());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, contractVersion: 1, message: "Internal Server Error" });
  });
});

describe("PUT /api/category-budgets", () => {
  const budget = { id: BUDGET_ID, month: "2026-09", category: "Food", amount: 500, amountMinor: 50000, created: true };

  test("200 with the budget and a fresh summary; a body userId is ignored", async () => {
    serviceMocks.upsertCategoryBudget = jest.fn(async () => ({ ok: true, budget }));

    const res = await request(app)
      .put("/api/category-budgets")
      .set("Authorization", auth())
      .send({ month: "2026-09", category: "Food", amount: 500, userId: OTHER_USER_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, contractVersion: 1, data: { budget, summary: SUMMARY } });
    const [userId, input] = serviceMocks.upsertCategoryBudget.mock.calls[0];
    expect(String(userId)).toBe(USER_ID);
    expect(input).toEqual({ month: "2026-09", category: "Food", amount: 500 });
    expect(String(serviceMocks.getSummary.mock.calls[0][0])).toBe(USER_ID);
    expect(serviceMocks.getSummary.mock.calls[0][1]).toBe("2026-09");
  });

  test.each([
    ["INVALID_AMOUNT", "amount", 400],
    ["AMOUNT_OUT_OF_RANGE", "amount", 400],
    ["INVALID_CATEGORY", "category", 400],
    ["RESERVED_CATEGORY", "category", 400],
    ["MONTH_NOT_WRITABLE", "month", 400],
    ["TOO_MANY_CATEGORY_BUDGETS", "category", 409],
    ["CATEGORY_BUDGET_EXCEEDS_TOTAL", "amount", 409],
  ])("service reason %s maps to its error body", async (reason, field, status) => {
    serviceMocks.upsertCategoryBudget = jest.fn(async () => ({ ok: false, reason, field }));

    const res = await request(app)
      .put("/api/category-budgets")
      .set("Authorization", auth())
      .send({ month: "2026-09", category: "Food", amount: 1 });

    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ success: false, contractVersion: 1, errorCode: reason, field });
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(serviceMocks.getSummary).not.toHaveBeenCalled();
  });

  test("a committed write still returns 200 (summary null) if the follow-up summary fails", async () => {
    serviceMocks.upsertCategoryBudget = jest.fn(async () => ({ ok: true, budget }));
    serviceMocks.getSummary = jest.fn(async () => { throw new Error("aggregate failed"); });

    const res = await request(app)
      .put("/api/category-budgets")
      .set("Authorization", auth())
      .send({ month: "2026-09", category: "Food", amount: 500 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ budget, summary: null });
  });

  test("an unexpected service error is a generic 500", async () => {
    serviceMocks.upsertCategoryBudget = jest.fn(async () => { throw new Error("boom"); });
    const res = await request(app).put("/api/category-budgets").set("Authorization", auth()).send({});
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, contractVersion: 1, message: "Internal Server Error" });
  });
});

describe("DELETE /api/category-budgets/:id", () => {
  test("200 with the deleted id and the month's fresh summary", async () => {
    serviceMocks.deleteCategoryBudget = jest.fn(async () => ({ ok: true, deletedId: BUDGET_ID, month: "2026-10" }));

    const res = await request(app).delete(`/api/category-budgets/${BUDGET_ID}`).set("Authorization", auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, contractVersion: 1, data: { deletedId: BUDGET_ID, summary: SUMMARY } });
    const [userId, id] = serviceMocks.deleteCategoryBudget.mock.calls[0];
    expect(String(userId)).toBe(USER_ID);
    expect(id).toBe(BUDGET_ID);
    expect(serviceMocks.getSummary.mock.calls[0][1]).toBe("2026-10");
  });

  test("not found (or another user's id) is 404", async () => {
    serviceMocks.deleteCategoryBudget = jest.fn(async () => ({ ok: false, reason: "CATEGORY_BUDGET_NOT_FOUND", field: "id" }));
    const res = await request(app).delete(`/api/category-budgets/${BUDGET_ID}`).set("Authorization", auth());
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, contractVersion: 1, errorCode: "CATEGORY_BUDGET_NOT_FOUND" });
  });

  test("a malformed id is 400 INVALID_ID", async () => {
    serviceMocks.deleteCategoryBudget = jest.fn(async () => ({ ok: false, reason: "INVALID_ID", field: "id" }));
    const res = await request(app).delete("/api/category-budgets/nope").set("Authorization", auth());
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ errorCode: "INVALID_ID", field: "id" });
  });

  test("a past month is 400 MONTH_NOT_WRITABLE", async () => {
    serviceMocks.deleteCategoryBudget = jest.fn(async () => ({ ok: false, reason: "MONTH_NOT_WRITABLE", field: "id" }));
    const res = await request(app).delete(`/api/category-budgets/${BUDGET_ID}`).set("Authorization", auth());
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("MONTH_NOT_WRITABLE");
  });
});
