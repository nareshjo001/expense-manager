"use strict";

// GET /api/export. Lists the authenticated user's own export requests, newest first.
const { listExportRequests } = require("../../Services/ExportServices/exportRequestService");

const listExports = async (req, res) => {
  try {
    const data = await listExportRequests({ userId: req.userId });
    return res.status(200).json({ message: "Success", success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { listExports };
