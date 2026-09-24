"use strict";

// REC-002-T02 -- GET /api/recurring (list) and GET /api/recurring/:id
// (detail). Both are read-only, user-scoped views over
// recurringLifecycleService's toPublicShape() output -- see that file for
// why the shape includes scheduleVersion (the client needs it for its next
// mutation) and excludes nothing (a recurring definition is no more
// sensitive than the expense it came from).
const mongoose = require("mongoose");
const { listDefinitions, getDefinition } = require("../../Services/RecurringServices/recurringLifecycleService");

const listRecurring = async (req, res) => {
  try {
    const definitions = await listDefinitions(req.userId);
    return res.status(200).json({ message: "Success", success: true, data: definitions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

const getRecurringDetail = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid recurring expense ID", success: false });
  }

  try {
    const definition = await getDefinition(req.userId, id);
    // Non-disclosing 404, matching the rest of the codebase's convention --
    // the same response whether the id doesn't exist or belongs to someone
    // else (see recurring.js's own comment on the identical choice).
    if (!definition) {
      return res.status(404).json({ message: "Recurring expense not found", success: false });
    }
    return res.status(200).json({ message: "Success", success: true, data: definition });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { listRecurring, getRecurringDetail };
