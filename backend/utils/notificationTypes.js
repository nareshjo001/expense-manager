"use strict";

// The notification type registry. Every notification this backend can ever create is listed here, once.
const NOTIFICATION_TYPES = Object.freeze({
  RECURRING_EXPENSE: "recurring-expense",
  RECURRING_EXPENSE_ENDED: "recurring-expense-ended",
  CATEGORY_BUDGET_ALERT: "category-budget-alert",
});

const NOTIFICATION_TYPE_VALUES = Object.freeze(Object.values(NOTIFICATION_TYPES));

// Label/description per type, for the settings UI (NOT-003-T05) -- kept here rather than hardcoded in the frontend so a newly registered type only needs describing once, in the one place that already knows it exists.
const NOTIFICATION_TYPE_META = Object.freeze({
  [NOTIFICATION_TYPES.RECURRING_EXPENSE]: Object.freeze({
    label: "Recurring expense logged",
    description: "When a recurring expense is automatically added for you.",
  }),
  [NOTIFICATION_TYPES.RECURRING_EXPENSE_ENDED]: Object.freeze({
    label: "Recurring expense ended",
    description: "When a recurring expense reaches its end date and stops.",
  }),
  [NOTIFICATION_TYPES.CATEGORY_BUDGET_ALERT]: Object.freeze({
    label: "Category budget alerts",
    description: "When spending in a category reaches 90% of its budget or goes over it.",
  }),
});

// Default preference for a type the user has never explicitly configured -- applied both for a user with no saved NotificationPreference document at all, and per-type as the fallback for any type missing from a document that predates that type's registration.
const DEFAULT_TYPE_PREFERENCE = Object.freeze({ enabled: true, preview: "device" });

const PREVIEW_MODES = Object.freeze(["device", "generic", "detailed"]);

function isKnownType(type) {
  return typeof type === "string" && NOTIFICATION_TYPE_VALUES.includes(type);
}

// A fresh { [type]: {enabled, preview} } map covering every registered
// type, for a user who has never saved a preferences document.
function defaultPreferencesByType() {
  const defaults = {};
  for (const type of NOTIFICATION_TYPE_VALUES) {
    defaults[type] = { ...DEFAULT_TYPE_PREFERENCE };
  }
  return defaults;
}

module.exports = {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_VALUES,
  NOTIFICATION_TYPE_META,
  DEFAULT_TYPE_PREFERENCE,
  PREVIEW_MODES,
  isKnownType,
  defaultPreferencesByType,
};
