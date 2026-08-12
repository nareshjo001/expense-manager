"use strict";

// Category Normalization -- single implementation pass, required test
// scenarios #1-6 (direct unit tests of the shared normalizer) plus #13-14
// (read-time grouping helper correctness), per the user's explicit
// instruction: "Add a focused backend/tests/categoryNormalization.test.js
// for direct utility tests."
const {
  CATEGORY_ALIASES,
  UNCATEGORIZED,
  normalizeCategory,
  normalizeCategoryForGrouping,
} = require("../utils/categoryNormalization");

const { groupByCategoryHelper } = require("../Services/HelperServices/getexpense.service");

describe("categoryNormalization: normalizeCategory", () => {
  // Scenario #1: trim / repeated-whitespace normalization
  it("trims leading/trailing whitespace and collapses repeated internal whitespace", () => {
    expect(normalizeCategory("  Food  ")).toBe("Food");
    expect(normalizeCategory("Personal    Care")).toBe("Personal Care");
    expect(normalizeCategory("   Personal   Care   ")).toBe("Personal Care");
  });

  // Scenario #2: case normalization
  it("normalizes case-insensitively for both known and unknown categories", () => {
    expect(normalizeCategory("food")).toBe("Food");
    expect(normalizeCategory("FOOD")).toBe("Food");
    expect(normalizeCategory("FoOd")).toBe("Food");
    expect(normalizeCategory("newsubcategory")).toBe("Newsubcategory");
    expect(normalizeCategory("NEWSUBCATEGORY")).toBe("Newsubcategory");
    // Multi-word unknown category, fully mixed case -- every casing variant
    // must converge on the same string (see the dedicated casing-correction
    // tests below for the full matrix).
    expect(normalizeCategory("nEwSuBcAtEgOrY tWo")).toBe("Newsubcategory Two");
  });

  // Scenario #3: known alias mapping
  it("maps known aliases to their canonical value, mirroring category_config.py", () => {
    expect(normalizeCategory("medical")).toBe("Health");
    expect(normalizeCategory("healthcare")).toBe("Health");
    expect(normalizeCategory("Medical")).toBe("Health");
    expect(normalizeCategory("utility")).toBe("Bills");
    expect(normalizeCategory("utilities")).toBe("Bills");
    expect(normalizeCategory("Utilities")).toBe("Bills");
    expect(normalizeCategory("emi")).toBe("Bills");
    expect(normalizeCategory("income")).toBe("Salary");
    expect(normalizeCategory("other")).toBe("Others");
    expect(normalizeCategory("misc")).toBe("Others");
  });

  // Casing-correction fix: proves known aliases/canonical names are
  // UNAFFECTED by the toTitleCase lowercase-first fix -- they resolve
  // through the case-insensitive alias-table lookup (a separate code path
  // from the unknown-category pass-through toTitleCase() touches) and were
  // already fully case-insensitive before this fix.
  it("known aliases still map exactly as before regardless of arbitrary mixed casing", () => {
    expect(normalizeCategory("HEALTHCARE")).toBe("Health");
    expect(normalizeCategory("hEaLtHcArE")).toBe("Health");
    expect(normalizeCategory("PERSONAL CARE")).toBe("Personal Care");
    expect(normalizeCategory("pErSoNaL cArE")).toBe("Personal Care");
    expect(normalizeCategory("GROCERIES")).toBe("Groceries");
  });

  // Scenario #4: unknown-category pass-through (never rejected, never
  // folded into an existing bucket -- aliases are compatibility metadata,
  // not an allowlist)
  it("passes through unknown, non-empty categories as their own distinct, cleaned value", () => {
    expect(normalizeCategory("Pet Supplies")).toBe("Pet Supplies");
    expect(normalizeCategory("pet supplies")).toBe("Pet Supplies");
    expect(normalizeCategory("  crypto trading  ")).toBe("Crypto Trading");
    // Must not collide with any existing canonical bucket.
    expect(normalizeCategory("Pet Supplies")).not.toBe("Others");
  });

  // Casing-correction fix: unknown-category casing variants that differ in
  // NON-LEADING character casing must converge on the identical string.
  // Confirmed defect (forecast-aggregation verification): the previous
  // implementation Title-Cased only each word's leading letter and left the
  // rest of the string untouched, so "PET CARE" normalized to "PET CARE"
  // (not "Pet Care") and "crypto TRADING" normalized to "Crypto TRADING"
  // (not "Crypto Trading") -- two variants of the SAME category producing
  // two DIFFERENT canonical strings, fragmenting it across storage,
  // idempotency comparison, analytics grouping, and forecasting. The fix
  // lowercases the cleaned value before Title-Casing (matching
  // AddExpense.js's own normalizeCategory exactly), so every casing variant
  // of an unknown category now converges on one deterministic display-cased
  // string.
  it("normalizes unknown-category casing variants (including non-leading-character casing) to the identical string", () => {
    expect(normalizeCategory("PET CARE")).toBe("Pet Care");
    expect(normalizeCategory("pet care")).toBe("Pet Care");
    expect(normalizeCategory("Pet CARE")).toBe("Pet Care");
    expect(normalizeCategory("pET cARE")).toBe("Pet Care");

    expect(normalizeCategory("crypto TRADING")).toBe("Crypto Trading");
    expect(normalizeCategory("CRYPTO TRADING")).toBe("Crypto Trading");
    expect(normalizeCategory("Crypto Trading")).toBe("Crypto Trading");
    expect(normalizeCategory("cRyPtO tRaDiNg")).toBe("Crypto Trading");
  });

  it("collapses repeated internal whitespace for unknown categories with mixed-case input", () => {
    expect(normalizeCategory("PET    CARE")).toBe("Pet Care");
    expect(normalizeCategory("  crypto   TRADING  ")).toBe("Crypto Trading");
  });

  // Scenario #5: invalid input handling
  it("returns null for empty, whitespace-only, null, undefined, and non-string input", () => {
    expect(normalizeCategory("")).toBeNull();
    expect(normalizeCategory("   ")).toBeNull();
    expect(normalizeCategory(null)).toBeNull();
    expect(normalizeCategory(undefined)).toBeNull();
    expect(normalizeCategory(123)).toBeNull();
    expect(normalizeCategory({})).toBeNull();
    expect(normalizeCategory([])).toBeNull();
  });

  // Scenario #6: normalizer idempotence
  it("is idempotent for every valid input, including aliases and unknown categories", () => {
    const samples = [
      "food",
      "  Medical ",
      "UTILITIES",
      "Pet Supplies",
      "personal   care",
      "Others",
      "gifts",
      // Casing-correction fix: mixed-case unknown-category inputs must
      // also be idempotent -- the first pass's lowercased-then-Title-Cased
      // output must be a fixed point of a second pass.
      "PET CARE",
      "crypto TRADING",
      "pET cARE",
    ];
    for (const sample of samples) {
      const once = normalizeCategory(sample);
      const twice = normalizeCategory(once);
      expect(twice).toBe(once);
    }
  });

  it("never exposes or depends on a fixed category count (dynamic categories)", () => {
    // Any never-before-seen category string must still normalize
    // successfully rather than being rejected for not matching a fixed set.
    expect(normalizeCategory("Totally New Category Nobody Configured")).toBe(
      "Totally New Category Nobody Configured"
    );
  });

  it("CATEGORY_ALIASES contains identity mappings for every canonical name it defines", () => {
    // Sanity check underpinning idempotence: each alias value's own
    // lower-cased form must itself be a key in the table.
    const values = new Set(Object.values(CATEGORY_ALIASES));
    for (const value of values) {
      expect(CATEGORY_ALIASES[value.toLowerCase()]).toBe(value);
    }
  });
});

