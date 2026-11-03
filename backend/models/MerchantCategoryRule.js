const mongoose = require("mongoose");

// A durable, user-scoped "this merchant always means this category" rule.
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
