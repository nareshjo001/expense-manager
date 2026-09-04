"use strict";
const { toMinorUnits } = require("./money");

function dualWriteEnabled() {
  return process.env.MONEY_MINOR_DUAL_WRITE_ENABLED === "true";
}

// NOTE (fix, 2026-09-04): these hooks used to be written in the legacy
// Mongoose callback style -- `function preSaveMoneyMinorSync(next) { ...
// next(); }`. That style stopped working when this repo's mongoose/kareem
// were upgraded to mongoose@9 / kareem@3: kareem's execPre now explicitly
// strips any trailing function argument before invoking a pre hook ("skip
// callbacks to avoid accidentally calling the callback from a hook"), so
// `next` arrives as `undefined` and `next()` throws `TypeError: next is
// not a function`. This broke every real write path that goes through
// these hooks (setbudget, addExpense, recurring-expense creation) even
// though MONEY_MINOR_DUAL_WRITE_ENABLED defaults to false, because the
// crash happened before the flag was ever checked -- calling the (now
// missing) callback was the very first line of each hook.
//
// The fix: these hooks are synchronous and never need to signal async
// completion, so they're now written with no callback parameter at all,
// matching the modern kareem contract (a pre hook either returns nothing/
// a plain value, in which case kareem treats it as already complete, or
// returns a promise, which kareem awaits). No `next` is declared or
// called anywhere below.
function attachMoneyMinorSync(schema, fieldPairs) {
  schema.pre("save", function preSaveMoneyMinorSync() {
    if (!dualWriteEnabled()) return;
    for (const { legacyField, minorField } of fieldPairs) {
      const isNew = this.isNew;
      const legacyChanged = this.isModified(legacyField);
      if (!isNew && !legacyChanged) {
        continue;
      }
      const legacyValue = this[legacyField];
      if (typeof legacyValue === "number" && Number.isFinite(legacyValue)) {
        this[minorField] = toMinorUnits(legacyValue);
      }
    }
  });

  const queryHooks = ["findOneAndUpdate", "updateOne", "updateMany"];
  for (const hookName of queryHooks) {
    schema.pre(hookName, function preUpdateMoneyMinorSync() {
      if (!dualWriteEnabled()) return;
      const update = this.getUpdate();
      if (!update || typeof update !== "object") return;
      const setTarget = update.$set && typeof update.$set === "object" ? update.$set : update;
      for (const { legacyField, minorField } of fieldPairs) {
        if (!Object.prototype.hasOwnProperty.call(setTarget, legacyField)) {
          continue;
        }
        const legacyValue = setTarget[legacyField];
        if (typeof legacyValue === "number" && Number.isFinite(legacyValue)) {
          setTarget[minorField] = toMinorUnits(legacyValue);
        }
      }
      this.setUpdate(update);
    });
  }
}

module.exports = { attachMoneyMinorSync, dualWriteEnabled };
