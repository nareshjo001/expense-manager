import { getToken } from "firebase/messaging";
import { messaging } from "./firebase";
import { Capacitor } from "@capacitor/core";

export async function requestPushToken() {
  try {
    // Do not run inside native app
    if (Capacitor.isNativePlatform()) return null;

    // Ensure browser supports notifications
    if (!("Notification" in window)) return null;

    const permission = await Notification.requestPermission();

    if (permission !== "granted") return null;

    const token = await getToken(messaging, {
      vapidKey: process.env.REACT_APP_WEB_VAPID_KEY
    });

    return token || null;

  } catch (error) {
    console.error("Web push token error:", error);
    return null;
  }
}