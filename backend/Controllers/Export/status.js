"use strict";

// DAT-004-T04 -- GET /api/export/:id/status. Thin wrapper around
// exportRequestService.getExportRequestStatus, which scopes the lookup to
// BOTH the request id AND req.userId -- so polling another user's id
// here always 404s, the same "not found" the caller gets for an id that
// does not exist at all (see that service function's own comment: it
// deliberately never distinguishes the two).
const mongoose = require("mongoose");
const { getExportRequestStatus, ERROR_CODES } = require("../../Services/ExportServices/exportRequestService");

const getExportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ message: "Export request not found", success: false });
    }

    const data = await getExportRequestStatus({ userId: req.userId, id });
    return res.status(200).json({ message: "Success", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json({ message: "Export request not found", success: false });
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getExportStatus };
