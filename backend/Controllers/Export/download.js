"use strict";

// DAT-004-T04 -- GET /api/export/download/:token. Thin wrapper around
// exportRequestService.resolveDownload (ownership + ready + not-expired
// checks) plus the actual file read -- this is the one place in the
// export feature that touches the generated file on disk from the read
// side (cron/exportGeneration.js is the only writer).
//
// Every failure -- token does not exist, belongs to another user, is not
// ready yet, or has expired -- collapses to the same generic 404. Telling
// those apart in the response would let a caller probing tokens learn
// which case they hit (e.g. "expired" confirms the token was once valid),
// which is exactly the enumeration/leak this endpoint must not allow.
const fs = require("fs/promises");
const { resolveDownload, ERROR_CODES } = require("../../Services/ExportServices/exportRequestService");

const NOT_FOUND_RESPONSE = { message: "Export not found", success: false };

const downloadExport = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || typeof token !== "string") {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const { filePath, fileName, contentType } = await resolveDownload({ userId: req.userId, token });

    let content;
    try {
      content = await fs.readFile(filePath);
    } catch {
      // The DB record says "ready" but the file itself is gone (already
      // swept by expiry, or never written) -- same generic 404 as any
      // other unresolvable token, never a 500 that would hint the token
      // itself was valid.
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
