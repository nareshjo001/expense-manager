// BUD-001-T06 -- Services/BudgetServices/categoryBudgetAlert.service.js
// (invariant I14). Models, spend aggregation and push are mocked; the
// contract (alertLevelFor/utilizationPercent/formatMonth) is the real one.
"use strict";

const SERVICE_PATH = "../Services/BudgetServices/categoryBudgetAlert.service";
const CATEGORY_BUDGET_MODEL_PATH = "../models/CategoryBudget";
const NOTIFICATION_MODEL_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const SPEND_PATH = "../Services/BudgetServices/categoryBudgetSpend";

const USER_ID = "64b000000000000000000001";
const NOW = new Date(2026, 8, 26, 12, 0, 0); // September 2026, server-local
const SEPT = new Date(2026, 8, 3);
const SEPT_LATER = new Date(2026, 8, 20);
const AUG = new Date(2026, 7, 15);
const OCT = new Date(2026, 9, 2);

function allocation(overrides = {}) {
  return {
    _id: "alloc-food",
    category: "Food",
    amountMinor: 500000, // Rs 5,000.00
    lastAlertLevel: 0,
    ...overrides,
  };
}

function loadService({
  allocationsByMonth = {},
  spentByMonth = {},
  claimModifiedCount = 1,
  findImpl,
  aggregateImpl,
  createImpl,
  pushImpl,
  readyState = 1,
} = {}) {
  jest.resetModules();

  // The service only reads mongoose.connection.readyState; every model it
  // touches is mocked below, so a stub keeps this suite fast and offline.
  jest.doMock("mongoose", () => ({ connection: { readyState } }));

  const findMock = jest.fn(
    findImpl ||
      ((filter) => ({
        select: jest.fn(() => ({
          lean: jest.fn(async () => allocationsByMonth[filter.month] || []),
        })),
      }))
  );
  const updateOneMock = jest.fn(async () => ({ matchedCount: claimModifiedCount, modifiedCount: claimModifiedCount }));
  jest.doMock(CATEGORY_BUDGET_MODEL_PATH, () => ({
    CategoryBudgetModel: { find: findMock, updateOne: updateOneMock },
    MONTH_PATTERN: /^\d{4}-(0[1-9]|1[0-2])$/,
  }));

  let notificationSeq = 0;
  const notificationCreateMock = jest.fn(
    createImpl ||
      (async (doc) => {
        notificationSeq += 1;
        return { _id: `notif-${notificationSeq}`, ...doc };
      })
  );
  const notificationUpdateOneMock = jest.fn(async () => ({}));
  jest.doMock(NOTIFICATION_MODEL_PATH, () => ({
    create: notificationCreateMock,
    updateOne: notificationUpdateOneMock,
  }));

  const sendPushMock = jest.fn(pushImpl || (async () => ({ success: true })));
  jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush: sendPushMock }));

  const aggregateMock = jest.fn(
    aggregateImpl ||
      (async (_userId, month) => ({
        byCategory: new Map(Object.entries(spentByMonth[month] || {})),
        totalSpentMinor: 0,
      }))
  );
  jest.doMock(SPEND_PATH, () => ({ aggregateSpentByCategory: aggregateMock, toObjectId: (id) => id }));

  const logLines = [];
  jest.spyOn(console, "log").mockImplementation((line) => logLines.push(String(line)));
  jest.spyOn(console, "error").mockImplementation((line) => logLines.push(String(line)));

  const service = require(SERVICE_PATH);
  return {
    service,
    findMock,
    updateOneMock,
    notificationCreateMock,
    notificationUpdateOneMock,
    sendPushMock,
    aggregateMock,
    logLines,
  };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("hot path", () => {
  test("no allocations for the month -> exactly one find, no aggregation, no notification", async () => {
    const h = loadService();
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    expect(h.findMock).toHaveBeenCalledTimes(1);
    expect(h.findMock).toHaveBeenCalledWith({ userId: USER_ID, month: "2026-09" });
    expect(h.aggregateMock).not.toHaveBeenCalled();
    expect(h.updateOneMock).not.toHaveBeenCalled();
    expect(h.notificationCreateMock).not.toHaveBeenCalled();
    expect(result).toEqual({ evaluatedMonths: [], notified: [], errors: [], skipped: null });
  });

  test("several dates in the current month are evaluated once; past-month dates are ignored (I14: current month only)", async () => {
    const h = loadService();
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT, SEPT_LATER, AUG], now: NOW });

    expect(h.findMock).toHaveBeenCalledTimes(1);
    expect(h.findMock).toHaveBeenCalledWith({ userId: USER_ID, month: "2026-09" });
  });

  test("a past month (e.g. a historical import) is skipped without any query or notification", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-08": [allocation()] },
      spentByMonth: { "2026-08": { Food: 600000 } },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [AUG], now: NOW });
    expect(h.findMock).not.toHaveBeenCalled();
    expect(h.notificationCreateMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe("no_eligible_months");
  });

  test("no dates (e.g. a total-budget mutation) -> no query at all", async () => {
    const h = loadService();
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [], now: NOW });
    expect(h.findMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe("no_eligible_months");
  });

  test("future month is skipped without any query", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-10": [allocation()] },
      spentByMonth: { "2026-10": { Food: 600000 } },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [OCT], now: NOW });

    expect(h.findMock).not.toHaveBeenCalled();
    expect(h.notificationCreateMock).not.toHaveBeenCalled();
    expect(result.notified).toEqual([]);
  });

  test("database not connected -> skipped without buffering a query", async () => {
    const h = loadService({ readyState: 0, allocationsByMonth: { "2026-09": [allocation()] } });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.findMock).not.toHaveBeenCalled();
    expect(result.skipped).toBe("db_unavailable");
  });
});

