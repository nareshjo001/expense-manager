"use strict";
const { toMinorUnits } = require("./money");

function dualWriteEnabled() {
  return process.env.MONEY_MINOR_DUAL_WRITE_ENABLED === "true";
}

// NOTE (fix, 2026-09-04): these hooks used to be written in the legacy Mongoose callback style -- `function preSaveMoneyMinorSync(next) { ...
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
