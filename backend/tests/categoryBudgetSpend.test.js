// BUD-001-T07 -- categoryBudgetSpend.aggregateSpentByCategory (invariant I9):
// legacy-casing merge, Uncategorized bucket, exact minor-unit conversion,
// and the exact aggregation pipeline sent to MongoDB. No database: the
// ExpenseModel is mocked and fed raw $group output.

jest.mock("../config/Schemas", () => ({
  ExpenseModel: { aggregate: jest.fn() },
}));

const mongoose = require("mongoose");
const { ExpenseModel } = require("../config/Schemas");
const { aggregateSpentByCategory, toObjectId } = require("../Services/BudgetServices/categoryBudgetSpend");

const USER_ID = "64b7f0c2a1b2c3d4e5f60718";

const withGroups = (groups) => ExpenseModel.aggregate.mockResolvedValueOnce(groups);
const lastPipeline = () => ExpenseModel.aggregate.mock.calls[ExpenseModel.aggregate.mock.calls.length - 1][0];

beforeEach(() => {
  ExpenseModel.aggregate.mockReset();
});

describe("aggregateSpentByCategory -- pipeline", () => {
  it("matches on an ObjectId userId and the month's [start, next-month-start) range, grouping by raw category", async () => {
    withGroups([]);
    await aggregateSpentByCategory(USER_ID, "2026-09");

    expect(ExpenseModel.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = lastPipeline();
    expect(pipeline).toHaveLength(2);

    const { $match } = pipeline[0];
    expect(Object.keys($match).sort()).toEqual(["expenseDate", "userId"]);
    expect($match.userId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect($match.userId.toHexString()).toBe(USER_ID);
    expect($match.expenseDate).toEqual({ $gte: new Date(2026, 8, 1), $lt: new Date(2026, 9, 1) });

    expect(pipeline[1]).toEqual({
      $group: { _id: "$expenseCategory", total: { $sum: "$expenseAmount" } },
    });
  });

  it("rolls December's range over into January of the next year", async () => {
    withGroups([]);
    await aggregateSpentByCategory(USER_ID, "2026-12");
    expect(lastPipeline()[0].$match.expenseDate).toEqual({ $gte: new Date(2026, 11, 1), $lt: new Date(2027, 0, 1) });
  });

  it("uses February's real length in a leap year", async () => {
    withGroups([]);
    await aggregateSpentByCategory(USER_ID, "2028-02");
    expect(lastPipeline()[0].$match.expenseDate).toEqual({ $gte: new Date(2028, 1, 1), $lt: new Date(2028, 2, 1) });
  });

  it("passes an ObjectId userId through unchanged", async () => {
    const oid = new mongoose.Types.ObjectId(USER_ID);
    withGroups([]);
    await aggregateSpentByCategory(oid, "2026-09");
    expect(lastPipeline()[0].$match.userId).toBe(oid);
  });

  it("toObjectId rejects a malformed id rather than matching nothing silently", () => {
    expect(() => toObjectId("not-an-id")).toThrow();
  });
});

describe("aggregateSpentByCategory -- category normalization (I2, I9)", () => {
  it("merges legacy casing/whitespace variants into one normalized bucket", async () => {
    withGroups([
      { _id: "food", total: 100 },
      { _id: "Food", total: 250.5 },
      { _id: " FOOD ", total: 10 },
      { _id: "fOoD", total: 0.25 },
    ]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect([...byCategory.entries()]).toEqual([["Food", 36075]]);
    expect(totalSpentMinor).toBe(36075);
  });

  it("merges aliases into their canonical category (medical/healthcare -> Health)", async () => {
    withGroups([
      { _id: "Health", total: 100 },
      { _id: "medical", total: 50 },
      { _id: "Healthcare", total: 25 },
    ]);
    const { byCategory } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect([...byCategory.entries()]).toEqual([["Health", 17500]]);
  });

  it("puts null, missing, empty, whitespace and non-string categories in Uncategorized", async () => {
    withGroups([
      { _id: null, total: 1 },
      { _id: undefined, total: 2 },
      { _id: "", total: 3 },
      { _id: "   ", total: 4 },
      { _id: 42, total: 5 },
      { _id: ["Food"], total: 6 },
      { _id: { name: "Food" }, total: 7 },
      { _id: "uncategorized", total: 8 },
    ]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect([...byCategory.entries()]).toEqual([["Uncategorized", 3600]]);
    expect(totalSpentMinor).toBe(3600);
  });

  it("keeps unknown categories as their own title-cased buckets", async () => {
    withGroups([
      { _id: "pet supplies", total: 10 },
      { _id: "Pet Supplies", total: 5 },
      { _id: "Food", total: 1 },
    ]);
    const { byCategory } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect(Object.fromEntries(byCategory)).toEqual({ "Pet Supplies": 1500, Food: 100 });
  });
});

describe("aggregateSpentByCategory -- money (ADR-0003)", () => {
  it("converts float group totals to exact integer paise (0.1 + 0.2)", async () => {
    withGroups([{ _id: "Food", total: 0.1 + 0.2 }]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect(byCategory.get("Food")).toBe(30);
    expect(totalSpentMinor).toBe(30);
  });

  it("stays exact across merged buckets and repeated float sums", async () => {
    withGroups([
      { _id: "food", total: 19.99 * 3 }, // 59.970000000000006
      { _id: "Food", total: 1.1 + 2.2 }, // 3.3000000000000003
      { _id: "Rent", total: 0.07 * 100 }, // 7.000000000000001
    ]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect(byCategory.get("Food")).toBe(6327);
    expect(byCategory.get("Rent")).toBe(700);
    expect(totalSpentMinor).toBe(7027);
    for (const value of byCategory.values()) expect(Number.isInteger(value)).toBe(true);
  });

  it("coerces numeric-string totals", async () => {
    withGroups([{ _id: "Food", total: "12.50" }]);
    const { byCategory } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect(byCategory.get("Food")).toBe(1250);
  });

  it("skips non-finite totals without poisoning the other buckets or the total", async () => {
    withGroups([
      { _id: "Food", total: NaN },
      { _id: "Rent", total: Infinity },
      { _id: "Travel", total: -Infinity },
      { _id: "Bills", total: "abc" },
      { _id: "Gifts", total: undefined },
      { _id: "Health", total: 10 },
    ]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect([...byCategory.entries()]).toEqual([["Health", 1000]]);
    expect(totalSpentMinor).toBe(1000);
  });

  it("totalSpentMinor always equals the sum of the buckets", async () => {
    withGroups([
      { _id: "food", total: 10.1 },
      { _id: "Food", total: 20.2 },
      { _id: null, total: 0.3 },
      { _id: "Rent", total: 1000 },
    ]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    const sum = [...byCategory.values()].reduce((a, b) => a + b, 0);
    expect(totalSpentMinor).toBe(sum);
    expect(totalSpentMinor).toBe(103060);
  });

  it("returns an empty Map and 0 for a month with no expenses", async () => {
    withGroups([]);
    const { byCategory, totalSpentMinor } = await aggregateSpentByCategory(USER_ID, "2026-09");
    expect(byCategory).toBeInstanceOf(Map);
    expect(byCategory.size).toBe(0);
    expect(totalSpentMinor).toBe(0);
  });
});