describe("categoryNormalization: normalizeCategoryForGrouping", () => {
  it("returns the same canonical value as normalizeCategory for valid input", () => {
    expect(normalizeCategoryForGrouping("food")).toBe("Food");
    expect(normalizeCategoryForGrouping("Medical")).toBe("Health");
    expect(normalizeCategoryForGrouping("  Pet Supplies ")).toBe("Pet Supplies");
  });

  // Scenario #14 (part 1): invalid legacy data groups as Uncategorized,
  // never silently as "Others". Unaffected by the casing-correction fix --
  // invalid input never reaches toTitleCase() at all (normalizeCategory
  // returns null for it before any casing logic runs).
  it("falls back to the explicit Uncategorized marker for invalid/missing input, never 'Others'", () => {
    expect(normalizeCategoryForGrouping("")).toBe(UNCATEGORIZED);
    expect(normalizeCategoryForGrouping("   ")).toBe(UNCATEGORIZED);
    expect(normalizeCategoryForGrouping(null)).toBe(UNCATEGORIZED);
    expect(normalizeCategoryForGrouping(undefined)).toBe(UNCATEGORIZED);
    expect(normalizeCategoryForGrouping(42)).toBe(UNCATEGORIZED);
    expect(normalizeCategoryForGrouping(UNCATEGORIZED)).not.toBe("Others");
    expect(normalizeCategoryForGrouping("")).not.toBe("Others");
  });
});

