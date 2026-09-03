const mongoose = require("mongoose");

const refreshSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    csrfHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
    revokedAt: { type: Date, default: null, index: true },
    userAgentHash: { type: String, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

refreshSessionSchema.index({ userId: 1, revokedAt: 1, expiresAt: 1 });

module.exports = mongoose.model("RefreshSession", refreshSessionSchema);
