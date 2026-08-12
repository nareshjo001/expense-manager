// Category Normalization -- single implementation pass.
//
// Confirmed problem (read-only discovery report, prior turn): there is no
// shared category contract anywhere in the Node codebase. The frontend
// Title-Cases on submit only (no alias table); the backend stores whatever
// string arrives with zero validation (no Mongoose enum); the ONLY real
// canonical taxonomy in the whole repository lives inside
// ml-service/training/category_config.py, entirely isolated from both
// Node apps. That isolation meant "Medical" and "Health" (or "food" and
// "Food") could silently fragment analytics totals, and two hardcoded
// exact-match category comparisons (habitAnalyzer.js's shopping-frequency
// check, habitRules.js's impulse-category list) could silently stop
// matching the moment a stored value's casing drifted from the literal
// string those files hardcode.
//
// This module is the shared backend contract every production write path
// must normalize through, and every category-sensitive READ/aggregation
// path should compare through. It deliberately mirrors (never imports --
// Node cannot import Python) the exact canonical values and aliases
// currently defined in ml-service/training/category_config.py, so a
// category a user types and a category the ML model predicts converge on
// the identical string. It is NOT an allowlist: an unknown, genuinely new
// category is still valid and is preserved (only mechanically cleaned up),
// never rejected and never silently folded into "Others" or any other
// existing bucket. Categories remain fully dynamic -- nothing here assumes
// or hard-codes exactly 15 categories; CANONICAL_CATEGORIES/CATEGORY_ALIASES
// below exist purely as a compatibility/alias table, and their length is
// never read or relied upon anywhere in this module or its callers.
//
// Backend normalization here is authoritative for storage, API-level
// comparison (idempotency replay, ML-correction detection), and analytics
// grouping. Frontend normalization (AddExpense.js's own normalizeCategory)
// remains a separate, best-effort UX/display aid only -- it is never
// trusted as the source of truth, since a client could theoretically send
// an unnormalized value directly to the API.
"use strict";

// Mirrors ml-service/training/category_config.py's CANONICAL_CATEGORIES
// verbatim, for reference/testing only -- no caller in this codebase may
// depend on this list's LENGTH (categories must remain dynamic) or treat
// it as an allowlist (see normalizeCategory's own doc comment below).
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

// Mirrors ml-service/training/category_config.py's CATEGORY_ALIASES
// verbatim (lower-cased key -> canonical Title-Case value). Keeping the
// two lists byte-for-byte in sync is a manual convention (Node cannot
// import a Python module) -- if the ML taxonomy is ever deliberately
// extended, this table should be updated to match in the same change, but
// an out-of-sync alias here is never a correctness failure for THIS
// module: an alias miss simply falls through to the unknown-category
// pass-through path (see normalizeCategory), never an error.
// Security correction (confirmed defect): a plain `{}` object literal
// inherits from Object.prototype, so a bracket lookup keyed on
// attacker/user-controlled input (`CATEGORY_ALIASES[someString]`) can
// resolve an INHERITED property instead of an intentionally-configured
// alias -- e.g. `CATEGORY_ALIASES["__proto__"]` previously returned
// Object.prototype itself, and `CATEGORY_ALIASES["constructor"]` returned
// the `Object` constructor function, both truthy, both silently returned
// AS-IS by normalizeCategory() below in place of a string. `CATEGORY_ALIASES`
// is therefore built as a null-prototype object (`Object.create(null)` as
// the target of `Object.assign`, populated with the exact same literal
// entries as before): a lookup key that is not one of the 23 keys
// explicitly assigned below now simply reads `undefined`, exactly like any
// other genuinely-unknown category, regardless of what Object.prototype
// happens to define. No alias/canonical mapping, casing, or fallback
// behavior changes -- this only removes the prototype the lookup could
// otherwise walk. Object.keys/values/entries (used elsewhere, e.g. this
// module's own tests) are unaffected by a null prototype; they only ever
// consider own enumerable properties.
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

// Explicit fallback for malformed/missing category data encountered at a
// READ boundary (e.g. a legacy document whose expenseCategory is empty,
// null, or otherwise invalid). Deliberately NOT "Others" -- "Others" is a
// real canonical category a user can genuinely choose, and silently
// routing broken data into it would misrepresent that bucket's true total.
// "Uncategorized" is a distinct, explicit signal that the underlying data
// itself was invalid, never a stored write-time value (normalizeCategory
// never returns this -- write-time invalid input is rejected outright, see
// its own doc comment).
const UNCATEGORIZED = "Uncategorized";

// Collapse all internal whitespace runs to a single space and trim both
// ends. Shared by both the alias-lookup path and the unknown-category
// pass-through path, so "  Food   Delivery  " and "Food Delivery" always
// converge on the same cleaned text before either is compared or Title-
// Cased.
function collapseWhitespace(value) {
    return value.trim().replace(/\s+/g, " ");
}

