const mongoose = require("mongoose");

const deviceTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  platform: {
    type: String,
    enum: ["web", "mobile"],
    required: true
  },
  notificationPreview: {
    type: String,
    enum: ["generic", "detailed"],
    default: "generic",
    required: true
  }
}, {
  timestamps: true
});

// Md). js) -- the token field is already uniquely indexed and findOneAndUpdate({ token, userId }) is a point lookup on that unique key, so a p.
deviceTokenSchema.index({ userId: 1 });

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
