const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'users',
    required: true 
  },
  title: {
    type: String
  },
  message: {
    type: String
  },
  type: {
    type: String // recurring-expense, system, etc.
  }, 
  relatedId: {
    type: mongoose.Schema.Types.ObjectId, // expense id
    ref: "expenses"
  },
  pushStatus: {
    type: String,
    // NOT-003-T03/T04 -- "suppressed" is distinct from "failed": a
    // preference-disabled type or an active quiet-hours window is not a
    // delivery FAILURE (nothing went wrong, the user asked for this), so it
    // must never enter retryPush.js's retry queue the way "failed" does --
    // see push.service.js's sendPush for where this is set.
    enum: ["pending", "sent", "failed", "suppressed"],
    default: "pending"
  },
  retryCount: { 
    type: Number, 
    default: 0 
  },
  nextRetryAt: { 
    type: Date, 
    default: null 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  }
}, { timestamps: true });

// DAT-002-T03 -- userId was previously entirely unindexed on this user-owned
// collection (gap 3.3, docs/data/DAT-002-T01-schema-and-index-inventory.md).
// Real query patterns here are single-field equality on userId (Notification.deleteMany({ userId })
// in accountDeletionTierBSteps.js) -- no code filters Notification by a second field alongside userId,
// so a plain field index matches actual usage rather than a speculative compound key.
notificationSchema.index({ userId: 1 });

module.exports = mongoose.model("Notification", notificationSchema);