describe("categoryNormalization: groupByCategoryHelper (read-time grouping correctness)", () => {
  // Scenario #13: historical variants merge into one analytics/chart bucket
  it("merges case/whitespace/alias variants of the same category into a single bucket", () => {
    const expenses = [
      { id: 1, expenseCategory: "Food", expenseAmount: 100 },
      { id: 2, expenseCategory: "food", expenseAmount: 50 },
      { id: 3, expenseCategory: "FOOD", expenseAmount: 25 },
      { id: 4, expenseCategory: "  Food  ", expenseAmount: 10 },
      { id: 5, expenseCategory: "Medical", expenseAmount: 200 },
      { id: 6, expenseCategory: "Health", expenseAmount: 300 },
      { id: 7, expenseCategory: "healthcare", expenseAmount: 40 },
    ];

    const grouped = groupByCategoryHelper(expenses);

    expect(Object.keys(grouped).sort()).toEqual(["Food", "Health"].sort());
    expect(grouped.Food).toHaveLength(4);
    expect(grouped.Health).toHaveLength(3);
  });

  it("keeps genuinely different unknown categories in separate buckets", () => {
    const expenses = [
      { id: 1, expenseCategory: "Pet Supplies", expenseAmount: 20 },
      { id: 2, expenseCategory: "Crypto Trading", expenseAmount: 30 },
    ];

    const grouped = groupByCategoryHelper(expenses);

    expect(Object.keys(grouped).sort()).toEqual(["Crypto Trading", "Pet Supplies"].sort());
    expect(grouped["Pet Supplies"]).toHaveLength(1);
    expect(grouped["Crypto Trading"]).toHaveLength(1);
  });

  // Casing-correction fix: proves the fix reaches this real read-path
  // consumer, not just the underlying normalizeCategory() unit -- "Pet
  // Care", "PET CARE" and "pet care" must merge into ONE bucket instead of
  // silently fragmenting into three.
  it("merges unknown-category casing variants (including non-leading-character casing) into a single bucket", () => {
    const expenses = [
      { id: 1, expenseCategory: "Pet Care", expenseAmount: 20 },
      { id: 2, expenseCategory: "PET CARE", expenseAmount: 30 },
      { id: 3, expenseCategory: "pet care", expenseAmount: 15 },
      { id: 4, expenseCategory: "Crypto Trading", expenseAmount: 5 },
    ];

    const grouped = groupByCategoryHelper(expenses);

    expect(Object.keys(grouped).sort()).toEqual(["Crypto Trading", "Pet Care"].sort());
    expect(grouped["Pet Care"]).toHaveLength(3);
    expect(grouped["Crypto Trading"]).toHaveLength(1);
  });

  // Scenario #14 (part 2): invalid legacy data groups as Uncategorized in
  // the actual grouping helper, not just the underlying utility.
  it("groups missing/invalid legacy category values under the explicit Uncategorized bucket", () => {
    const expenses = [
      { id: 1, expenseCategory: null, expenseAmount: 15 },
      { id: 2, expenseCategory: "", expenseAmount: 5 },
      { id: 3, expenseAmount: 8 }, // expenseCategory entirely absent
      { id: 4, expenseCategory: "Others", expenseAmount: 100 },
    ];

    const grouped = groupByCategoryHelper(expenses);

    expect(Object.keys(grouped).sort()).toEqual(["Others", "Uncategorized"].sort());
    expect(grouped.Uncategorized).toHaveLength(3);
    expect(grouped.Others).toHaveLength(1);
  });
});

