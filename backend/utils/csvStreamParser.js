"use strict";

// A hand-rolled, dependency-free CSV parser.
const { MAX_IMPORT_ROWS } = require("./importTypes");
// Js already owns exactly this defense (DAT-004-T07's own requirement, applied to every CSV cell this app ever WRITES).
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

// G. toString ("utf8")) into { headerRow: string[], rows: string[][] } -- `rows` excludes the header row.
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

  // G. from a file that DOES end in a trailing newline, which this parser otherwise tolerates as an ordinary row terminator).
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
