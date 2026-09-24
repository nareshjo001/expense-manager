"use strict";

// IMP-001-T02 -- a hand-rolled, dependency-free CSV parser. This codebase
// deliberately has no CSV-parsing library (DAT-004 only ever needed to
// WRITE CSV, via utils/exportTypes.js's own csvRow/sanitizeCsvCell, never
// parse one) -- following the same "no new dependency without cause"
// discipline, this is a small RFC4180-shaped parser: a quoted field may
// contain commas/newlines, and a doubled quote ("") inside a quoted field
// is an escaped literal quote.
//
// "Streaming" here means ROW-BOUNDED, not I/O-streamed from disk: the
// whole uploaded buffer is already in memory before this runs (multer
// memory storage, same as every other upload in this app -- see
// receiptSecurity.service.js), so the actual defense against an oversized
// file is aborting the PARSE the instant MAX_IMPORT_ROWS would be
// exceeded, rather than finishing a parse whose result would just be
// rejected afterward. A truly disk-streamed parser would only matter if
// uploads here went straight to disk, which none of this app's uploads
// do.
const { MAX_IMPORT_ROWS } = require("./importTypes");
// Formula-injection defense (OWASP CSV-injection guidance: a cell
// starting with =, +, -, @, tab or CR is a spreadsheet-formula trigger)
// is NOT reinvented here -- utils/exportTypes.js already owns exactly
// this defense (DAT-004-T07's own requirement, applied to every CSV cell
// this app ever WRITES). Reusing it on the IMPORT side is defense in
// depth: exportTypes.js's sanitizeCsvCell already neutralizes anything
// re-exported later regardless of what's stored, and applying the same
// guard here means a formula-injection string never even reaches storage
// looking like a clean value in the first place.
const { sanitizeCsvCell } = require("./exportTypes");

const ERROR_CODES = Object.freeze({
  TOO_MANY_ROWS: "IMPORT_TOO_MANY_ROWS",
  EMPTY_FILE: "IMPORT_EMPTY_FILE",
  MALFORMED_ROW: "IMPORT_MALFORMED_ROW",
});

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Parses `text` (already-decoded CSV content, e.g. file.buffer.toString
// ("utf8")) into { headerRow: string[], rows: string[][] } -- `rows`
// excludes the header row.
//
// Throws:
//   - ERROR_CODES.EMPTY_FILE for a blank/whitespace-only input, or one
//     whose only content is a header row with zero data rows.
//   - ERROR_CODES.TOO_MANY_ROWS the instant the (maxRows + 1)th DATA row
//     would be produced -- fail fast, never finish parsing an oversized
//     file first.
//   - ERROR_CODES.MALFORMED_ROW for an unterminated quoted field (a
//     stray opening quote with no matching close before EOF).
function parseCsv(text, { maxRows = MAX_IMPORT_ROWS } = {}) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw makeError("parseCsv: input is empty.", ERROR_CODES.EMPTY_FILE);
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  function endField() {
    row.push(field);
    field = "";
  }
  function endRow() {
    endField();
    rows.push(row);
    row = [];
    // rows[0] is the header -- data-row count is rows.length - 1.
    if (rows.length - 1 > maxRows) {
      throw makeError(
        `parseCsv: input exceeds the maximum of ${maxRows} data rows.`,
        ERROR_CODES.TOO_MANY_ROWS
      );
    }
  }

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // Swallow a bare \r or the \r half of a \r\n pair -- the row ends
      // on \n below (or at EOF, handled after the loop).
      i += 1;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw makeError("parseCsv: an opening quote is never closed.", ERROR_CODES.MALFORMED_ROW);
  }

  // Final row/field if the file doesn't end with a trailing newline.
  if (field.length > 0 || row.length > 0) {
    endRow();
  }

  // Drop a single trailing fully-empty row -- a lone blank line right
  // before EOF (e.g. from a file that DOES end in a trailing newline,
  // which this parser otherwise tolerates as an ordinary row terminator).
  // Never drops a genuinely blank DATA row in the middle of the file,
  // only this specific harmless end-of-file artifact.
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") {
      rows.pop();
    }
  }

  if (rows.length === 0) {
    throw makeError("parseCsv: no rows found.", ERROR_CODES.EMPTY_FILE);
  }

  const [headerRow, ...dataRows] = rows;

  if (dataRows.length === 0) {
    throw makeError("parseCsv: header row present but no data rows follow.", ERROR_CODES.EMPTY_FILE);
  }

  return { headerRow, rows: dataRows };
}

module.exports = {
  ERROR_CODES,
  parseCsv,
  sanitizeCsvCell,
};
