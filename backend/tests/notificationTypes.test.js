// NOT-003-T01/T07 -- utils/notificationTypes.js, the type registry.
"use strict";

const {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_VALUES,
  NOTIFICATION_TYPE_META,
  DEFAULT_TYPE_PREFERENCE,
  PREVIEW_MODES,
  isKnownType,
  defaultPreferencesByType,
} = require("../utils/notificationTypes");

describe("notification type registry", () => {
  test("registers exactly the real call sites (cron/recurringJob.js and the BUD-001 category budget alert service)", () => {
    expect([...NOTIFICATION_TYPE_VALUES].sort()).toEqual(
      ["recurring-expense", "recurring-expense-ended", "category-budget-alert"].sort()
    );
  });

  test("BUD-001-T06 registers the category budget alert type with its settings copy", () => {
    expect(NOTIFICATION_TYPES.CATEGORY_BUDGET_ALERT).toBe("category-budget-alert");
    expect(NOTIFICATION_TYPE_META["category-budget-alert"]).toEqual({
      label: "Category budget alerts",
      description: "When spending in a category reaches 90% of its budget or goes over it.",
    });
    expect(DEFAULT_TYPE_PREFERENCE).toEqual({ enabled: true, preview: "device" });
    expect(defaultPreferencesByType()["category-budget-alert"]).toEqual(DEFAULT_TYPE_PREFERENCE);
  });

  test("every registered type has label/description metadata", () => {
    for (const type of NOTIFICATION_TYPE_VALUES) {
      expect(NOTIFICATION_TYPE_META[type]).toBeDefined();
      expect(typeof NOTIFICATION_TYPE_META[type].label).toBe("string");
      expect(NOTIFICATION_TYPE_META[type].label.length).toBeGreaterThan(0);
    }
  });

  test("isKnownType is true only for registered types", () => {
    expect(isKnownType(NOTIFICATION_TYPES.RECURRING_EXPENSE)).toBe(true);
    expect(isKnownType(NOTIFICATION_TYPES.RECURRING_EXPENSE_ENDED)).toBe(true);
    expect(isKnownType(NOTIFICATION_TYPES.CATEGORY_BUDGET_ALERT)).toBe(true);
    expect(isKnownType("something-unregistered")).toBe(false);
    expect(isKnownType(null)).toBe(false);
    expect(isKnownType(undefined)).toBe(false);
    expect(isKnownType(123)).toBe(false);
  });

  test("default preference is enabled with device-deferred preview, matching today's real behavior", () => {
    expect(DEFAULT_TYPE_PREFERENCE).toEqual({ enabled: true, preview: "device" });
    expect(PREVIEW_MODES).toContain("device");
  });

  test("defaultPreferencesByType covers every registered type with the default", () => {
    const defaults = defaultPreferencesByType();
    expect(Object.keys(defaults).sort()).toEqual([...NOTIFICATION_TYPE_VALUES].sort());
    for (const type of NOTIFICATION_TYPE_VALUES) {
      expect(defaults[type]).toEqual(DEFAULT_TYPE_PREFERENCE);
    }
  });

  test("defaultPreferencesByType returns a fresh object each call (no shared mutation)", () => {
    const a = defaultPreferencesByType();
    const b = defaultPreferencesByType();
    a[NOTIFICATION_TYPES.RECURRING_EXPENSE].enabled = false;
    expect(b[NOTIFICATION_TYPES.RECURRING_EXPENSE].enabled).toBe(true);
  });

  test("registries are frozen", () => {
    expect(Object.isFrozen(NOTIFICATION_TYPES)).toBe(true);
    expect(Object.isFrozen(NOTIFICATION_TYPE_VALUES)).toBe(true);
    expect(Object.isFrozen(NOTIFICATION_TYPE_META)).toBe(true);
    expect(Object.isFrozen(DEFAULT_TYPE_PREFERENCE)).toBe(true);
    expect(Object.isFrozen(PREVIEW_MODES)).toBe(true);
  });
});
