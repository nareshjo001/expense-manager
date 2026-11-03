"use strict";

// The API half of the minor-units switch.
const { toMinorUnits } = require("./money");

// Returns the integer-paise equivalent of a rupee value, or null when the value is absent or not finite.
function toMinorOrNull(rupees) {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) return null;
  try {
    return toMinorUnits(rupees);
  } catch {
    return null;
  }
}

// Adds a `<field>Minor` sibling for each named money field on a plain object.
function withMinorFields(source, fieldNames) {
  if (!source || typeof source !== "object") return source;

  const out = { ...source };
  for (const field of fieldNames) {
    out[`${field}Minor`] = toMinorOrNull(source[field]);
  }
  return out;
}

// Convenience for a list of documents.
function withMinorFieldsAll(list, fieldNames) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => withMinorFields(item, fieldNames));
}

module.exports = {
  toMinorOrNull,
  withMinorFields,
  withMinorFieldsAll,
};
