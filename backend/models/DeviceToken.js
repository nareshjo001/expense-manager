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

// DAT-002-T03 -- userId was previously entirely unindexed on this user-owned
// collection (gap 3.3, docs/data/DAT-002-T01-schema-and-index-inventory.md).
// Real query patterns are single-field equality on userId (DeviceToken.find({ userId }) in push.service.js,
// DeviceToken.deleteMany({ userId }) in accountDeletionTierASteps.js) -- the token field is already uniquely
// indexed and findOneAndUpdate({ token, userId }) is a point lookup on that unique key,
// so a plain field index on userId matches actual usage.
deviceTokenSchema.index({ userId: 1 });

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
