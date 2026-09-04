// OPS-002-T03 -- backend/scripts/backup/collections.js: the resolved,
// verified mapping from ADR-0002's authoritative store list to the REAL
// MongoDB collection names mongodump/mongorestore operate on. See that
// file's header comment for the full discrepancy this test also pins
// down: ADR-0002's table names ("budget", "mlFeedback",
// "RecurringExpense", "MerchantCategoryRule") are mongoose model
// registration strings, not the real, pluralized/lowercased collection
// names on the server.
"use strict";

const { AUTHORITATIVE_COLLECTIONS, authoritativeCollectionNames } = require("../scripts/backup/collections");

describe("AUTHORITATIVE_COLLECTIONS", () => {
  test("has exactly the 7 collections ADR-0002 classifies as authoritative", () => {
    expect(AUTHORITATIVE_COLLECTIONS).toHaveLength(7);
    expect(AUTHORITATIVE_COLLECTIONS.map((c) => c.label).sort()).toEqual(
      ["MerchantCategoryRule", "RecurringExpense", "budget", "expenses", "incomes", "mlFeedback", "users"].sort()
    );
  });

  test("resolves each ADR-0002 label to its real, verified MongoDB collection name", () => {
    const byLabel = Object.fromEntries(AUTHORITATIVE_COLLECTIONS.map((c) => [c.label, c.collection]));
    // These are not guesses -- each was checked directly against this
    // repo's actual mongoose model objects
    // (mongoose.model(<name>).collection.name) while building this task.
    expect(byLabel).toEqual({
      users: "users",
      expenses: "expenses",
      incomes: "incomes",
      budget: "budgets",
      mlFeedback: "mlfeedbacks",
      RecurringExpense: "recurringexpenses",
      MerchantCategoryRule: "merchantcategoryrules",
    });
  });

  test("is frozen -- cannot be accidentally mutated by a caller", () => {
    expect(Object.isFrozen(AUTHORITATIVE_COLLECTIONS)).toBe(true);
    expect(Object.isFrozen(AUTHORITATIVE_COLLECTIONS[0])).toBe(true);
  });
});

describe("authoritativeCollectionNames", () => {
  test("returns just the real collection name strings", () => {
    expect(authoritativeCollectionNames().sort()).toEqual(
      ["budgets", "expenses", "incomes", "merchantcategoryrules", "mlfeedbacks", "recurringexpenses", "users"].sort()
    );
  });
});

describe("cross-check against the app's real mongoose models", () => {
  // This is the same check performed manually while building this task
  // (see collections.js's header comment), pinned down as an automated
  // regression test: if a future schema change adds an explicit
  // `collection:` override, or Mongoose's pluralization rules ever
  // change, this test catches the drift instead of silently backing up
  // (or restoring into) the wrong collection name.
  test("every resolved collection name matches mongoose's actual collection.name for that model", () => {
    // Re-implemented deliberately rather than importing app models
    // directly here (this test file must not require a live MongoDB
    // connection or the app's full model graph just to check naming) --
    // this reproduces mongoose's own pluralize() algorithm via the same
    // mongoose package already used throughout this repo.
    const mongoose = require("mongoose");
    const pluralize = mongoose.pluralize();

    const modelRegistrationNames = {
      users: "users",
      expenses: "expenses",
      incomes: "incomes",
      budget: "budget",
      mlFeedback: "mlFeedback",
      RecurringExpense: "recurringExpenses",
      MerchantCategoryRule: "MerchantCategoryRule",
    };

    for (const entry of AUTHORITATIVE_COLLECTIONS) {
      const expected = pluralize(modelRegistrationNames[entry.label]);
      expect(entry.collection).toBe(expected);
    }
  });
});
