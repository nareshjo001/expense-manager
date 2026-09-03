const mongoose = require("mongoose");

// CAT-001 -- a durable, user-scoped "this merchant always means this
// category" rule. One rule per (user, normalized merchant) -- the unique
// index below is what makes upsertRule() a true upsert-by-merchant rather
// than an ever-growing history of rules for the same merchant.
const merchantCategoryRuleSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true
  },
  // Pre-normalized via utils/merchantNormalization.js before every write --
  // never the raw, differently-cased/whitespaced merchant text.
  merchantKey: {
    type: String,
    required: true
  },
  // Pre-normalized via utils/categoryNormalization.js before every write.
  category: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

merchantCategoryRuleSchema.index({ userId: 1, merchantKey: 1 }, { unique: true });

module.exports = mongoose.model("MerchantCategoryRule", merchantCategoryRuleSchema);
