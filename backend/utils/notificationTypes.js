"use strict";

// NOT-003-T01 -- the notification type registry. Every notification this
// backend can ever create is listed here, once. models/Notification.js's
// `type` field is deliberately left as an unconstrained string (see its own
// inline comment) so a brand-new type can ship without a migration -- but
// every REAL call site should go through NOTIFICATION_TYPES rather than
// inventing its own literal, so the preference system (T02-T04) always
// knows about every type that actually exists.
//
// Confirmed by direct grep across Controllers/Services/cron/Middlewares/
// models/utils (not assumed): exactly two Notification.create() call sites
// exist in this codebase today, both in cron/recurringJob.js:
//   "recurring-expense"       -- an occurrence of a recurring expense was
//                                 logged (REC-001).
//   "recurring-expense-ended" -- a recurring definition auto-ended because
//                                 its endDate was reached (REC-002-T03).
// Notification.js's inline comment additionally mentioned "system" as an
// example -- that was aspirational, not a real call site, so it is not
// registered here. A future feature that creates a genuinely new
// notification type registers it here first (this is the ONE place a new
// type needs to be added for the preference system below to know it
// exists) and only then starts calling Notification.create with it.
//
// BUD-001-T06 added a third call site:
//   "category-budget-alert"   -- spending in a category crossed its
//                                 Critical (> 90%) or Overspent (> 100%)
//                                 threshold (Services/BudgetServices/
//                                 categoryBudgetAlert.service.js).
const NOTIFICATION_TYPES = Object.freeze({
  RECURRING_EXPENSE: "recurring-expense",
  RECURRING_EXPENSE_ENDED: "recurring-expense-ended",
  CATEGORY_BUDGET_ALERT: "category-budget-alert",
});

const NOTIFICATION_TYPE_VALUES = Object.freeze(Object.values(NOTIFICATION_TYPES));

// Label/description per type, for the settings UI (NOT-003-T05) -- kept
// here rather than hardcoded in the frontend so a newly registered type
// only needs describing once, in the one place that already knows it
// exists.
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

// Default preference for a type the user has never explicitly configured --
// applied both for a user with no saved NotificationPreference document at
// all, and per-type as the fallback for any type missing from a document
// that predates that type's registration.
//
// preview: "device" -- NOT "generic" or "detailed" -- is the deliberate
// backward-compatible default: today, preview is decided entirely by the
// SENDING DEVICE's own DeviceToken.notificationPreview (see
// push.service.js). "device" means "keep deferring to that", so a user who
// never opens the new preferences screen sees byte-identical push content
// to what they received before this feature existed. Only an explicit
// per-type override ("generic" | "detailed") changes that.
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
