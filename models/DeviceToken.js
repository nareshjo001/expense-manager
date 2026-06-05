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
  }
}, {
  timestamps: true
});

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);