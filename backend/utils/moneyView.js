"use strict";

// DAT-001-T06 -- the API half of the minor-units switch.
//
// ADR-0003 made integer minor units authoritative, DAT-001-T03 built the
// arithmetic, and T04/T05 added the `*Minor` shadow fields and the
// dual-write hooks. What was still missing is the one thing a client can
// see: every API response still carried ONLY the legacy rupee float, so a
// consumer had no exact value to render and had to re-round a float that may
// already have drifted.
//
// This adds minor units to responses ADDITIVELY. Existing fields keep their
// name, type and value, so no consumer breaks; a client that understands
// minor units reads the new field, and one that does not carries on exactly
// as before. That is what makes the switch landable in a single change
// rather than as a coordinated backend/frontend release.
//
// DERIVED, NOT READ FROM THE SHADOW FIELDS -- this is the important decision
// here. `MONEY_MINOR_DUAL_WRITE_ENABLED` defaults to false
// (utils/moneyMinorSync.js), so for most deployments the stored `*Minor`
// columns are NULL for any document written since they were introduced.
// Serving those directly would emit nulls, or worse, a stale value written
// before the flag was turned off. Converting the legacy float at read time
// through the shared toMinorUnits() always produces a correct value for what
// is actually stored today, and keeps working unchanged once dual-write is
// enabled and the two agree.
//
// This is deliberately NOT the same thing as DAT-001-T07. That task removes
// the legacy fields after reconciliation and a verified backup, and stays
// Blocked: it needs this change to soak in production first, so that any
// disagreement between the derived and stored values shows up while both are
// still present.
const { toMinorUnits } = require("./money");

// Returns the integer-paise equivalent of a rupee value, or null when the
// value is absent or not finite.
//
// Returns null rather than 0 for a missing amount, and never throws. A money
// field being absent is normal in this data (an optional budget, a report
// section with no data yet), and a serializer is the wrong place to decide
// that missing means zero -- zero is a real balance, and a client that
// renders it as "₹0.00" would be stating something false.
function toMinorOrNull(rupees) {
  if (typeof rupees !== "number" || !Number.isFinite(rupees)) return null;
  try {
    return toMinorUnits(rupees);
  } catch {
    return null;
  }
}

// Adds a `<field>Minor` sibling for each named money field on a plain object.
//
// Mutates nothing: returns a shallow copy, because these objects are
// frequently lean() documents or cached report payloads that other code
// still holds a reference to.
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
