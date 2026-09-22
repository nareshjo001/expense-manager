"use strict";

// REC-002-T02/T04 -- PATCH /api/recurring/:id/pause, /resume, /end, and
// PATCH /api/recurring/:id (edit). Thin HTTP wrappers around
// recurringLifecycleService -- validation and status-code mapping live
// here; all actual state-transition/CAS logic lives in the service (kept
// there, not duplicated here, exactly so it can be unit-tested fast and
// directly -- see recurringLifecycleService.test.js's header comment for
// why that split matters in this environment).
const mongoose = require("mongoose");
const {
  pauseDefinition,
  resumeDefinition,
  endDefinition,
  editDefinition,
} = require("../../Services/RecurringServices/recurringLifecycleService");

// Maps a service failure `reason` to an HTTP response. One place for this
// so pause/resume/end/edit -- which share almost all of their failure modes
// -- can't drift into inconsistent status codes for the same reason.
function respondToFailure(res, result) {
  switch (result.reason) {
    case "not_found":
      return res.status(404).json({ message: "Recurring expense not found", success: false });

    case "already_paused":
      return res.status(409).json({
        message: "This recurring expense is already paused",
        success: false,
        errorCode: "ALREADY_PAUSED",
      });

    case "already_active":
      return res.status(409).json({
        message: "This recurring expense is already active",
        success: false,
        errorCode: "ALREADY_ACTIVE",
      });

    case "already_ended":
      return res.status(409).json({
        message: "This recurring expense has ended and can no longer be changed",
        success: false,
        errorCode: "ALREADY_ENDED",
      });

    case "version_conflict":
      // 409, not 400/404 -- the request was well-formed and the resource
      // exists; it changed under the caller since they last read it. The
      // current server-side definition is returned so the client can
      // resync (refresh scheduleVersion) and retry without a second
      // round-trip.
      return res.status(409).json({
        message: "This recurring expense was changed by another request. Refresh and try again.",
        success: false,
        errorCode: "SCHEDULE_VERSION_CONFLICT",
        data: result.current,
      });

    case "no_fields_provided":
      return res.status(400).json({
        message: "At least one field must be provided to edit",
        success: false,
        errorCode: "NO_FIELDS_PROVIDED",
      });

    case "invalid_name":
      return res.status(400).json({
        message: "Expense name must be a non-empty value",
        success: false,
        errorCode: "INVALID_NAME",
      });

    case "invalid_category":
      return res.status(400).json({
        message: "Expense category must be a valid, non-empty value",
        success: false,
        errorCode: "INVALID_CATEGORY",
      });

    case "invalid_amount":
      return res.status(400).json({
        message: "Expense amount must be a valid, positive, finite number",
        success: false,
        errorCode: "INVALID_AMOUNT",
      });

    case "invalid_next_due_date":
      return res.status(400).json({
        message: "nextDueDate must be a valid date",
        success: false,
        errorCode: "INVALID_NEXT_DUE_DATE",
      });

    case "next_due_date_in_past":
      return res.status(400).json({
        message: "nextDueDate cannot be in the past",
        success: false,
        errorCode: "NEXT_DUE_DATE_IN_PAST",
      });

    case "invalid_end_date":
      return res.status(400).json({
        message: "endDate must be a valid date",
        success: false,
        errorCode: "INVALID_END_DATE",
      });

    default:
      // Unreached in practice -- every reason the service can return is
      // handled above. A safe, generic fallback rather than leaking an
      // internal reason string if the service ever adds one this
      // controller doesn't yet know about.
      console.error("recurring lifecycle: unmapped failure reason:", result.reason);
      return res.status(500).json({ message: "Internal Server Error", success: false });
  }
}

// Every mutation here requires scheduleVersion in the body -- an unversioned
// mutation would defeat the whole point of REC-002-T04 (CAS), since there
// would be nothing to compare against.
function extractScheduleVersion(body) {
  const { scheduleVersion } = body;
  if (typeof scheduleVersion !== "number" || !Number.isInteger(scheduleVersion) || scheduleVersion < 0) {
    return null;
  }
  return scheduleVersion;
}

function validateId(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "Invalid recurring expense ID", success: false });
    return null;
  }
  return id;
}

function makeSimpleAction(actionFn, successMessage) {
  return async (req, res) => {
    const id = validateId(req, res);
    if (id === null) return;

    const scheduleVersion = extractScheduleVersion(req.body);
    if (scheduleVersion === null) {
      return res.status(400).json({
        message: "scheduleVersion (a non-negative integer) is required",
        success: false,
        errorCode: "INVALID_SCHEDULE_VERSION",
      });
    }

    try {
      const result = await actionFn(req.userId, id, scheduleVersion);
      if (!result.ok) return respondToFailure(res, result);
      return res.status(200).json({ message: successMessage, success: true, data: result.definition });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ message: "Internal Server Error", success: false });
    }
  };
}

const pauseRecurring = makeSimpleAction(pauseDefinition, "Recurring expense paused");
const resumeRecurring = makeSimpleAction(resumeDefinition, "Recurring expense resumed");
const endRecurring = makeSimpleAction(endDefinition, "Recurring expense ended");

const editRecurring = async (req, res) => {
  const id = validateId(req, res);
  if (id === null) return;

  const scheduleVersion = extractScheduleVersion(req.body);
  if (scheduleVersion === null) {
    return res.status(400).json({
      message: "scheduleVersion (a non-negative integer) is required",
      success: false,
      errorCode: "INVALID_SCHEDULE_VERSION",
    });
  }

  // Everything except scheduleVersion itself is a candidate editable field;
  // the service validates which of those it actually recognizes.
  const { scheduleVersion: _omit, ...body } = req.body;

  try {
    const result = await editDefinition(req.userId, id, body, scheduleVersion);
    if (!result.ok) return respondToFailure(res, result);
    return res.status(200).json({ message: "Recurring expense updated", success: true, data: result.definition });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { pauseRecurring, resumeRecurring, endRecurring, editRecurring };
