// Category Normalization -- the shared backend contract every production write path must normalize through, and every category-sensitive read/aggregation path should compare through. Confirmed problem: no shared category contract existed anywhere in Node (frontend Title-Cases on submit only, backend stored whatever arrived with zero validation), while the only real canonical taxonomy lived isolated in ml-service/training/category_config.py -- meaning "Medical"/"Health" or "food"/"Food" could silently fragment analytics totals, and hardcoded exact-match comparisons (habitAnalyzer.js, habitRules.js) could silently stop matching on casing drift. This module deliberately mirrors (never imports -- Node can't import Python) category_config.py's canonical values/aliases so a user-typed category and an ML-predicted one converge on the identical string. NOT an allowlist: an unknown, genuinely new category is preserved (only mechanically cleaned up), never rejected or folded into "Others"; categories remain fully dynamic, and CANONICAL_CATEGORIES/CATEGORY_ALIASES' length is never relied upon. Backend normalization here is authoritative for storage, API-level comparison, and analytics grouping; frontend normalization (AddExpense.js) remains a separate, best-effort UX aid only, never the source of truth.
"use strict";

// Mirrors category_config.py's CANONICAL_CATEGORIES verbatim, for reference/testing only -- no caller may depend on this list's LENGTH (categories remain dynamic) or treat it as an allowlist (see normalizeCategory's doc comment below).
const CANONICAL_CATEGORIES = [
    "Food",
    "Transport",
    "Shopping",
    "Bills",
    "Entertainment",
    "Groceries",
    "Health",
    "Education",
    "Travel",
    "Rent",
    "Investment",
    "Salary",
    "Personal Care",
    "Gifts",
    "Others",
];

// Mirrors category_config.py's CATEGORY_ALIASES verbatim (lower-cased key -> canonical Title-Case value); keeping the two byte-for-byte in sync is a manual convention (Node can't import Python) -- an out-of-sync alias here is never a correctness failure, since a miss simply falls through to the unknown-category pass-through path, never an error.
// Security correction (confirmed defect): a plain `{}` inherits Object.prototype, so a bracket lookup keyed on user-controlled input could resolve an INHERITED property instead of a configured alias (e.g. `CATEGORY_ALIASES["__proto__"]`/`["constructor"]` previously returned truthy prototype values, silently returned as-is in place of a string). Fixed by building CATEGORY_ALIASES as a null-prototype object (`Object.create(null)` as Object.assign's target) -- an unassigned key now simply reads `undefined`, like any other genuinely-unknown category, regardless of Object.prototype. No mapping/casing/fallback behavior changes; Object.keys/values/entries are unaffected since they only consider own enumerable properties.
const CATEGORY_ALIASES = Object.assign(Object.create(null), {
    // canonical categories (identity mappings)
    food: "Food",
    transport: "Transport",
    shopping: "Shopping",
    bills: "Bills",
    entertainment: "Entertainment",
    groceries: "Groceries",
    health: "Health",
    education: "Education",
    travel: "Travel",
    rent: "Rent",
    investment: "Investment",
    salary: "Salary",
    "personal care": "Personal Care",
    gifts: "Gifts",
    others: "Others",

    // aliases / kaggle labels
    healthcare: "Health",
    medical: "Health",

    utilities: "Bills",
    utility: "Bills",

    other: "Others",
    misc: "Others",

    emi: "Bills",

    income: "Salary",
});

// Explicit fallback for malformed/missing category data at a READ boundary (e.g. a legacy document with empty/null/invalid expenseCategory). Deliberately NOT "Others" -- that's a real canonical category, and silently routing broken data into it would misrepresent its true total. "Uncategorized" is a distinct signal the underlying data was invalid, never a stored write-time value (normalizeCategory never returns this -- invalid write-time input is rejected outright).
const UNCATEGORIZED = "Uncategorized";

// Collapse all internal whitespace runs to a single space and trim both ends -- shared by both the alias-lookup and unknown-category pass-through paths, so "  Food   Delivery  " and "Food Delivery" always converge before either is compared or Title-Cased.
function collapseWhitespace(value) {
    return value.trim().replace(/\s+/g, " ");
}

// The same "stable display casing" the frontend's normalizeCategory already applies -- lowercase the whole cleaned value FIRST, then Title-Case each word. Applied ONLY to the unknown-category pass-through path (a known alias already resolves to its own canonical Title-Case value, so re-casing would be redundant -- skipping it keeps the canonical value byte-identical to the alias table's literal).
// Casing-correction fix: the previous version Title-Cased only each word's leading character, leaving the rest untouched -- so "PET CARE" vs "Pet Care" normalized to two DIFFERENT strings instead of one, silently fragmenting that category across storage/idempotency/analytics/forecasting. Lowercasing first (matching the frontend helper's own step) makes every casing variant of an unknown category converge on one string, while known canonical names/aliases stay untouched (they never reach this function -- normalizeCategory's alias-lookup is already fully case-insensitive).
function toTitleCase(value) {
    return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Normalizes a RAW category value for a WRITE boundary (add/edit expense, recurring-expense definitions, the cron auto-logger). Returns the canonical/cleaned string, or `null` when invalid -- callers MUST treat `null` as "reject this write", never coerce it to a default category themselves.
//
// Behavior (mirrors category_config.py's normalize_category, extended per this module's requirements): only a `string` is accepted; trimmed and whitespace-collapsed; case-insensitive alias lookup against CATEGORY_ALIASES returns the canonical value for a known alias (including every canonical name's own identity mapping); an unknown but non-empty cleaned value is NOT rejected -- lowercased then Title-Cased (same convention as toTitleCase above) and preserved as its own genuinely distinct category, since aliases are compatibility metadata, not an allowlist (full casing normalization means "PET CARE" vs "Pet Care" now converge); empty/whitespace-only/null/undefined/non-string values are all invalid, returning null; idempotent -- normalizeCategory(normalizeCategory(x)) === normalizeCategory(x) for every valid x (a canonical alias re-normalizes to itself by construction; an unknown Title-Cased pass-through value is a no-op on the second pass).
function normalizeCategory(raw) {
    if (typeof raw !== "string") {
        return null;
    }

    const cleaned = collapseWhitespace(raw);
    if (!cleaned) {
        return null;
    }

    // The `typeof aliasMatch === "string"` check is defense-in-depth, not the primary fix (the null-prototype table already means an unconfigured key reads `undefined`) -- it guarantees this function can never return a non-string even if a future edit to the table above accidentally assigns one.
    const aliasMatch = CATEGORY_ALIASES[cleaned.toLowerCase()];
    if (typeof aliasMatch === "string") {
        return aliasMatch;
    }

    // Unknown category -- preserved, never rejected, never folded into an existing bucket. Only mechanically cleaned up for stable display.
    return toTitleCase(cleaned);
}

// Normalizes a value for a READ/aggregation boundary (analytics grouping, rule comparisons) where an invalid/missing category must never throw or silently drop data -- produces the explicit `Uncategorized` bucket instead. Every VALID value normalizes identically to normalizeCategory() above; this wrapper only adds the graceful fallback for the invalid case.
function normalizeCategoryForGrouping(raw) {
    const normalized = normalizeCategory(raw);
    return normalized === null ? UNCATEGORIZED : normalized;
}

module.exports = {
    CANONICAL_CATEGORIES,
    CATEGORY_ALIASES,
    UNCATEGORIZED,
    normalizeCategory,
    normalizeCategoryForGrouping,
};
