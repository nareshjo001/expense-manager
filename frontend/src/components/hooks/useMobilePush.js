import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";

export function useNativePush(isLoggedIn) {

  useEffect(() => {

    if (!isLoggedIn) return;

    // Only run in native
    if (!Capacitor.isNativePlatform()) return;

    const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
    if (!BASE_URL) return;

    async function initPush() {
      try {

        const permission = await PushNotifications.requestPermissions();
        if (permission.receive !== "granted") return;

        await PushNotifications.register();

        // Registration listener
        PushNotifications.addListener("registration", async (token) => {

          const authToken = localStorage.getItem("token");
          if (!authToken) return;

          const res = await fetch(`${BASE_URL}/api/device-token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${authToken}`
            },
            body: JSON.stringify({
              token: token.value,
              platform: "mobile"
            })
          });

          // A 409 means this device token is already claimed by another
          // account. Log and stop — this must never trigger a retry loop.
          if (res.status === 409) {
            console.warn("Device token already registered to another account; skipping registration.");
          }
        });

        // Notification click handler
        PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (notification) => {
            console.log("Notification tapped:", notification);

            const route =
              notification.notification?.data?.route ||
              notification.data?.route || // fallback
              "/";

            // Small delay ensures React is ready
            setTimeout(() => {
              window.location.replace(route);
            }, 300);
          }
        );

      } catch (err) {
        console.error("Native push error:", err);
      }
    }

    initPush();

  }, [isLoggedIn]);
}