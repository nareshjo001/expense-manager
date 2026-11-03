"use strict";

// Central money parsing/formatting helpers.

const MINOR_UNITS_PER_RUPEE = 100;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function assertFiniteNumber(value, fnName) {
  if (!isFiniteNumber(value)) {
    throw new TypeError(`${fnName}: expected a finite number, got ${JSON.stringify(value)}`);
  }
}

// 995 -> -5000). g. g.
function toMinorUnits(rupees) {
  assertFiniteNumber(rupees, "toMinorUnits");
  const scaled = rupees * MINOR_UNITS_PER_RUPEE;
  const sign = scaled < 0 ? -1 : 1;
  const nudged = Math.abs(scaled) + 1e-9;
  return sign * Math.round(nudged);
}

// Converts integer paise back to a rupee Number.
function toRupees(minorUnits) {
  assertFiniteNumber(minorUnits, "toRupees");
  return minorUnits / MINOR_UNITS_PER_RUPEE;
}

// Round(value * 100) / 100`) -- same contract (rupee Number in, rounded rupee Number out), but going through the one real rounding rule instead of each call site's own float-rounding attempt.
function roundMoney(rupees) {
  return toRupees(toMinorUnits(rupees));
}

// Sums integer paise values exactly -- integer addition has no representation error regardless of how many terms, unlike summing the equivalent rupee floats (ADR-0003's core rationale).
function sumMinor(minorUnitsList) {
  if (!Array.isArray(minorUnitsList)) {
    throw new TypeError(`sumMinor: expected an array, got ${JSON.stringify(minorUnitsList)}`);
  }
  return minorUnitsList.reduce((total, value) => {
    assertFiniteNumber(value, "sumMinor");
    return total + value;
  }, 0);
}

// Js, etc). Single-currency scope today, per that ADR.
function formatMoneyMinor(minorUnits, { locale = "en-IN", currency = "INR" } = {}) {
  assertFiniteNumber(minorUnits, "formatMoneyMinor");
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(minorUnits));
}

// Js's parseFloat() on OCR text.
function parseAmountInput(raw) {
  if (typeof raw === "number") {
    return isFiniteNumber(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.replace(/,/g, "").trim();
  // G. 56", "12-34", "") instead of letting parseFloat silently parse a prefix of it.
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
