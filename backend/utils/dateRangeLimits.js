"use strict";

// EXP-002-T02 -- shared date-range span cap for expense search
// (GET /expense/search). Mirrors sia/financialQueryService.js's own
// MAX_PERIOD_SPAN_DAYS (366, "the 12-month history ceiling") by VALUE, not
// by import: that file's own header restricts it to SIA controllers only
// ("the ONLY module SIA controllers may use"), confirmed by checking that
// no non-SIA file currently imports it, so a non-SIA route reuses the same
// number here instead of reaching into a module scoped to a different
// subsystem. EXP-002-T01's filter-contract doc flagged the ABSENCE of any
// span cap on this endpoint as a real, previously-undocumented gap -- this
// constant is what closes it.
const MAX_PERIOD_SPAN_DAYS = 366;

module.exports = { MAX_PERIOD_SPAN_DAYS };
