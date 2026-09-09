// Regression tests for the future-dated-expense divide-by-zero in
// spendingAnalyzer.calculateTimeStatistics.
//
// The failure these lock down was a real HTTP 500 on GET /report, not a
// cosmetic rounding issue: periodStart is the earliest expense date, and
// an expense dated in the future made the tracking window zero, so
// `totalSpent / trackingDays` was Infinity, round2() rejected it, and the
// TypeError escaped generateReport() and took the whole report with it.
//
// Every case below pins asOfDate explicitly. An earlier version of this
// suite that leaned on `new Date()` would have passed or failed depending
// on the day of the month it happened to run -- which is exactly the bug
// that hid here for so long.
"use strict";

const spendingAnalyzer = require("../analytics/analyzers/spendingAnalyzer");

const expense = (isoDate, amount) => ({
  expenseDate: new Date(isoDate),
  expenseAmount: amount,
  expenseCategory: "Test",
});

describe("spendingAnalyzer.calculateTimeStatistics -- window clamping", () => {
  it("does not throw when the only expense is dated one day in the future (window would be 0)", () => {
    const asOfDate = new Date(2026, 8, 9); // 9 Sep 2026
    const expenses = [expense("2026-09-10T00:00:00", 4321)];

    expect(() =>
      spendingAnalyzer.calculateTimeStatistics(expenses, 4321, { asOfDate })
    ).not.toThrow();
  });

  it("reports a one-day window and a finite daily average for a future-dated expense", () => {
    const asOfDate = new Date(2026, 8, 9);
    const stats = spendingAnalyzer.calculateTimeStatistics(
      [expense("2026-09-10T00:00:00", 4321)],
      4321,
      { asOfDate }
    );

    expect(stats.trackingDays).toBe(1);
    expect(Number.isFinite(stats.dailyAverage)).toBe(true);
    expect(stats.dailyAverage).toBe(4321);
    expect(Number.isFinite(stats.weeklyAverage)).toBe(true);
  });

  it("never returns a negative daily average when expenses are dated well ahead of today", () => {
    // Raw window here is 1 - 10 + 1 = -8 days; unclamped this produced a
    // negative "daily average", which is meaningless as a spend rate.
    const asOfDate = new Date(2026, 8, 1);
    const stats = spendingAnalyzer.calculateTimeStatistics(
      [expense("2026-09-10T00:00:00", 800)],
      800,
      { asOfDate }
    );

    expect(stats.trackingDays).toBeGreaterThanOrEqual(1);
    expect(stats.dailyAverage).toBeGreaterThan(0);
    expect(stats.weeklyAverage).toBeGreaterThan(0);
  });

  it("still computes a normal multi-day window for ordinary past-dated expenses", () => {
    // Guards against "fixing" the bug by clamping everything to 1.
    const asOfDate = new Date(2026, 8, 20);
    const stats = spendingAnalyzer.calculateTimeStatistics(
      [expense("2026-09-11T00:00:00", 1000), expense("2026-09-15T00:00:00", 500)],
      1500,
      { asOfDate }
    );

    expect(stats.trackingDays).toBe(10); // 11th..20th inclusive
    expect(stats.dailyAverage).toBe(150);
  });

  it("keeps the whole report generatable via analyze() with a future-dated expense", () => {
    const asOfDate = new Date(2026, 8, 9);
    const report = spendingAnalyzer.analyze(
      [expense("2026-09-10T00:00:00", 4321)],
      { asOfDate }
    );

    expect(report.hasData).toBe(true);
    expect(Number.isFinite(report.dailyAverage)).toBe(true);
    expect(report.totalSpent).toBe(4321);
  });
});

describe("reportFixtures.currentMonthDate", () => {
  const { currentMonthDate } = require("./fixtures/reportFixtures");

  it("never produces a date later than today", () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const seeded = currentMonthDate();
    seeded.setHours(0, 0, 0, 0);

    expect(seeded.getTime()).toBeLessThanOrEqual(today.getTime());
  });

  it("stays inside the current calendar month", () => {
    const now = new Date();
    const seeded = currentMonthDate();

    expect(seeded.getMonth()).toBe(now.getMonth());
    expect(seeded.getFullYear()).toBe(now.getFullYear());
  });
});
