const { getAdmin, isFirebaseAvailable } = require("../config/firebaseAdmin");
const DeviceToken = require('../models/DeviceToken');

const sendPush = async (userId, title, body, route = '/') => {

    // Fetch all device tokens associated with the user
    const tokens = await DeviceToken.find({ userId });

    // If user has no registered devices, return failure
    if (!tokens.length) return { success: false };

    // Fail closed -- Firebase is optional and may be unconfigured/invalid.
    // Every caller of sendPush (recurringJob.js, retryPush.js,
    // insightsPush.js) already treats {success:false} as an expected,
    // handled outcome (schedule a retry / mark the notification failed),
    // so reusing that exact contract here means none of them need to
    // change to stay crash-safe when Firebase is unavailable.
    if (!isFirebaseAvailable()) {
        return { success: false };
    }

    const admin = getAdmin();
    let success = false;

    const messages = tokens.map(t => {

        const imageUrl = "https://balensia.vercel.app/images/final.jpeg"; 
        // Must be PUBLIC HTTPS URL (NOT localhost)

        if (t.platform === "mobile") {
            return {
                token: t.token,

                // This makes Android auto-display notification
                notification: {
                    title,
                    body,
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
                    tag: "recurring-expense"
                }
            };
        }

        // Web (data-only for service worker)
        return {
            token: t.token,
            data: {
                title,
                body,
                image: imageUrl,
                route,
                tag: "recurring-expense"
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
            // Provider (FCM) error messages are not guaranteed to be
            // secret-safe -- they can echo back the registration token or
            // fragments of the payload being sent. A static, content-free
            // message is logged instead; no error code is retained here,
            // per the security correction that this phase prefers the
            // static message over introducing a code allowlist.
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