// The same "stable display casing" the frontend's own normalizeCategory
// already applies (AddExpense.js:65-69) -- lowercase the whole cleaned
// value FIRST, then Title-Case each word. Applied here ONLY to the
// unknown-category pass-through path (a known alias already resolves to
// its own canonical, already-Title-Case value from CATEGORY_ALIASES, so
// re-casing it would be redundant, not incorrect, but skipping it keeps
// the canonical value byte-identical to the alias table's own literal).
//
// Casing-correction fix: the previous version Title-Cased only each word's
// LEADING character and left every other character's case untouched
// (`value.replace(/\b\w/g, ...)` with no lowercase pass first). That meant
// two variants of the SAME unknown category that differed only in
// non-leading-character casing -- "PET CARE" vs "Pet Care", or
// "crypto TRADING" vs "Crypto Trading" -- normalized to two DIFFERENT
// strings instead of converging on one, silently fragmenting that
// category across storage, idempotency comparison, analytics grouping, and
// forecasting. Lowercasing first (exactly matching the frontend helper's
// own `.toLowerCase()` step before its Title-Case regex) makes every
// casing variant of an unknown category converge on the identical
// display-cased string, while still leaving KNOWN canonical names/aliases
// untouched (they never reach this function -- see normalizeCategory's
// alias-lookup branch above, which is fully case-insensitive already).
function toTitleCase(value) {
    return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Normalizes a RAW category value for a WRITE boundary (add/edit expense,
// recurring-expense definitions, the cron auto-logger). Returns the
// canonical/cleaned string, or `null` when the input is invalid --
// callers MUST treat `null` as "reject this write", never coerce it to a
// default category themselves (see each controller's own 400 handling).
//
// Behavior (mirrors ml-service/training/category_config.py's
// normalize_category, extended per this phase's own requirements):
//   1. Only a `string` is ever accepted -- any other type is invalid.
//   2/3. Trimmed and internally whitespace-collapsed.
//   4/5. Case-insensitive alias lookup against CATEGORY_ALIASES; a known
//        alias (including every canonical name's own identity mapping)
//        returns the canonical value.
//   6. An unknown but non-empty cleaned value is NOT rejected -- it is
//      lowercased and then Title-Cased (the same stable display casing
//      convention the frontend's own normalizeCategory applies, INCLUDING
//      its lowercase-first step -- see toTitleCase's doc comment above),
//      preserving it as its own new, genuinely distinct category. This is
//      the "aliases are compatibility metadata, not an allowlist"
//      requirement: normalizer output is never gated on membership in
//      CATEGORY_ALIASES. Because casing is fully normalized (not just the
//      leading letter of each word), two unknown-category variants that
//      differ only in non-leading-character casing ("PET CARE" vs
//      "Pet Care") now converge on the identical string.
//   7. Empty, whitespace-only, `null`, `undefined`, and non-string values
//      are all invalid -- returns `null`.
//   8. Idempotent: normalizeCategory(normalizeCategory(x)) ===
//      normalizeCategory(x) for every valid `x`. A canonical alias value
//      re-normalizes to itself (its own lower-cased form is itself a key
//      in CATEGORY_ALIASES, by construction of the identity mappings
//      above); an unknown Title-Cased pass-through value re-normalizes to
//      itself (lowercasing an already-lowercase-then-Title-Cased string's
//      first letters and re-Title-Casing is a no-op on the second pass).
function normalizeCategory(raw) {
    if (typeof raw !== "string") {
        return null;
    }

    const cleaned = collapseWhitespace(raw);
    if (!cleaned) {
        return null;
    }

    // The `typeof aliasMatch === "string"` check is defense-in-depth, not
    // the primary fix (CATEGORY_ALIASES's null prototype above already
    // means an unconfigured key reads `undefined`, never an inherited
    // Object.prototype value) -- it guarantees this function can never
    // return a non-string even if a future edit to the table above ever
    // accidentally assigned a non-string value.
    const aliasMatch = CATEGORY_ALIASES[cleaned.toLowerCase()];
    if (typeof aliasMatch === "string") {
        return aliasMatch;
    }

    // Unknown category -- preserved, never rejected, never folded into an
    // existing bucket. Only mechanically cleaned up for stable display.
    return toTitleCase(cleaned);
}

// Normalizes a value for a READ/aggregation boundary (analytics grouping,
// rule comparisons) where an invalid/missing category must never throw or
// silently drop data -- it must produce the explicit `Uncategorized`
// bucket instead. Every VALID value normalizes identically to
// normalizeCategory() above (write-time and read-time normalization are
// the same function for anything that actually validates); this wrapper
// only adds the graceful fallback for the invalid case.
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
