const mongoose = require("mongoose");

// DAT-004-T01/T02 -- tracks a queued (large) export end-to-end. A
// synchronous (small) export never creates one of these at all -- see
// utils/exportTypes.js's SYNC_ROW_LIMIT.
const exportRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
  domain: {
    type: String,
    enum: ["expenses", "income", "budgets", "all"],
    required: true,
  },
  format: {
    type: String,
    enum: ["csv", "json"],
    required: true,
  },
  dateFrom: { type: Date, default: null },
  dateTo: { type: Date, default: null },
  status: {
    type: String,
    enum: ["queued", "processing", "ready", "failed", "expired"],
    default: "queued",
    required: true,
  },
  // Opaque, unguessable token used in the download URL -- never the
  // Mongo _id (sequential/enumerable) and never the raw disk path.
  // Ownership is still re-checked against req.userId on every access, so
  // this token alone is defense in depth, not the only control.
  downloadToken: {
    type: String,
    required: true,
    unique: true,
  },
  // Server-relative path under the generated-exports directory -- never
  // sent to the client (the controller resolves downloadToken -> this
  // path server-side only).
  filePath: { type: String, default: null },
  fileName: { type: String, default: null },
  rowCount: { type: Number, default: null },
  sizeBytes: { type: Number, default: null },
  errorMessage: { type: String, default: null },
  readyAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

// Real query patterns: a user listing/polling their own requests
// (userId), and the cron sweep resolving a token to a request
// (downloadToken, already uniquely indexed) or scanning for expired ones
// (status + expiresAt).
exportRequestSchema.index({ userId: 1, createdAt: -1 });
exportRequestSchema.index({ status: 1, expiresAt: 1 });

module.exports = mongoose.model("ExportRequest", exportRequestSchema);
