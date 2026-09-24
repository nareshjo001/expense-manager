"use strict";

// Shared request-scoped aggregation primitive, extracted under ADR-0008
// (docs/decisions/ADR-0008-financial-derived-data-boundary.md, ARC-001-T05/
// T06) to remove the "sum an array of {expenseAmount}/{incomeAmount}
// records" duplication that ADR-0008's T05/T06 section names across
// Controllers/IncomeControllers/insightsCard.js, insightsHeader.js and
// Services/ChartServices/chart.service.js.
//
// This is a pure, request-scoped helper only: nothing here is persisted or
// cached, so none of ADR-0008's invalidation/revision-fencing contracts
// apply to it -- see ADR-0008's T02 classification ("recomputable, never
// persisted, no staleness risk by construction").

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
