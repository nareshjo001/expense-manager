"use strict";

// T03/T05 (ADR-0007) -- re-authenticated account-deletion request, cancellation, and status lookup, plus Tier A's immediate side effects.

const { UserModel } = require("../../config/Schemas");
const { comparePasswordOrDummy } = require("../../Services/AuthServices/password.service");
const { emitAuthAuditEvent } = require("../../Services/AuthServices/security.service");
const { runTierAImmediate } = require("../../Services/PrivacyServices/accountDeletionTierASteps");

// ADR-0007's approved default.
const DELETION_GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

const DELETION_ALREADY_PENDING_RESPONSE = Object.freeze({
  success: false,
  message: "Account deletion is already scheduled for this account.",
  code: "DELETION_ALREADY_PENDING",
});

const NO_DELETION_PENDING_RESPONSE = Object.freeze({
  success: false,
  message: "No account deletion is currently scheduled.",
  code: "NO_DELETION_PENDING",
});

const INVALID_PASSWORD_RESPONSE = Object.freeze({
  success: false,
  message: "Current password is incorrect.",
  code: "INVALID_CURRENT_PASSWORD",
});

const requestDeletion = async (req, res) => {
  try {
    const { password } = req.body;
    const user = await UserModel.findById(req.userId);

    // Js already uses for its own password compare.
    const isMatch = await comparePasswordOrDummy(password, user?.password);

    if (!user || !isMatch) {
      emitAuthAuditEvent({
        event: "account_deletion_requested",
        outcome: "denied",
        reason: !user ? "unknown_identity" : "invalid_secret",
        req,
        email: user?.email,
      });
      return res.status(401).json(INVALID_PASSWORD_RESPONSE);
    }

    if (user.deletionRequestedAt) {
      emitAuthAuditEvent({
        event: "account_deletion_requested",
        outcome: "denied",
        reason: "already_pending",
        req,
        email: user.email,
      });
      return res.status(409).json(DELETION_ALREADY_PENDING_RESPONSE);
    }

    const requestedAt = new Date();
    const scheduledPurgeAt = new Date(requestedAt.getTime() + DELETION_GRACE_PERIOD_MS);

    // Js's guarded findOneAndUpdate already relies on).
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id, deletionRequestedAt: null },
      { $set: { deletionRequestedAt: requestedAt, deletionScheduledPurgeAt: scheduledPurgeAt } },
      { new: true }
    );

    if (!updated) {
      emitAuthAuditEvent({
        event: "account_deletion_requested",
        outcome: "denied",
        reason: "already_pending",
        req,
        email: user.email,
      });
      return res.status(409).json(DELETION_ALREADY_PENDING_RESPONSE);
    }

    emitAuthAuditEvent({ event: "account_deletion_requested", outcome: "success", req, email: user.email });

    // ADR-0007 Tier A -- "the moment a re-authenticated deletion request is accepted".
    await runTierAImmediate(updated._id);

    return res.status(200).json({
      success: true,
      message: "Account deletion has been scheduled.",
      deletionRequestedAt: updated.deletionRequestedAt,
      scheduledPurgeAt: updated.deletionScheduledPurgeAt,
    });
  } catch (err) {
    console.error("Account deletion request failed:", err.message);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

// ADR-0007 "Cancellation" -- reuses ordinary authenticated access (no new out-of-band mechanism); clears the pending markers.
const cancelDeletion = async (req, res) => {
  try {
    const updated = await UserModel.findOneAndUpdate(
      { _id: req.userId, deletionRequestedAt: { $ne: null } },
      { $set: { deletionRequestedAt: null, deletionScheduledPurgeAt: null } },
      { new: true }
    );

    if (!updated) {
      return res.status(409).json(NO_DELETION_PENDING_RESPONSE);
    }

    emitAuthAuditEvent({ event: "account_deletion_cancelled", outcome: "success", req, email: updated.email });

    return res.status(200).json({ success: true, message: "Account deletion has been cancelled." });
  } catch (err) {
    console.error("Account deletion cancellation failed:", err.message);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

const getDeletionStatus = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId)
      .select("deletionRequestedAt deletionScheduledPurgeAt")
      .lean();

    if (!user) {
      return res.status(401).json({ message: "User does not exist", success: false });
    }

    return res.status(200).json({
      success: true,
      pending: Boolean(user.deletionRequestedAt),
      deletionRequestedAt: user.deletionRequestedAt || null,
      scheduledPurgeAt: user.deletionScheduledPurgeAt || null,
    });
  } catch (err) {
    console.error("Account deletion status lookup failed:", err.message);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = {
  requestDeletion,
  cancelDeletion,
  getDeletionStatus,
  DELETION_GRACE_PERIOD_MS,
  DELETION_ALREADY_PENDING_RESPONSE,
  NO_DELETION_PENDING_RESPONSE,
  INVALID_PASSWORD_RESPONSE,
};
