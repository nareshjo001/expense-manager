"use strict";

// DAT-001-T03 -- central money parsing/formatting helpers. Single source
// of truth for the rupees<->paise conversion and rounding rule
// ADR-0003 specifies, so no call site rounds or converts independently.
// See docs/decisions/ADR-0003-money-representation.md (the decision) and
// docs/data/DAT-001-T02-amount-field-and-arithmetic-inventory.md (every
// call site this module is meant to replace or harden).
//
// Scope today: this module operates on plain rupee Numbers and produces
// integer-paise Numbers -- it does not yet read or write the `*Minor`
// shadow schema fields (that's T04) or switch any API/frontend path
// (T06). T03 is deliberately just the shared, tested arithmetic core
// everything after it builds on.

const MINOR_UNITS_PER_RUPEE = 100;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertFiniteNumber(value, fnName) {
  if (!isFiniteNumber(value)) {
    throw new TypeError(`${fnName}: expected a finite number, got ${JSON.stringify(value)}`);
  }
}

// Converts a rupee amount to integer paise, rounding half away from
// zero -- ADR-0003's binding rule (49.995 -> 5000, -49.995 -> -5000).
// Native Math.round is NOT symmetric for negative .5 values (it rounds
// toward +Infinity, e.g. Math.round(-4999.5) === -4999, not -5000), so
// this applies the sign separately to get true away-from-zero rounding.
// A tiny epsilon nudge (in the rounding direction, negligible next to a
// real rupee amount) corrects IEEE-754 representation error that can
// otherwise land a value just under its true .5 boundary
// (49.995 * 100 is not always exactly 4999.5 in floating point).
function toMinorUnits(rupees) {
  assertFiniteNumber(rupees, "toMinorUnits");
  const scaled = rupees * MINOR_UNITS_PER_RUPEE;
  const sign = scaled < 0 ? -1 : 1;
  const nudged = Math.abs(scaled) + 1e-9;
  return sign * Math.round(nudged);
}

// Converts integer paise back to a rupee Number. Display/formatting use
// only, per ADR-0003 -- never feed this back into further arithmetic;
// keep summing and comparing in minor units.
function toRupees(minorUnits) {
  assertFiniteNumber(minorUnits, "toRupees");
  return minorUnits / MINOR_UNITS_PER_RUPEE;
}

// Drop-in replacement for the (at least) 13 independent "round to 2
// decimal places" re-implementations DAT-001-T02 found across
// analytics/ and sia/ (two shapes: `Number(value.toFixed(2))` and
// `Math.round(value * 100) / 100`) -- same contract (rupee Number in,
// rounded rupee Number out), but going through the one real rounding
// rule instead of each call site's own float-rounding attempt.
function roundMoney(rupees) {
  return toRupees(toMinorUnits(rupees));
}

// Sums integer paise values exactly -- integer addition has no
// representation error regardless of how many terms, unlike summing the
// equivalent rupee floats (ADR-0003's core rationale). Every element
// must already be integer minor units; this does not accept or convert
// rupees.
function sumMinor(minorUnitsList) {
  if (!Array.isArray(minorUnitsList)) {
    throw new TypeError(`sumMinor: expected an array, got ${JSON.stringify(minorUnitsList)}`);
  }
  return minorUnitsList.reduce((total, value) => {
    assertFiniteNumber(value, "sumMinor");
    return total + value;
  }, 0);
}

// Formats an integer-paise amount for display (₹, en-IN grouping),
// matching the hardcoded ₹/en-IN convention ADR-0003 found already in
// use across the frontend (SpendingForecast.js, AnomalyInsights.js,
// etc). Single-currency scope today, per that ADR.
function formatMoneyMinor(minorUnits, { locale = "en-IN", currency = "INR" } = {}) {
  assertFiniteNumber(minorUnits, "formatMoneyMinor");
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(minorUnits));
}

// Hardens the one entry point DAT-001-T02 flagged as having no visible
// validation boundary: receiptParser.js's parseFloat() on OCR text.
// Parses a raw amount (string or number) into a finite, non-negative
// rupee Number, or returns null for anything that isn't one --
// deliberately fails closed (null, "couldn't extract an amount") rather
// than letting a malformed OCR match through as NaN or a negative
// value, which today's bare parseFloat() does not guard against.
function parseAmountInput(raw) {
  if (typeof raw === "number") {
    return isFiniteNumber(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.replace(/,/g, "").trim();
  // Reject anything that isn't a plain non-negative decimal number
  // outright (e.g. "12.34.56", "12-34", "") instead of letting
  // parseFloat silently parse a prefix of it.
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const value = Number(cleaned);
  return isFiniteNumber(value) ? value : null;
}

module.exports = {
  MINOR_UNITS_PER_RUPEE,
  toMinorUnits,
  toRupees,
  roundMoney,
  sumMinor,
  formatMoneyMinor,
  parseAmountInput,
};
