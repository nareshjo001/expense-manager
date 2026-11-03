"use strict";

// Md), resolved from its table's model-registration names down to the REAL MongoDB collection names mongodump/mongorestore actually operate on.
const AUTHORITATIVE_COLLECTIONS = Object.freeze([
  Object.freeze({ label: "users", collection: "users" }),
  Object.freeze({ label: "expenses", collection: "expenses" }),
  Object.freeze({ label: "incomes", collection: "incomes" }),
  Object.freeze({ label: "budget", collection: "budgets" }),
  Object.freeze({ label: "mlFeedback", collection: "mlfeedbacks" }),
  Object.freeze({ label: "RecurringExpense", collection: "recurringexpenses" }),
  Object.freeze({ label: "MerchantCategoryRule", collection: "merchantcategoryrules" }),
]);

function authoritativeCollectionNames() {
  return AUTHORITATIVE_COLLECTIONS.map((entry) => entry.collection);
}

module.exports = { AUTHORITATIVE_COLLECTIONS, authoritativeCollectionNames };
