const { getAdmin, isFirebaseAvailable } = require("../config/firebaseAdmin");
const DeviceToken = require('../models/DeviceToken');
// NOT-003-T03/T04 -- the single gate consulted before a message is built:
// is this type enabled for this user, what preview policy applies, and are
// we inside this user's quiet hours right now.
const { resolveSendPolicy } = require('./NotificationServices/notificationPreferenceService');

const GENERIC_NOTIFICATION = Object.freeze({
    title: "Expense Manager",
    body: "A recurring expense was added."
});

// BUD-001-T06 -- the generic (no-detail) preview text is chosen per type.
// Before this, every generic-preview push said "A recurring expense was
// added." whatever its type, so a category budget alert on a device using
// the default "generic" preview would have been shown as a recurring
// expense. Types without an entry here keep GENERIC_NOTIFICATION's text,
// byte-identical to before.
const GENERIC_BODY_BY_TYPE = Object.freeze({
    "category-budget-alert": "You have a new budget alert.",
});

function genericContentFor(type) {
    const body = type && GENERIC_BODY_BY_TYPE[type];
    return body ? { title: GENERIC_NOTIFICATION.title, body } : GENERIC_NOTIFICATION;
}

// `options.type` is the notification's registered type (utils/
// notificationTypes.js) -- optional, so every pre-NOT-003 call site and
// every existing test keeps working exactly as before: resolveSendPolicy()
// treats a missing/unknown type as "send, defer entirely to the device's
// own preview setting", which is byte-identical to this function's
// pre-NOT-003 behavior.
const sendPush = async (userId, title, body, options = {}) => {
    const { route = '/', type = null } = options;

    // NOT-003-T03/T04 -- preference/quiet-hours gate, BEFORE anything else
    // (before even checking for registered devices) -- a disabled type or
    // an active quiet-hours window means "do not send", regardless of how
    // many devices are registered.
    const policy = await resolveSendPolicy(userId, type);
    if (!policy.enabled) {
        return { success: false, suppressed: true, reason: "type_disabled" };
    }
    if (policy.quiet) {
        return { success: false, suppressed: true, reason: "quiet_hours" };
    }

    // Fetch all device tokens associated with the user
    const tokens = await DeviceToken.find({ userId });

    // If user has no registered devices, return failure
    if (!tokens.length) return { success: false };

    // Fail closed -- Firebase is optional and may be unconfigured/invalid.
    if (!isFirebaseAvailable()) {
        return { success: false };
    }

    const admin = getAdmin();
    let success = false;

    const messages = tokens.map(t => {

        const imageUrl = "https://balensia.vercel.app/images/final.jpeg";
        // NOT-003-T03 -- preview policy resolution: a user-level per-type
        // override (policy.preview === "generic"/"detailed") takes
        // precedence over the device's own DeviceToken.notificationPreview;
        // "device" (the default for every type until a user explicitly
        // overrides it -- see DEFAULT_TYPE_PREFERENCE's own comment) defers
        // to the device exactly as this function always has, so a user who
        // never opens the new preferences screen sees unchanged behavior.
        const effectivePreview = policy.preview === "device" ? t.notificationPreview : policy.preview;
        const content = effectivePreview === "detailed"
            ? { title, body }
            : genericContentFor(type);

        // NOT-003-T01 -- the payload's `tag` now reflects the notification's
        // actual registered type when one was supplied (lets a client group/
        // route notifications by real type instead of every push sharing the
        // single literal "recurring-expense" tag regardless of what it was).
        // Falls back to that same literal for an untyped call, so an
        // existing/mocked client that matches on it is unaffected.
        const tag = type || "recurring-expense";

        if (t.platform === "mobile") {
            return {
                token: t.token,

                // This makes Android auto-display notification
                notification: {
                    title: content.title,
                    body: content.body,
                    image: imageUrl
                },

                // Android-specific configuration
                android: {
                    notification: {
                        image: imageUrl,
                        channelId: "default",
                        priority: "high"
                    }
                },

                // Extra data for routing
                data: {
                    route,
                    tag
                }
            };
        }

        // Web (data-only for service worker)
        return {
            token: t.token,
            data: {
                title: content.title,
                body: content.body,
                image: imageUrl,
                route,
                tag
            }
        };
    });

    // Send notification individually to each device
    for(const msg of messages) {
        try {
            // Send message via Firebase Admin SDK
            await admin.messaging().send(msg);
            success = true;
        
        } catch(err) {
            // Sanitized: never log err.message or the raw Error object.
            console.log("Push Error: FCM send failed.");

            // If token is invalid or expired, remove it from database
            if (
                err.code === "messaging/registration-token-not-registered" ||
                err.code === "messaging/invalid-registration-token"
            ) {
                await DeviceToken.deleteOne({ token: msg.token });
            }
        }
    }
    // Return overall success status
    return { success };
} 

module.exports = { sendPush };
