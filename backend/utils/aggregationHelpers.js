"use strict";

// Js. This is a pure, request-scoped helper only: nothing here is persisted or cached, so none of ADR-0008's invalidation/revision-fencing con.

/**
 * Sums a numeric field across an array of records. Each value is coerced
 * with Number(), matching chart.service.js's pre-existing categoryTotals/
 * groupByYear behavior exactly: a missing or non-numeric field degrades to
 * NaN (Number(undefined) === NaN) rather than being silently treated as 0,
 * which is also byte-for-byte what insightsCard.js/insightsHeader.js's own
 * un-coerced `sum + record.field` already did (undefined + number is NaN
 * too). Migrating either call site to this helper changes no behavior.
 *
 * @param {Array<Object>} records
 * @param {string} fieldName
 * @returns {number}
 */
function sumByField(records, fieldName) {
  return (records || []).reduce(
    (sum, record) => sum + Number(record && record[fieldName]),
    0
  );
}

module.exports = { sumByField };
