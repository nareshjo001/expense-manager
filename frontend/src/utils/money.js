// DAT-001-T06 -- the frontend half of the minor-units switch.
//
// Until now the frontend had no money formatter at all. Every amount was
// interpolated raw -- `₹{expense.expenseAmount}` -- straight from a
// floating-point field. That is visible to users, not just theoretically
// wrong:
//
//   40 + 0.1 + 0.2  ->  "₹40.30000000000000004"
//   1234.5          ->  "₹1234.5"      (not ₹1,234.50)
//   1234.567        ->  "₹1234.567"    (three decimal places of rupees)
//
// ADR-0003 made integer minor units the authoritative representation, and
// backend/utils/money.js has formatted from them since DAT-001-T03. This is
// the same rule on the client side, so a rupee amount renders identically
// wherever it appears.
//
// PREFERENCE ORDER, and why it is this way round: when the API supplies a
// `*Minor` integer, format from THAT. Minor units are exact -- they cannot
// have accumulated representation error -- whereas the legacy float may
// already be slightly wrong before it reaches us. Falling back to the float
// keeps every existing caller working while the API rollout proceeds, which
// is what makes this switch safe to land in one change.

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

// Rounds a rupee float to integer paise using ADR-0003's rule: half away
// from zero. Native Math.round is NOT symmetric for negative .5 values (it
// rounds toward +Infinity, so Math.round(-4999.5) === -4999, not -5000), so
// the sign is applied separately. The epsilon nudge corrects IEEE-754 error
// that can otherwise land a value just below its true .5 boundary.
const rupeesToMinor = (rupees) => {
  const scaled = rupees * MINOR_UNITS_PER_RUPEE;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) + 1e-9);
};

// The formatter every display site should use.
//
// `minor` wins when present; `rupees` is the legacy fallback. A missing or
// non-numeric amount renders as the placeholder rather than "₹NaN",
// "₹undefined" or "₹null" -- all three of which this app could previously
// display, and all three of which look like a real balance of nothing rather
// than like missing data.
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

// Whole rupees, grouped, no paise -- for prose ("Up by ₹1,240 this month")
// and chart axis ticks, where two decimal places are noise rather than
// precision. Kept HERE rather than redefined per component: SpendingForecast
// and AnomalyInsights each had their own private copy of exactly this, which
// is the duplicated-money-formatting DAT-001 exists to remove, and the audit
// named both files specifically.
//
// Rounds through the same minor-unit path as formatMoney so a value never
// rounds differently depending on which formatter a component happened to
// reach for.
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
