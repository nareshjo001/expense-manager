import { getToken } from "firebase/messaging";
import { messaging } from "./firebase";
import { Capacitor } from "@capacitor/core";

// Requests a web push (FCM) token; native apps use useMobilePush instead, so this bails out on native platforms.
export async function requestPushToken() {
  try {
    if (Capacitor.isNativePlatform()) return null;

    if (!("Notification" in window)) return null;

    const permission = await Notification.requestPermission();

    if (permission !== "granted") return null;

    const token = await getToken(messaging, {
      vapidKey: process.env.REACT_APP_WEB_VAPID_KEY
    });

    return token || null;

  } catch {
    console.error("Web push token request failed.");
    return null;
  }
}
