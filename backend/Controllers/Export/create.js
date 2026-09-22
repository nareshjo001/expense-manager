"use strict";

// DAT-004-T04 -- POST /api/export. Thin HTTP wrapper around
// exportRequestService.createExportRequest -- request-shape validation
// and status-code mapping live here, matching
// Controllers/RecurringExpenses/lifecycle.js's own split between "thin
// controller, service owns the rules".
const { createExportRequest, ERROR_CODES } = require("../../Services/ExportServices/exportRequestService");
const { MAX_EXPORT_ROWS } = require("../../utils/exportTypes");

// Maps a thrown service error's `.code` to a response message. One place
// for this so it can't drift out of sync with exportRequestService.js's
// own ERROR_CODES.
const ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_DOMAIN]: "domain must be one of: expenses, income, budgets, all",
  [ERROR_CODES.INVALID_FORMAT]: "format must be one of: csv, json",
  [ERROR_CODES.INVALID_COMBINATION]: 'domain "all" can only be exported as json',
  [ERROR_CODES.TOO_MANY_ROWS]: `Requested export exceeds the maximum of ${MAX_EXPORT_ROWS} rows. Narrow the date range and try again.`,
};

// Parses an optional date-range bound from the request body. Returns
// `undefined` when the field was not provided at all (so the service's
// "no bound" behavior is preserved), `null` on an invalid/unparseable
// value so the caller can 400 rather than silently passing an Invalid
// Date through to a Mongo query.
function parseOptionalDate(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

const createExport = async (req, res) => {
  try {
    const body = req.body || {};
    const { domain, format } = body;

    if (!domain || !format) {
      return res.status(400).json({
        message: "domain and format are required",
        success: false,
        errorCode: "MISSING_FIELDS",
      });
    }

    const dateFrom = parseOptionalDate(body.dateFrom);
    const dateTo = parseOptionalDate(body.dateTo);
    if (dateFrom === null || dateTo === null) {
      return res.status(400).json({
        message: "dateFrom and dateTo must be valid dates when provided",
        success: false,
        errorCode: "INVALID_DATE",
      });
    }

    const result = await createExportRequest({ userId: req.userId, domain, format, dateFrom, dateTo });

    if (result.mode === "sync") {
      res.setHeader("Content-Type", result.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
      return res.status(200).send(result.content);
    }

    // mode === "queued"
    return res.status(202).json({
      message: "Export queued",
      success: true,
      data: {
        id: result.id,
        status: result.status,
        domain: result.domain,
        format: result.format,
        expiresAt: null,
      },
    });
  } catch (err) {
    if (err && err.code && ERROR_MESSAGES[err.code]) {
      return res.status(400).json({
        message: ERROR_MESSAGES[err.code],
        success: false,
        errorCode: err.code,
      });
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { createExport };
