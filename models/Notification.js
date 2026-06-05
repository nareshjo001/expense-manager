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
    enum: ["pending", "sent", "failed"],
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
});

module.exports = mongoose.model("Notification", notificationSchema);