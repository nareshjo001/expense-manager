// REC-003-T02 -- GET /api/recurring/upcoming, bounded by an explicit window.
"use strict";

const request = require("supertest");
const jwt = require("jsonwebtoken");

const USER_ID = "507f1f77bcf86cd799439011";
const OTHER_USER_ID = "507f1f77bcf86cd799439022";

let findCalls;

function loadApp({ definitions = [] } = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = "recurring-upcoming-test-secret";

  findCalls = [];

  jest.doMock("../models/RecurringExpense", () => ({
    RecurringExpenseModel: {
      find: jest.fn((filter) => {
        findCalls.push(filter);
        return { lean: async () => definitions };
      }),
    },
  }));

  jest.doMock("../config/redis", () => ({
    isRedisAvailable: () => true,
    redisClient: { isReady: true },
    connectRedis: jest.fn(),
  }));

  return require("../app");
}

function auth() {
  return `Bearer ${jwt.sign({ _id: USER_ID }, process.env.JWT_SECRET, { expiresIn: "15m" })}`;
}

function definition(overrides = {}) {
  return {
    _id: "rec1",
    expenseId: "exp1",
    expenseName: "Rent",
    expenseCategory: "Housing",
    expenseAmount: 12000,
    expenseAmountMinor: 1200000,
    nextDueDate: new Date(Date.UTC(2099, 0, 1)),
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("authorization", () => {
  test("rejects an unauthenticated request", async () => {
    const app = loadApp();
    const res = await request(app).get("/api/recurring/upcoming");
    expect(res.status).toBe(401);
  });

  test("queries scoped to the authenticated user only", async () => {
    // A projection endpoint that leaked another user's recurring definitions
    // would disclose their rent, salary and subscriptions.
    const app = loadApp({ definitions: [definition()] });
    await request(app).get("/api/recurring/upcoming").set("Authorization", auth());

    expect(findCalls).toHaveLength(1);
    expect(String(findCalls[0].userId)).toBe(USER_ID);
    expect(String(findCalls[0].userId)).not.toBe(OTHER_USER_ID);
  });
});

describe("window bounds", () => {
  test("defaults to a bounded window when none is given", async () => {
    // Not unbounded-by-default: an omitted window must not mean "project
    // forever", the same rule EXP-003 established for list endpoints.
    const app = loadApp({ definitions: [definition()] });
    const res = await request(app).get("/api/recurring/upcoming").set("Authorization", auth());

    expect(res.status).toBe(200);
    expect(res.body.window.from).toBeDefined();
    expect(res.body.window.to).toBeDefined();

    const days = (new Date(res.body.window.to) - new Date(res.body.window.from)) / 86400000;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(366);
  });

  test("refuses a window larger than the maximum instead of truncating it", async () => {
    // Silently returning three months for a two-year request would let a
    // client label a total "next 2 years" when it is nothing of the kind.
    const app = loadApp({ definitions: [definition()] });
    const res = await request(app)
      .get("/api/recurring/upcoming?from=2026-01-01&to=2029-01-01")
      .set("Authorization", auth());

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("WINDOW_TOO_LARGE");
  });

  test("rejects a malformed date", async () => {
    const app = loadApp();
    const res = await request(app)
      .get("/api/recurring/upcoming?from=notadate&to=2026-12-01")
      .set("Authorization", auth());

    expect(res.status).toBe(400);
  });

  test("rejects an inverted window", async () => {
    const app = loadApp();
    const res = await request(app)
      .get("/api/recurring/upcoming?from=2026-12-01&to=2026-01-01")
      .set("Authorization", auth());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/after/i);
  });

  test("accepts an explicit in-range window", async () => {
    const app = loadApp({
      definitions: [definition({ nextDueDate: new Date(Date.UTC(2027, 0, 1)) })],
    });
    const res = await request(app)
      .get("/api/recurring/upcoming?from=2026-12-01&to=2027-03-01")
      .set("Authorization", auth());

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});

describe("response shape", () => {
  test("carries occurrences, a summary and the window it used", async () => {
    const app = loadApp({
      definitions: [definition({ nextDueDate: new Date(Date.UTC(2027, 0, 1)) })],
    });
    const res = await request(app)
      .get("/api/recurring/upcoming?from=2026-12-01&to=2027-03-01")
      .set("Authorization", auth());

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.summary).toEqual(
      expect.objectContaining({
        count: expect.any(Number),
        overdueCount: expect.any(Number),
        definitionCount: 1,
        totalMinor: expect.any(Number),
        timeZone: expect.any(String),
      })
    );
    expect(res.body.generatedAt).toBeDefined();
  });

  test("derives minor units when the stored shadow field is absent", async () => {
    // MONEY_MINOR_DUAL_WRITE_ENABLED defaults false, so most definitions have
    // no stored expenseAmountMinor. Serving null would leave the client with
    // no exact value and force it to re-round a float that may have drifted.
    const app = loadApp({
      definitions: [
        definition({ expenseAmount: 40.3, expenseAmountMinor: undefined, nextDueDate: new Date(Date.UTC(2027, 0, 1)) }),
      ],
    });
    const res = await request(app)
      .get("/api/recurring/upcoming?from=2026-12-01&to=2027-02-01")
      .set("Authorization", auth());

    // The window 2026-12-01 .. 2027-02-01 contains TWO occurrences (1 Jan
    // and 1 Feb), so the total is the sum of both -- which also proves the
    // summary aggregates derived values rather than only the stored ones.
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((o) => o.expenseAmountMinor)).toEqual([4030, 4030]);
    expect(res.body.summary.totalMinor).toBe(8060);
  });

  test("an empty schedule returns 200 with an empty list, not 404", async () => {
    // "You have no recurring expenses" is a valid answer to this question.
    const app = loadApp({ definitions: [] });
    const res = await request(app).get("/api/recurring/upcoming").set("Authorization", auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.summary.count).toBe(0);
  });

  test("reports overdue occurrences so the client can warn that the schedule is behind", async () => {
    const app = loadApp({
      definitions: [definition({ nextDueDate: new Date(Date.UTC(2020, 0, 1)) })],
    });
    const res = await request(app).get("/api/recurring/upcoming").set("Authorization", auth());

    expect(res.status).toBe(200);
    expect(res.body.summary.overdueCount).toBeGreaterThan(0);
  });
});
