// EXP-003 -- backend/utils/pagination.js: cursor-pagination primitives.
"use strict";

const {
  parseLimit,
  encodeCursor,
  decodeCursor,
  buildCursorFilter,
  paginateResults,
  PaginationValidationError,
  MAX_LIMIT,
} = require("../utils/pagination");

describe("parseLimit", () => {
  test("returns undefined when limit is absent -- caller falls back to unbounded behavior", () => {
    expect(parseLimit(undefined)).toBeUndefined();
    expect(parseLimit(null)).toBeUndefined();
    expect(parseLimit("")).toBeUndefined();
  });

  test("accepts a valid integer string within bounds", () => {
    expect(parseLimit("50")).toBe(50);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit(String(MAX_LIMIT))).toBe(MAX_LIMIT);
  });

  test("rejects zero, negative, non-integer and over-max values", () => {
    expect(() => parseLimit("0")).toThrow(PaginationValidationError);
    expect(() => parseLimit("-5")).toThrow(PaginationValidationError);
    expect(() => parseLimit("3.5")).toThrow(PaginationValidationError);
    expect(() => parseLimit(String(MAX_LIMIT + 1))).toThrow(PaginationValidationError);
  });

  test("rejects non-numeric garbage rather than coercing to NaN silently", () => {
    expect(() => parseLimit("not-a-number")).toThrow(PaginationValidationError);
    expect(() => parseLimit("50; DROP TABLE")).toThrow(PaginationValidationError);
  });
});

describe("encodeCursor / decodeCursor round trip", () => {
  test("decodes exactly what was encoded", () => {
    const id = "64f1a2b3c4d5e6f7a8b9c0aa";
    const date = new Date("2026-01-15T10:00:00.000Z");
    const cursor = encodeCursor({ date, id });
    const decoded = decodeCursor(cursor);

    expect(decoded.id).toBe(id);
    expect(decoded.date.toISOString()).toBe(date.toISOString());
  });

  test("returns undefined for an absent cursor", () => {
    expect(decodeCursor(undefined)).toBeUndefined();
    expect(decodeCursor(null)).toBeUndefined();
    expect(decodeCursor("")).toBeUndefined();
  });

  test("rejects a malformed/tampered cursor rather than silently producing a bad filter", () => {
    expect(() => decodeCursor("not-valid-base64url-json")).toThrow(PaginationValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ d: "not-a-date", i: "x" })).toString("base64url"))).toThrow(PaginationValidationError);
    expect(() => decodeCursor(Buffer.from(JSON.stringify({ d: "2026-01-01", i: "too-short" })).toString("base64url"))).toThrow(PaginationValidationError);
  });
});

describe("buildCursorFilter", () => {
  test("returns an empty filter when no cursor is given (first page)", () => {
    expect(buildCursorFilter(undefined, "expenseDate")).toEqual({});
  });

  test("builds the standard two-column keyset predicate for a given cursor", () => {
    const cursor = { date: new Date("2026-01-15T00:00:00.000Z"), id: "64f1a2b3c4d5e6f7a8b9c0aa" };
    const filter = buildCursorFilter(cursor, "expenseDate");

    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0]).toEqual({ expenseDate: { $lt: cursor.date } });
    expect(filter.$or[1]).toEqual({ expenseDate: cursor.date, _id: { $lt: cursor.id } });
  });
});

describe("paginateResults", () => {
  function doc(dateStr, id) {
    return { expenseDate: new Date(dateStr), _id: id };
  }

  const ID_A = "64f1a2b3c4d5e6f7a8b9c0aa";
  const ID_B = "64f1a2b3c4d5e6f7a8b9c0bb";
  const ID_C = "64f1a2b3c4d5e6f7a8b9c0cc";

  test("reports hasMore=false and no nextCursor when fewer documents than the page size", () => {
    const documents = [doc("2026-01-03", ID_A), doc("2026-01-02", ID_B)];
    const { page, hasMore, nextCursor } = paginateResults(documents, 5, "expenseDate");

    expect(page).toHaveLength(2);
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });

  test("trims the probe document and derives nextCursor from the true last page item", () => {
    const documents = [doc("2026-01-05", ID_A), doc("2026-01-04", ID_B), doc("2026-01-03", ID_C)];
    const { page, hasMore, nextCursor } = paginateResults(documents, 2, "expenseDate");

    expect(page).toHaveLength(2);
    expect(page.map((d) => d._id)).toEqual([ID_A, ID_B]);
    expect(hasMore).toBe(true);

    const decoded = decodeCursor(nextCursor);
    expect(decoded.id).toBe(ID_B);
    expect(decoded.date.toISOString()).toBe(new Date("2026-01-04").toISOString());
  });

  test("handles an exactly-full final page with no probe document", () => {
    const documents = [doc("2026-01-02", ID_A), doc("2026-01-01", ID_B)];
    const { hasMore, nextCursor } = paginateResults(documents, 2, "expenseDate");

    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });

  test("handles an empty result set", () => {
    const { page, hasMore, nextCursor } = paginateResults([], 10, "expenseDate");
    expect(page).toEqual([]);
    expect(hasMore).toBe(false);
    expect(nextCursor).toBeNull();
  });
});
