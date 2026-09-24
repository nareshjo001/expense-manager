// NOT-003-T04/T07 -- utils/timeZone.js: resolveTimeZone (extracted from
// upcomingProjection.js, REC-003) and the new quiet-hours evaluation.
"use strict";

const { resolveTimeZone, currentTimeInZone, isWithinQuietHours } = require("../utils/timeZone");

describe("resolveTimeZone", () => {
  test("returns a valid caller-supplied zone unchanged", () => {
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  test("trims whitespace around a valid zone", () => {
    expect(resolveTimeZone("  Asia/Tokyo  ")).toBe("Asia/Tokyo");
  });

  test("falls back to the app default for an invalid zone", () => {
    expect(resolveTimeZone("Not/AZone")).toBe(process.env.APP_TIME_ZONE || "Asia/Kolkata");
  });

  test("falls back to the app default for null/undefined/empty/non-string", () => {
    const fallback = process.env.APP_TIME_ZONE || "Asia/Kolkata";
    expect(resolveTimeZone(null)).toBe(fallback);
    expect(resolveTimeZone(undefined)).toBe(fallback);
    expect(resolveTimeZone("")).toBe(fallback);
    expect(resolveTimeZone("   ")).toBe(fallback);
    expect(resolveTimeZone(42)).toBe(fallback);
  });
});

describe("currentTimeInZone", () => {
  test("formats as zero-padded 24h HH:mm, never a bare '24:00' at local midnight", () => {
    // 2026-01-01T00:00:00Z is exactly local midnight in UTC.
    const midnightUtc = new Date("2026-01-01T00:00:00.000Z");
    expect(currentTimeInZone(midnightUtc, "UTC")).toBe("00:00");
  });

  test("reflects a real UTC offset", () => {
    // 05:30 IST == 00:00 UTC.
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(currentTimeInZone(date, "Asia/Kolkata")).toBe("05:30");
  });
});

describe("isWithinQuietHours", () => {
  test("same-day window: inside range", () => {
    const date = new Date("2026-01-01T10:00:00.000Z"); // 10:00 UTC
    expect(isWithinQuietHours(date, { start: "09:00", end: "17:00", timeZone: "UTC" })).toBe(true);
  });

  test("same-day window: outside range", () => {
    const date = new Date("2026-01-01T20:00:00.000Z"); // 20:00 UTC
    expect(isWithinQuietHours(date, { start: "09:00", end: "17:00", timeZone: "UTC" })).toBe(false);
  });

  test("wraps midnight: inside range late at night", () => {
    const date = new Date("2026-01-01T23:00:00.000Z"); // 23:00 UTC
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "UTC" })).toBe(true);
  });

  test("wraps midnight: inside range early morning", () => {
    const date = new Date("2026-01-01T05:00:00.000Z"); // 05:00 UTC
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "UTC" })).toBe(true);
  });

  test("wraps midnight: outside range mid-day", () => {
    const date = new Date("2026-01-01T12:00:00.000Z"); // 12:00 UTC
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "UTC" })).toBe(false);
  });

  test("boundary: exactly at start is inside (inclusive start)", () => {
    const date = new Date("2026-01-01T22:00:00.000Z");
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "UTC" })).toBe(true);
  });

  test("boundary: exactly at end is outside (exclusive end)", () => {
    const date = new Date("2026-01-01T07:00:00.000Z");
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "UTC" })).toBe(false);
  });

  test("start === end is treated as no window (always false), not 24h of quiet", () => {
    const date = new Date("2026-01-01T12:00:00.000Z");
    expect(isWithinQuietHours(date, { start: "09:00", end: "09:00", timeZone: "UTC" })).toBe(false);
  });

  test("evaluates in the given time zone, not UTC", () => {
    // 22:30 IST == 17:00 UTC. Quiet hours 22:00-07:00 IST should be active.
    const date = new Date("2026-01-01T17:00:00.000Z");
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "Asia/Kolkata" })).toBe(true);
    expect(isWithinQuietHours(date, { start: "22:00", end: "07:00", timeZone: "UTC" })).toBe(false);
  });

  test("missing/malformed start or end returns false rather than throwing", () => {
    const date = new Date("2026-01-01T12:00:00.000Z");
    expect(isWithinQuietHours(date, {})).toBe(false);
    expect(isWithinQuietHours(date, { start: "bad", end: "07:00", timeZone: "UTC" })).toBe(false);
    expect(isWithinQuietHours(date, { start: "22:00", end: "25:00", timeZone: "UTC" })).toBe(false);
    expect(isWithinQuietHours(date)).toBe(false);
  });

  test("an invalid time zone falls back to the app default rather than throwing", () => {
    const date = new Date("2026-01-01T12:00:00.000Z");
    expect(() =>
      isWithinQuietHours(date, { start: "09:00", end: "17:00", timeZone: "Not/AZone" })
    ).not.toThrow();
  });
});
