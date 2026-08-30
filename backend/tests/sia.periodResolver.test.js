// Unit tests for backend/sia/periodResolver.js -- timezone-aware period
// resolution. Every test injects a fixed `now` (never the real wall
// clock) so results are fully deterministic regardless of when/where the
// suite runs.
"use strict";

const { resolvePeriod, resolveMostRecentMonthOccurrence } = require("../sia/periodResolver");

describe("backend/sia/periodResolver", () => {
  describe("CURRENT_MONTH / PREVIOUS_MONTH", () => {
    it("resolves the current IST month boundaries for a mid-month instant", () => {
      const now = new Date("2026-08-16T10:00:00.000Z"); // 15:30 IST
      const result = resolvePeriod({ type: "CURRENT_MONTH" }, { now, timeZone: "Asia/Kolkata" });
      expect(result.ok).toBe(true);
      expect(result.start.toISOString()).toBe("2026-07-31T18:30:00.000Z"); // Aug 1 00:00 IST
      expect(result.end.toISOString()).toBe("2026-08-31T18:30:00.000Z"); // Sep 1 00:00 IST
      expect(result.label).toBe("this month");
    });

    it("resolves the previous month across a normal (non-rollover) boundary", () => {
      const now = new Date("2026-08-16T10:00:00.000Z");
      const result = resolvePeriod({ type: "PREVIOUS_MONTH" }, { now, timeZone: "Asia/Kolkata" });
      expect(result.ok).toBe(true);
      expect(result.start.toISOString()).toBe("2026-06-30T18:30:00.000Z"); // Jul 1 00:00 IST
      expect(result.end.toISOString()).toBe("2026-07-31T18:30:00.000Z"); // Aug 1 00:00 IST
    });

    it("rolls PREVIOUS_MONTH over December -> January correctly", () => {
      const now = new Date("2027-01-10T10:00:00.000Z"); // January 2027
      const result = resolvePeriod({ type: "PREVIOUS_MONTH" }, { now, timeZone: "Asia/Kolkata" });
      expect(result.ok).toBe(true);
      // December 2026: Dec 1 00:00 IST -> Jan 1 00:00 IST
      expect(result.start.toISOString()).toBe("2026-11-30T18:30:00.000Z");
      expect(result.end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
    });

    it("rolls CURRENT_MONTH over December -> January correctly", () => {
      const now = new Date("2026-12-25T10:00:00.000Z");
      const result = resolvePeriod({ type: "CURRENT_MONTH" }, { now, timeZone: "Asia/Kolkata" });
      expect(result.start.toISOString()).toBe("2026-11-30T18:30:00.000Z"); // Dec 1 IST
      expect(result.end.toISOString()).toBe("2026-12-31T18:30:00.000Z"); // Jan 1 2027 IST
    });
  });

  describe("leap year handling", () => {
    it("resolves February 2028 (leap year) with 29 days", () => {
      const result = resolvePeriod(
        { type: "EXPLICIT_MONTH", month: 2, year: 2028 },
        { now: new Date("2028-03-01T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(true);
      const spanDays = (result.end.getTime() - result.start.getTime()) / (24 * 60 * 60 * 1000);
      expect(spanDays).toBe(29);
      expect(result.label).toBe("February 2028");
    });

    it("resolves February 2027 (non-leap year) with 28 days", () => {
      const result = resolvePeriod(
        { type: "EXPLICIT_MONTH", month: 2, year: 2027 },
        { now: new Date("2027-03-01T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      const spanDays = (result.end.getTime() - result.start.getTime()) / (24 * 60 * 60 * 1000);
      expect(spanDays).toBe(28);
    });
  });

  describe("EXPLICIT_MONTH", () => {
    it("resolves a fully specified month/year regardless of the current date", () => {
      const result = resolvePeriod(
        { type: "EXPLICIT_MONTH", month: 3, year: 2025 },
        { now: new Date("2026-08-16T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(true);
      expect(result.label).toBe("March 2025");
    });

    it("fails closed when year is missing", () => {
      const result = resolvePeriod(
        { type: "EXPLICIT_MONTH", month: 3 },
        { now: new Date(), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("MISSING_YEAR");
    });
  });

  describe("LAST_N_MONTHS cap", () => {
    it("resolves exactly 12 months when requested (the cap)", () => {
      const now = new Date("2026-08-16T10:00:00.000Z");
      const result = resolvePeriod({ type: "LAST_N_MONTHS", monthsCount: 12 }, { now, timeZone: "Asia/Kolkata" });
      expect(result.ok).toBe(true);
      // Window: Aug 2025 .. end of Jul 2026, i.e. 12 complete months
      // ending just before the current in-progress month.
      expect(result.start.toISOString()).toBe("2025-07-31T18:30:00.000Z"); // Aug 1 2025 IST
      expect(result.end.toISOString()).toBe("2026-07-31T18:30:00.000Z"); // Aug 1 2026 IST
    });

    it("rejects a request for 13 months as exceeding the hard cap", () => {
      const result = resolvePeriod(
        { type: "LAST_N_MONTHS", monthsCount: 13 },
        { now: new Date("2026-08-16T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("MONTHS_COUNT_EXCEEDS_CAP");
    });

    it("rejects zero and negative month counts", () => {
      expect(resolvePeriod({ type: "LAST_N_MONTHS", monthsCount: 0 }, { now: new Date() }).ok).toBe(false);
      expect(resolvePeriod({ type: "LAST_N_MONTHS", monthsCount: -1 }, { now: new Date() }).ok).toBe(false);
    });
  });

  describe("server runs UTC while APP_TIME_ZONE is Asia/Kolkata", () => {
    const originalTz = process.env.TZ;

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("still produces IST-correct month boundaries even when process.env.TZ is UTC", () => {
      process.env.TZ = "UTC";
      // 2026-08-01T00:00:00Z is 05:30 IST on Aug 1st -- if this module
      // mistakenly used the server's local/UTC time zone instead of the
      // configured Asia/Kolkata zone, "current month" would be computed
      // against UTC's Aug 1 00:00:00, not IST's Aug 1 00:00:00 (which is
      // 2026-07-31T18:30:00Z) -- these two instants are 5.5 hours apart,
      // enough to prove the distinction.
      const now = new Date("2026-08-01T02:00:00.000Z"); // 07:30 IST on Aug 1
      const result = resolvePeriod({ type: "CURRENT_MONTH" }, { now, timeZone: "Asia/Kolkata" });
      expect(result.ok).toBe(true);
      expect(result.start.toISOString()).toBe("2026-07-31T18:30:00.000Z");
      expect(result.end.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    });

    it("resolves a near-midnight-IST instant into the correct IST calendar day even though the UTC calendar day differs", () => {
      process.env.TZ = "UTC";
      // 2026-08-15T19:00:00Z is 2026-08-16T00:30:00 IST -- UTC's calendar
      // day is the 15th, IST's is the 16th.
      const now = new Date("2026-08-15T19:00:00.000Z");
      const result = resolvePeriod({ type: "TODAY" }, { now, timeZone: "Asia/Kolkata" });
      expect(result.ok).toBe(true);
      // "today" in IST is Aug 16th: 2026-08-16T00:00 IST == 2026-08-15T18:30Z
      expect(result.start.toISOString()).toBe("2026-08-15T18:30:00.000Z");
      expect(result.end.toISOString()).toBe("2026-08-16T18:30:00.000Z");
    });
  });

  describe("resolveMostRecentMonthOccurrence", () => {
    it("uses the current year when the named month has already occurred this year", () => {
      const now = new Date("2026-08-16T00:00:00.000Z"); // August
      const result = resolveMostRecentMonthOccurrence(3, { now, timeZone: "Asia/Kolkata" }); // March
      expect(result).toEqual({ ok: true, year: 2026, month: 3 });
    });

    it("uses the current year when the named month IS the current month", () => {
      const now = new Date("2026-08-16T00:00:00.000Z");
      const result = resolveMostRecentMonthOccurrence(8, { now, timeZone: "Asia/Kolkata" });
      expect(result).toEqual({ ok: true, year: 2026, month: 8 });
    });

    it("uses the previous year when the named month has not yet occurred this year", () => {
      const now = new Date("2026-08-16T00:00:00.000Z"); // August
      const result = resolveMostRecentMonthOccurrence(12, { now, timeZone: "Asia/Kolkata" }); // December
      expect(result).toEqual({ ok: true, year: 2025, month: 12 });
    });
  });

  describe("CUSTOM_RANGE", () => {
    it("resolves a valid bounded custom range", () => {
      const result = resolvePeriod(
        { type: "CUSTOM_RANGE", startDate: "2026-01-01", endDate: "2026-02-01" },
        { now: new Date("2026-08-01T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a custom range longer than 366 days", () => {
      const result = resolvePeriod(
        { type: "CUSTOM_RANGE", startDate: "2020-01-01", endDate: "2026-01-01" },
        { now: new Date("2026-08-01T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("CUSTOM_RANGE_TOO_LONG");
    });

    it("rejects a non-positive range (end <= start)", () => {
      const result = resolvePeriod(
        { type: "CUSTOM_RANGE", startDate: "2026-02-01", endDate: "2026-01-01" },
        { now: new Date("2026-08-01T00:00:00.000Z"), timeZone: "Asia/Kolkata" }
      );
      expect(result.ok).toBe(false);
    });
  });

  describe("malformed input fails closed", () => {
    it("returns ok:false for a null period", () => {
      expect(resolvePeriod(null, { now: new Date() }).ok).toBe(false);
    });
    it("returns ok:false for an unsupported type", () => {
      expect(resolvePeriod({ type: "NEXT_CENTURY" }, { now: new Date() }).ok).toBe(false);
    });
    it("never throws for a garbage object", () => {
      expect(() => resolvePeriod({ type: {} }, { now: new Date() })).not.toThrow();
    });
  });
});
