"use strict";

// NOT-003-T02/T03/T04 -- notification preferences: read/write the user's
// saved document, merge it over the type registry's defaults, and resolve
// the single "may this type send right now, and with what content policy"
// decision push.service.js needs before it builds a message (T03) or
// suppresses one for quiet hours (T04).
const NotificationPreference = require("../../models/NotificationPreference");
const {
  NOTIFICATION_TYPE_VALUES,
  PREVIEW_MODES,
  DEFAULT_TYPE_PREFERENCE,
  isKnownType,
  defaultPreferencesByType,
} = require("../../utils/notificationTypes");
const { isWithinQuietHours } = require("../../utils/timeZone");

const DEFAULT_QUIET_HOURS = Object.freeze({
  enabled: false,
  start: "22:00",
  end: "07:00",
  timeZone: null,
});

// Merges a saved document's `types` map over the registry defaults -- a
// type missing from the saved document (never configured, or registered
// after the document was last saved) falls back to
// DEFAULT_TYPE_PREFERENCE, never to `undefined`/disabled-by-omission.
function mergeTypePreferences(savedTypes) {
  const merged = defaultPreferencesByType();
  if (savedTypes && typeof savedTypes === "object") {
    for (const type of NOTIFICATION_TYPE_VALUES) {
      const saved = savedTypes[type];
      if (!saved || typeof saved !== "object") continue;
      merged[type] = {
        enabled: typeof saved.enabled === "boolean" ? saved.enabled : DEFAULT_TYPE_PREFERENCE.enabled,
        preview: PREVIEW_MODES.includes(saved.preview) ? saved.preview : DEFAULT_TYPE_PREFERENCE.preview,
      };
    }
  }
  return merged;
}

function mergeQuietHours(savedQuietHours) {
  if (!savedQuietHours || typeof savedQuietHours !== "object") {
    return { ...DEFAULT_QUIET_HOURS };
  }
  return {
    enabled: typeof savedQuietHours.enabled === "boolean" ? savedQuietHours.enabled : DEFAULT_QUIET_HOURS.enabled,
    start: typeof savedQuietHours.start === "string" ? savedQuietHours.start : DEFAULT_QUIET_HOURS.start,
    end: typeof savedQuietHours.end === "string" ? savedQuietHours.end : DEFAULT_QUIET_HOURS.end,
    timeZone: typeof savedQuietHours.timeZone === "string" && savedQuietHours.timeZone.trim()
      ? savedQuietHours.timeZone
      : DEFAULT_QUIET_HOURS.timeZone,
  };
}

// The full, registry-complete view a settings UI renders: every known type,
// each with a resolved enabled/preview, plus quiet hours -- never a partial
// document a caller would need to know how to fill gaps in.
async function getEffectivePreferences(userId) {
  const doc = await NotificationPreference.findOne({ userId }).lean();
  return {
    types: mergeTypePreferences(doc?.types),
    quietHours: mergeQuietHours(doc?.quietHours),
    updatedAt: doc?.updatedAt ?? null,
  };
}

