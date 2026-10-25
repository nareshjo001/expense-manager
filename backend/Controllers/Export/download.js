"use strict";

// DAT-004-T04 -- GET /api/export/download/:token. Thin wrapper around
// exportRequestService.resolveDownload (ownership + ready + not-expired
// checks) plus the actual file stream (from disk or in-memory on-demand generation).
//
// Every failure -- token does not exist, belongs to another user, is not
// ready yet, or has expired -- collapses to the same generic 404.
const fs = require("fs/promises");
const { resolveDownload, ERROR_CODES } = require("../../Services/ExportServices/exportRequestService");

const NOT_FOUND_RESPONSE = { message: "Export not found", success: false };

const downloadExport = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== "string") {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const resolved = await resolveDownload({ userId: req.userId, token });
    const { fileName, contentType } = resolved;

    let content = resolved.content;
    if (!content && resolved.filePath) {
      try {
        content = await fs.readFile(resolved.filePath);
      } catch {
        return res.status(404).json(NOT_FOUND_RESPONSE);
      }
    }

    if (!content) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.status(200).send(content);
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { downloadExport };
