"use strict";

const { deleteExportRequest, ERROR_CODES } = require("../../Services/ExportServices/exportRequestService");

const NOT_FOUND_RESPONSE = { message: "Export not found", success: false };

const deleteExport = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== "string") {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    await deleteExportRequest({ userId: req.userId, id });
    return res.status(200).json({ message: "Export deleted successfully", success: true });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { deleteExport };