describe("threshold crossings", () => {
  test("crossing into Critical notifies once at level 1, via an atomic conditional claim", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Food: 460000 } }, // 92%
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    expect(h.aggregateMock).toHaveBeenCalledWith(USER_ID, "2026-09");
    expect(h.updateOneMock).toHaveBeenCalledTimes(1);
    expect(h.updateOneMock).toHaveBeenCalledWith(
      { _id: "alloc-food", userId: USER_ID, amountMinor: 500000, lastAlertLevel: { $not: { $gte: 1 } } },
      { $set: { lastAlertLevel: 1 } }
    );
    expect(h.notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(h.notificationCreateMock).toHaveBeenCalledWith({
      userId: USER_ID,
      title: "Budget alert: Food",
      message: "You've used 92% of your Food budget for September.",
      type: "category-budget-alert",
    });
    expect(h.sendPushMock).toHaveBeenCalledWith(
      USER_ID,
      "Budget alert: Food",
      "You've used 92% of your Food budget for September.",
      { type: "category-budget-alert" }
    );
    expect(h.notificationUpdateOneMock).toHaveBeenCalledWith({ _id: "notif-1" }, { pushStatus: "sent" });
    expect(result).toEqual({
      evaluatedMonths: ["2026-09"],
      notified: [{ month: "2026-09", category: "Food", level: 1 }],
      errors: [],
      skipped: null,
    });
  });

  test("crossing straight from none to Overspent notifies once, at level 2 only", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Food: 650000 } }, // 130%
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    expect(h.updateOneMock).toHaveBeenCalledTimes(1);
    expect(h.updateOneMock.mock.calls[0][1]).toEqual({ $set: { lastAlertLevel: 2 } });
    expect(h.notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(h.notificationCreateMock.mock.calls[0][0].message).toBe(
      "You've gone over your Food budget for September."
    );
    expect(result.notified).toEqual([{ month: "2026-09", category: "Food", level: 2 }]);
  });

  test("Critical -> Overspent escalation notifies at level 2", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation({ lastAlertLevel: 1 })] },
      spentByMonth: { "2026-09": { Food: 500100 } },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(result.notified).toEqual([{ month: "2026-09", category: "Food", level: 2 }]);
  });

  test("an already-notified level does not re-notify (and no claim is attempted)", async () => {
    const h = loadService({
      allocationsByMonth: {
        "2026-09": [
          allocation({ lastAlertLevel: 1 }), // still Critical at 95%
          allocation({ _id: "alloc-travel", category: "Travel", lastAlertLevel: 2 }), // still over
        ],
      },
      spentByMonth: { "2026-09": { Food: 475000, Travel: 900000 } },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    expect(h.updateOneMock).not.toHaveBeenCalled();
    expect(h.notificationCreateMock).not.toHaveBeenCalled();
    expect(result.notified).toEqual([]);
  });

  test("spend falling back below a threshold never lowers lastAlertLevel", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation({ lastAlertLevel: 2 })] },
      spentByMonth: { "2026-09": { Food: 1000 } },
    });
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.updateOneMock).not.toHaveBeenCalled();
  });

  test("exactly 90% is still Warning (Critical is > 90%) -> no alert", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Food: 450000 } },
    });
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.updateOneMock).not.toHaveBeenCalled();
  });

  test("spend in a category without an allocation is ignored", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Shopping: 99999999 } },
    });
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.updateOneMock).not.toHaveBeenCalled();
  });

  test("concurrent claim lost (modifiedCount 0) -> no notification", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Food: 460000 } },
      claimModifiedCount: 0,
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    expect(h.updateOneMock).toHaveBeenCalledTimes(1);
    expect(h.notificationCreateMock).not.toHaveBeenCalled();
    expect(h.sendPushMock).not.toHaveBeenCalled();
    expect(result.notified).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("1 paisa over a large allocation alerts at the Overspent level, not Critical (exact ratio)", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation({ amountMinor: 10000000 })] },
      spentByMonth: { "2026-09": { Food: 10000001 } },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(result.notified).toEqual([{ month: "2026-09", category: "Food", level: 2 }]);
  });
});

