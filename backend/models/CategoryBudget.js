"use strict";

const mongoose = require("mongoose");

// BUD-001-T02 -- optional per-category monthly allocations. A separate
// collection, not new fields on config/Schemas.js's BudgetModel, so the
// existing total-budget document, its sync/fencing machinery and its
// endpoints stay exactly as they are (invariant I1 in
// docs/budgets/BUD-001-T01-category-budget-invariants.md).
//
// Deliberately NOT stored: `spent`. Unlike BudgetModel.spent, per-category
// spent is always derived at read time from expenses (invariant I9), so
// there is no second derived value to keep in sync after every expense
// mutation.
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const categoryBudgetSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    // Canonical "YYYY-MM" (I2) -- locale-independent and sortable, unlike
    // the legacy "MMM YYYY" BudgetModel key.
    month: {
      type: String,
      required: true,
      match: MONTH_PATTERN,
    },
    // Output of utils/categoryNormalization.js's normalizeCategory() (I2/I3).
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    // Rupees, for display/compatibility with the rest of the money model;
    // amountMinor is the arithmetic source of truth (ADR-0003, I4).
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "amountMinor must be an integer number of paise",
      },
    },
    // BUD-001-T06 alert bookkeeping (I14): highest alert level already
    // notified for this allocation this month. 0 = none, 1 = Critical,
    // 2 = Overspent. Reset to 0 whenever `amount` changes.
    lastAlertLevel: {
      type: Number,
      default: 0,
      min: 0,
      max: 2,
    },
  },
  { timestamps: true }
);

// The one real query pattern is "all allocations for this user in this
// month", served by this index's {userId, month} prefix; the full key also
// enforces I2's one-allocation-per-category rule. Also created explicitly
// by migrations/scripts/20260926-ensure-category-budget-indexes.js
// (DAT-003 convention) so index presence doesn't depend on autoIndex.
categoryBudgetSchema.index(
  { userId: 1, month: 1, category: 1 },
  { unique: true, name: "userId_month_category_unique" }
);

const CategoryBudgetModel = mongoose.model("CategoryBudget", categoryBudgetSchema);

module.exports = { CategoryBudgetModel, MONTH_PATTERN };
