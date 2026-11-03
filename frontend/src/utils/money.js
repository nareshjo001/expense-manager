// The frontend half of the minor-units switch. Until now the frontend had no money formatter at all.

const MINOR_UNITS_PER_RUPEE = 100;

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Formats an integer-paise amount. Mirrors backend formatMoneyMinor():
// en-IN grouping, always exactly two decimal places.
export const formatMinor = (minorUnits) => {
  if (!isFiniteNumber(minorUnits)) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / MINOR_UNITS_PER_RUPEE);
};

// Rounds a rupee float to integer paise using ADR-0003's rule: half away from zero.
const rupeesToMinor = (rupees) => {
  const scaled = rupees * MINOR_UNITS_PER_RUPEE;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) + 1e-9);
};

// The formatter every display site should use. `minor` wins when present; `rupees` is the legacy fallback.
export const formatMoney = (rupees, minor, { fallback = "—" } = {}) => {
  if (isFiniteNumber(minor)) {
    return formatMinor(minor);
  }
  if (isFiniteNumber(rupees)) {
    return formatMinor(rupeesToMinor(rupees));
  }
  return fallback;
};

// Same value, no currency symbol -- for places that render their own ₹ or
// put the number in a chart axis or aria-label.
export const formatAmount = (rupees, minor, { fallback = "—" } = {}) => {
  const formatted = formatMoney(rupees, minor, { fallback: null });
  if (formatted === null) return fallback;
  return formatted.replace(/^₹\s?/, "");
};

// Whole rupees, grouped, no paise -- for prose ("Up by ₹1,240 this month") and chart axis ticks, where two decimal places are noise rather than precision.
export const formatMoneyApprox = (rupees, minor) => {
  const paise = isFiniteNumber(minor)
    ? minor
    : isFiniteNumber(rupees)
      ? rupeesToMinor(rupees)
      : null;
  if (paise === null) return "₹0";
  return `₹${Math.round(paise / MINOR_UNITS_PER_RUPEE).toLocaleString("en-IN")}`;
};

export default formatMoney;
