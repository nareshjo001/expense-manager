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
    // Js's sendPush for where this is set.
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

// Md). js) -- no code filters Notification by a second field alongside userId, so a plain field index matches actual usage rather than a specu.
notificationSchema.index({ userId: 1 });

module.exports = mongoose.model("Notification", notificationSchema);