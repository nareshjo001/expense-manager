"use strict";

// OPS-002-T03 -- the seven authoritative collections ADR-0002 classifies
// as "must be backed up" (docs/decisions/ADR-0002-authoritative-vs-
// disposable-stores.md), resolved from its table's model-registration
// names down to the REAL MongoDB collection names mongodump/mongorestore
// actually operate on.
//
// IMPORTANT DISCREPANCY FOUND WHILE BUILDING THIS TASK: ADR-0002's table
// lists `budget`, `mlFeedback`, `RecurringExpense` and
// `MerchantCategoryRule` as "Collection (model)" names, but those are
// actually the *mongoose model registration strings* passed to
// `mongoose.model(name, schema)` in backend/config/Schemas.js and
// backend/models/*.js. Mongoose auto-pluralizes and lowercases an
// unqualified model name into the real server-side collection name
// unless the model explicitly overrides it with a third `collection`
// argument -- none of these four schemas do (verified: no `collection:`
// option anywhere in backend/config/Schemas.js or backend/models/*.js,
// and `mongoose.model(<name>).collection.name` was checked directly for
// all seven models against this repo's actual code). The REAL names
// mongodump/mongorestore must use are:
//
//   users                 -> users                 (unchanged)
//   expenses              -> expenses               (unchanged)
//   incomes               -> incomes                (unchanged)
//   budget                -> budgets                (pluralized)
//   mlFeedback            -> mlfeedbacks             (pluralized + lowercased)
//   RecurringExpense      -> recurringexpenses       (pluralized + lowercased)
//   MerchantCategoryRule  -> merchantcategoryrules   (pluralized + lowercased)
//
// A backup tool that trusted ADR-0002's table literally would have
// silently backed up nothing for those four collections -- mongodump
// against a nonexistent collection name dumps zero documents without
// erroring. This module is the single place "authoritative store"
// resolves to a real, verified Mongo collection name, so that mistake
// can only ever be made once. ADR-0002 itself is out of scope to edit
// here (OPS-002-T01 already shipped it) -- flag this discrepancy to its
// owner so the table can be corrected or annotated.
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