describe("push status bookkeeping (mirrors cron/recurringJob.js)", () => {
  function crossing(pushImpl) {
    return loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Food: 460000 } },
      pushImpl,
    });
  }

  test("suppressed push (type disabled / quiet hours) -> pushStatus suppressed, never queued for retry", async () => {
    const h = crossing(async () => ({ success: false, suppressed: true, reason: "quiet_hours" }));
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.notificationUpdateOneMock).toHaveBeenCalledWith({ _id: "notif-1" }, { pushStatus: "suppressed" });
  });

  test("failed push -> pushStatus failed with a scheduled retry", async () => {
    const h = crossing(async () => ({ success: false }));
    const before = Date.now();
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    const [filter, update] = h.notificationUpdateOneMock.mock.calls[0];
    expect(filter).toEqual({ _id: "notif-1" });
    expect(update.pushStatus).toBe("failed");
    expect(update.retryCount).toBe(1);
    expect(update.nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60 * 1000);
  });

  test("a thrown sendPush is recorded as a failed push, not an error", async () => {
    const h = crossing(async () => {
      throw new Error("policy lookup failed");
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.notificationUpdateOneMock.mock.calls[0][1].pushStatus).toBe("failed");
    expect(result.notified).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe("data minimization", () => {
  test("notification text carries no amounts; logs carry no amounts or category names", async () => {
    const h = loadService({
      allocationsByMonth: {
        "2026-09": [
          allocation({ category: "Groceries", amountMinor: 1234567 }), // Rs 12,345.67
          allocation({ _id: "alloc-rent", category: "Rent", amountMinor: 2500000 }),
        ],
      },
      spentByMonth: { "2026-09": { Groceries: 1150000, Rent: 3000000 } },
    });
    await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });

    expect(h.notificationCreateMock).toHaveBeenCalledTimes(2);
    for (const [doc] of h.notificationCreateMock.mock.calls) {
      const text = `${doc.title} ${doc.message}`;
      expect(text).not.toMatch(/₹|Rs\.?\s|INR/);
      // The only number allowed is the rounded integer percent.
      const numbers = text.match(/\d+(?:[.,]\d+)*/g) || [];
      for (const n of numbers) expect(n).toMatch(/^\d{1,3}$/);
    }

    const logs = h.logLines.join("\n");
    expect(logs).toContain("BUD-001");
    expect(logs).not.toMatch(/Groceries|Rent/);
    expect(logs).not.toMatch(/1234567|1150000|2500000|3000000|12345|11500/);
  });
});

describe("never throws", () => {
  test("allocation lookup failure is caught and returned", async () => {
    const h = loadService({
      findImpl: () => {
        throw new Error("boom");
      },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(result.errors).toEqual([{ month: "2026-09", stage: "evaluate", reason: "Error" }]);
    expect(result.notified).toEqual([]);
  });

  test("aggregation rejection is caught and returned, never thrown", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      aggregateImpl: async () => {
        throw new Error("aggregate failed");
      },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(result.errors).toEqual([{ month: "2026-09", stage: "evaluate", reason: "Error" }]);
    expect(result.notified).toEqual([]);
  });

  test("Notification.create failure after a won claim is caught and returned", async () => {
    const h = loadService({
      allocationsByMonth: { "2026-09": [allocation()] },
      spentByMonth: { "2026-09": { Food: 460000 } },
      createImpl: async () => {
        throw new TypeError("insert failed");
      },
    });
    const result = await h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [SEPT], now: NOW });
    expect(h.sendPushMock).not.toHaveBeenCalled();
    expect(result.errors).toEqual([{ month: "2026-09", stage: "notify", reason: "TypeError" }]);
  });

  test("garbage input resolves with an empty summary", async () => {
    const h = loadService();
    await expect(h.service.evaluateCategoryBudgetAlerts()).resolves.toMatchObject({ notified: [], errors: [] });
    await expect(
      h.service.evaluateCategoryBudgetAlerts({ userId: USER_ID, dates: [null, "not-a-date", undefined], now: NOW })
    ).resolves.toMatchObject({ notified: [], errors: [] });
    expect(h.findMock).not.toHaveBeenCalled();
  });
});
