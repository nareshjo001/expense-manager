"use strict";

const { parseCsvDate, toIsoIfValid } = require("../utils/dateParsing");

describe("toIsoIfValid", () => {
  test("returns ISO string for valid date", () => {
    expect(toIsoIfValid(2026, 9, 25)).toBe("2026-10-25"); // monthIndex 9 = October
  });

  test("rejects rollover dates like February 31st", () => {
    expect(toIsoIfValid(2026, 1, 31)).toBeNull(); // February has no 31st
  });

  test("rejects invalid month indices or non-finite values", () => {
    expect(toIsoIfValid(2026, 12, 1)).toBeNull();
    expect(toIsoIfValid(NaN, 0, 1)).toBeNull();
  });
});

describe("parseCsvDate", () => {
  test("parses DD-MM-YYYY format (Indian / standard international)", () => {
    expect(parseCsvDate("25-10-2026")).toBe("2026-10-25");
    expect(parseCsvDate("05-10-2026")).toBe("2026-10-05");
    expect(parseCsvDate("1-2-2026")).toBe("2026-02-01");
  });

  test("parses DD/MM/YYYY and DD.MM.YYYY formats", () => {
    expect(parseCsvDate("25/10/2026")).toBe("2026-10-25");
    expect(parseCsvDate("25.10.2026")).toBe("2026-10-25");
  });

  test("parses ISO YYYY-MM-DD and YYYY/MM/DD formats", () => {
    expect(parseCsvDate("2026-10-25")).toBe("2026-10-25");
    expect(parseCsvDate("2026/10/25")).toBe("2026-10-25");
    expect(parseCsvDate("2026-10-25T14:30:00Z")).toBe("2026-10-25");
  });

  test("parses 2-digit years", () => {
    expect(parseCsvDate("25-10-26")).toBe("2026-10-25");
  });

  test("parses unambiguous MM-DD-YYYY when day is > 12", () => {
    expect(parseCsvDate("10-25-2026")).toBe("2026-10-25");
    expect(parseCsvDate("10/25/2026")).toBe("2026-10-25");
  });

  test("parses textual dates", () => {
    expect(parseCsvDate("25 Oct 2026")).toBe("2026-10-25");
    expect(parseCsvDate("October 25, 2026")).toBe("2026-10-25");
  });

  test("returns null for invalid/unparseable dates", () => {
    expect(parseCsvDate("")).toBeNull();
    expect(parseCsvDate(null)).toBeNull();
    expect(parseCsvDate(undefined)).toBeNull();
    expect(parseCsvDate("not-a-date")).toBeNull();
    expect(parseCsvDate("31-02-2026")).toBeNull();
    expect(parseCsvDate("32-01-2026")).toBeNull();
  });
});