// Security correction: CATEGORY_ALIASES's bracket lookup previously walked
// Object.prototype for any key not explicitly configured -- an
// attacker/user-controlled category string such as "__proto__" or
// "constructor" could resolve an INHERITED property instead of a real
// alias, and normalizeCategory() would return that non-string value as-is.
// Fixed by giving CATEGORY_ALIASES a null prototype (Object.create(null)),
// plus a defensive typeof guard at the lookup site. Expected values below
// are hardcoded literals (never computed by calling normalizeCategory
// itself), per the requirement that this regression suite verify the
// documented fallback contract independently of the implementation under
// test.
describe("categoryNormalization: prototype-pollution / inherited-property safety", () => {
  it("1. __proto__, constructor, and hasOwnProperty each normalize to a deterministic primitive string, never an inherited object/function", () => {
    // "__proto__": collapseWhitespace is a no-op (no whitespace), toLowerCase
    // is a no-op (no letters), and the Title-Case regex's word-boundary match
    // only touches the leading underscore (itself unaffected by
    // toUpperCase()) -- the whole run of underscores/letters is one
    // contiguous \w sequence, so the string passes through unchanged.
    expect(normalizeCategory("__proto__")).toBe("__proto__");
    // "constructor": one contiguous word -- only the leading letter is
    // Title-Cased, exactly like any other unknown single-word category.
    expect(normalizeCategory("constructor")).toBe("Constructor");
    // "hasOwnProperty": lowercased first, then only the leading letter is
    // Title-Cased -- same fallback convention as any other unknown category.
    expect(normalizeCategory("hasOwnProperty")).toBe("Hasownproperty");
  });

  it("2. other Object.prototype-shaped inputs cannot escape as objects/functions -- every result is a plain string", () => {
    const inherited = ["toString", "valueOf", "isPrototypeOf", "propertyIsEnumerable", "__defineGetter__", "toLocaleString"];
    for (const raw of inherited) {
      const result = normalizeCategory(raw);
      expect(typeof result).toBe("string");
      expect(result).not.toBe(Object.prototype[raw]);
    }
  });

  it("3. known aliases and canonical names still resolve to their existing canonical categories, unaffected by the null-prototype fix", () => {
    expect(normalizeCategory("medical")).toBe("Health");
    expect(normalizeCategory("healthcare")).toBe("Health");
    expect(normalizeCategory("Health")).toBe("Health");
    expect(normalizeCategory("utilities")).toBe("Bills");
    expect(normalizeCategory("emi")).toBe("Bills");
    expect(normalizeCategory("income")).toBe("Salary");
    expect(normalizeCategory("personal care")).toBe("Personal Care");
  });

  it("4. unknown ordinary categories retain their previous fallback behaviour", () => {
    expect(normalizeCategory("crypto TRADING")).toBe("Crypto Trading");
    expect(normalizeCategory("PET CARE")).toBe("Pet Care");
    expect(normalizeCategory("newsubcategory")).toBe("Newsubcategory");
  });

  it("5. Object.prototype itself is never mutated by any lookup", () => {
    const before = JSON.stringify(Object.getOwnPropertyNames(Object.prototype));
    normalizeCategory("__proto__");
    normalizeCategory("constructor");
    normalizeCategory("hasOwnProperty");
    normalizeCategory("__defineGetter__");
    const after = JSON.stringify(Object.getOwnPropertyNames(Object.prototype));

    expect(after).toBe(before);
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(({}).constructor).toBe(Object);
  });

  it("6. repeated normalization of prototype-shaped input is deterministic", () => {
    expect(normalizeCategory("__proto__")).toBe(normalizeCategory("__proto__"));
    expect(normalizeCategory("constructor")).toBe(normalizeCategory("constructor"));
    expect(normalizeCategoryForGrouping("__proto__")).toBe(normalizeCategoryForGrouping("__proto__"));
  });

  it("CATEGORY_ALIASES itself has a null prototype and cannot resolve an inherited key", () => {
    expect(Object.getPrototypeOf(CATEGORY_ALIASES)).toBeNull();
    expect(CATEGORY_ALIASES.__proto__).toBeUndefined();
    expect(CATEGORY_ALIASES.constructor).toBeUndefined();
    expect(CATEGORY_ALIASES.hasOwnProperty).toBeUndefined();
    // Own, intentionally-configured entries are still present and correct.
    expect(CATEGORY_ALIASES.food).toBe("Food");
    expect(CATEGORY_ALIASES.medical).toBe("Health");
  });
});
