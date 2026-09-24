"use strict";

// PRV-001-T03/T05 (ADR-0007) -- re-authenticated account-deletion request,
// cancellation, and status lookup, plus Tier A's immediate side effects.
// This controller creates/cancels/reports the pending-deletion marker on
// `users` AND (T05) fires Tier A's immediate-effect steps (session
// revocation, device-token deletion, Redis cache clear -- see
// Services/PrivacyServices/accountDeletionTierASteps.js) right after a
// request is accepted. It deliberately does NOT implement any Tier B data
// deletion itself -- that stays T06's job, run later by the purge cron
// (cron/accountDeletionJob.js) via T04's resumable orchestration engine.
// Mirrors the guarded findOneAndUpdate + revokeAllSessions-on-password-
// change pattern already established in resetPassword.js, and login.js's
// comparePasswordOrDummy()-against-a-dummy-hash pattern for account-
// enumeration resistance when the user record is missing.

const { UserModel } = require("../../config/Schemas");
const { comparePasswordOrDummy } = require("../../Services/AuthServices/password.service");
const { emitAuthAuditEvent } = require("../../Services/AuthServices/security.service");
const { runTierAImmediate } = require("../../Services/PrivacyServices/accountDeletionTierASteps");

// ADR-0007's approved default. Exported so tests and any future admin
// tooling reference the same single source of truth rather than a second
// hardcoded "14 days" appearing elsewhere.
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

    // Timing-safe-ish against account/session confusion even in the
    // (should-be-impossible, verifyToken already resolved req.userId)
    // case the user record is missing -- same defensive shape login.js
    // already uses for its own password compare.
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

    // Guarded atomic transition: the SAME `deletionRequestedAt: null`
    // condition is re-checked in the filter, not just the pre-read above,
    // so two concurrent requests from the same account can't both "win"
    // (the same race-safety shape resetPassword.js's guarded
    // findOneAndUpdate already relies on).
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

    // ADR-0007 Tier A -- "the moment a re-authenticated deletion request is
    // accepted". Awaited so the response reflects Tier A as already applied
    // where possible, but a failed step here is never fatal to this
    // request: it is logged (see runTierAImmediate) and the purge cron
    // re-attempts the identical step list 14 days later as a safety net.
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

// ADR-0007 "Cancellation" -- reuses ordinary authenticated access (no new
// out-of-band mechanism); clears the pending markers. Any still-logged-in
// session can cancel; T05's session revocation happening separately (not
// in this controller) means every session active BEFORE the deletion
// request was made is already gone, so "still logged in" here only ever
// means a session established AFTER the request, i.e. a deliberate fresh
// login by whoever holds the account's current password.
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