// Validates a caller-supplied preferences payload (PUT body). Returns
// { ok: true, types, quietHours } with only recognized fields normalized,
// or { ok: false, reason }. Unknown type keys in the payload are silently
// dropped rather than rejected -- a client one release behind a type
// deprecation should not be unable to save its other, still-valid
// preferences over that.
function validatePayload(body) {
  const types = {};
  if (body && body.types !== undefined) {
    if (typeof body.types !== "object" || body.types === null || Array.isArray(body.types)) {
      return { ok: false, reason: "invalid_types" };
    }
    for (const [type, pref] of Object.entries(body.types)) {
      if (!isKnownType(type)) continue; // drop unknown types, don't reject the whole save
      if (!pref || typeof pref !== "object") {
        return { ok: false, reason: "invalid_type_preference", field: type };
      }
      if (pref.enabled !== undefined && typeof pref.enabled !== "boolean") {
        return { ok: false, reason: "invalid_enabled", field: type };
      }
      if (pref.preview !== undefined && !PREVIEW_MODES.includes(pref.preview)) {
        return { ok: false, reason: "invalid_preview", field: type };
      }
      types[type] = {
        enabled: pref.enabled !== undefined ? pref.enabled : DEFAULT_TYPE_PREFERENCE.enabled,
        preview: pref.preview !== undefined ? pref.preview : DEFAULT_TYPE_PREFERENCE.preview,
      };
    }
  }

  let quietHours;
  if (body && body.quietHours !== undefined) {
    const raw = body.quietHours;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, reason: "invalid_quiet_hours" };
    }
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
      return { ok: false, reason: "invalid_quiet_hours_enabled" };
    }
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (raw.start !== undefined && !timePattern.test(raw.start)) {
      return { ok: false, reason: "invalid_quiet_hours_start" };
    }
    if (raw.end !== undefined && !timePattern.test(raw.end)) {
      return { ok: false, reason: "invalid_quiet_hours_end" };
    }
    if (raw.timeZone !== undefined && raw.timeZone !== null) {
      if (typeof raw.timeZone !== "string" || raw.timeZone.trim() === "") {
        return { ok: false, reason: "invalid_quiet_hours_time_zone" };
      }
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: raw.timeZone.trim() });
      } catch {
        return { ok: false, reason: "invalid_quiet_hours_time_zone" };
      }
    }
    quietHours = {
      enabled: raw.enabled !== undefined ? raw.enabled : DEFAULT_QUIET_HOURS.enabled,
      start: raw.start !== undefined ? raw.start : DEFAULT_QUIET_HOURS.start,
      end: raw.end !== undefined ? raw.end : DEFAULT_QUIET_HOURS.end,
      timeZone: raw.timeZone !== undefined ? (raw.timeZone === null ? null : raw.timeZone.trim()) : DEFAULT_QUIET_HOURS.timeZone,
    };
  }

  return { ok: true, types, quietHours };
}

// Upserts the user's preferences document. A partial payload (only `types`,
// or only `quietHours`) patches just that section -- matching
// recurringLifecycleService.editDefinition's "only fields actually present
// are applied" convention -- rather than requiring the client to resend the
// whole document on every save.
//
// No CAS/scheduleVersion here (unlike REC-002's recurring-definition
// mutations): this is a single user's own settings, mutated only from that
// user's own settings screen. There is no second actor (no cron job, no
// other user) that could race a save the way a recurring definition's
// schedule can race a cron run, so last-write-wins is the correct and
// simpler choice, not a shortcut.
async function savePreferences(userId, body) {
  const validation = validatePayload(body);
  if (!validation.ok) return validation;

  const setOps = {};
  if (body.types !== undefined) {
    // Merge onto the EXISTING saved document's types (not the full
    // registry-merged view) so a save that only touches one type does not
    // freeze every other type's default at today's registry, silently
    // opting it out of future default changes.
    const existing = await NotificationPreference.findOne({ userId }).lean();
    setOps.types = { ...(existing?.types || {}), ...validation.types };
  }
  if (body.quietHours !== undefined) {
    setOps.quietHours = validation.quietHours;
  }

  if (Object.keys(setOps).length === 0) {
    return { ok: false, reason: "no_fields_provided" };
  }

  await NotificationPreference.findOneAndUpdate(
    { userId },
    { $set: setOps, $setOnInsert: { userId } },
    { upsert: true, new: true }
  );

  return { ok: true, preferences: await getEffectivePreferences(userId) };
}

// NOT-003-T03/T04 -- the single decision point push.service.js consults
// before building/sending each user's message: is this type enabled, what
// preview policy applies, and are we inside this user's quiet hours right
// now. `type` may be null/unknown (a caller that predates the registry, or
// a raw sendPush() call in a test) -- in that case every gate defaults to
// "send, defer entirely to the device's own preview setting", i.e. exactly
// today's pre-NOT-003 behavior, so nothing that already calls sendPush
// without a type regresses.
async function resolveSendPolicy(userId, type, now = new Date()) {
  if (!isKnownType(type)) {
    return { enabled: true, preview: "device", quiet: false };
  }
  const { types, quietHours } = await getEffectivePreferences(userId);
  const typePref = types[type] || DEFAULT_TYPE_PREFERENCE;
  const quiet = quietHours.enabled && isWithinQuietHours(now, quietHours);
  return { enabled: typePref.enabled, preview: typePref.preview, quiet };
}

module.exports = {
  getEffectivePreferences,
  savePreferences,
  resolveSendPolicy,
  // Exported for direct unit testing (NOT-003-T07) without a DB round trip.
  mergeTypePreferences,
  mergeQuietHours,
  validatePayload,
};
