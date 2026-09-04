"use strict";

// DAT-001-T06 (dual-write half) -- keeps each *Minor shadow field
// (ADR-0003, added in T04) in sync with its legacy float field on every
// write, going forward, so the 20260903-backfill-money-minor-fields
// migration (T04) doesn't fall further behind as new documents are
// created and edited. This does NOT change what anything reads: no
// existing query, aggregation, or API response is touched by this file.
// It only adds one extra field alongside what a write was already going
// to do.
//
// Deliberately flag-gated (MONEY_MINOR_DUAL_WRITE_ENABLED) rather than
// unconditional, even though writing an extra unused field is low risk:
// this is Mongoose middleware running on every expense/income/budget
// write in the app, and this session has no live database to soak-test
// it against under real traffic. Flip the flag on in staging first,
// watch it for a while, then production -- do not flip it in production
// on a code review alone.
//
// The actual read-side cutover (switching APIs/frontend to compute from
// *Minor instead of the legacy field -- the other half of T06) is a
// separate, larger, and reversible-only-with-care change that this
// module does not attempt. It requires DAT-001-T05's dual-read
// verification (backend/scripts/verifyMoneyMinorFields.js) to have run
// clean across a real rollout window first -- see that script's header
// comment and docs/data/DAT-001-T06-cutover-runbook.md.
const { toMinorUnits } = require("./money");

function dualWriteEnabled() {
  return process.env.MONEY_MINOR_DUAL_WRITE_ENABLED === "true";
}

// Attaches pre-save and pre-update hooks to `schema` that derive each
// `minorField` from its `legacyField` whenever the legacy field is being
// written. `fieldPairs` is an array of { legacyField, minorField }.
//
// Fails soft, not closed: a non-numeric/NaN legacy value (already an
// existing data problem the write itself isn't introducing) is left
// alone -- this plugin never blocks or throws on a write. Its only job
// is to keep the shadow field current when it safely can.
function attachMoneyMinorSync(schema, fieldPairs) {
  schema.pre("save", function preSaveMoneyMinorSync(next) {
    if (!dualWriteEnabled()) return next();

    for (const { legacyField, minorField } of fieldPairs) {
      const isNew = this.isNew;
      const legacyChanged = this.isModified(legacyField);
      if (!isNew && !legacyChanged) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const legacyValue = this[legacyField];
      if (typeof legacyValue === "number" && Number.isFinite(legacyValue)) {
        this[minorField] = toMinorUnits(legacyValue);
      }
    }
    return next();
  });

  // findOneAndUpdate/updateOne/updateMany all go through query
  // middleware, not document middleware -- `this` is the Query, and the
  // update payload has to be read/rewritten via getUpdate()/setUpdate()
  // rather than direct field assignment.
  const queryHooks = ["findOneAndUpdate", "updateOne", "updateMany"];
  for (const hookName of queryHooks) {
    schema.pre(hookName, function preUpdateMoneyMinorSync(next) {
      if (!dualWriteEnabled()) return next();

      const update = this.getUpdate();
      if (!update || typeof update !== "object") return next();

      // Support both `{ $set: { field: value } }` (this codebase's
      // convention, per DAT-001-T02's inventory) and a bare top-level
      // `{ field: value }` update, which Mongoose treats as an implicit
      // $set.
      const setTarget = update.$set && typeof update.$set === "object" ? update.$set : update;

      for (const { legacyField, minorField } of fieldPairs) {
        if (!Object.prototype.hasOwnProperty.call(setTarget, legacyField)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const legacyValue = setTarget[legacyField];
        if (typeof legacyValue === "number" && Number.isFinite(legacyValue)) {
          setTarget[minorField] = toMinorUnits(legacyValue);
        }
      }

      this.setUpdate(update);
      return next();
    });
  }
}

module.exports = { attachMoneyMinorSync, dualWriteEnabled };
