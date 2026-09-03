import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import api from "../../api/axios";

// Registers this device for native push notifications and wires up the notification-tap handler.
export function useNativePush(isLoggedIn) {

  useEffect(() => {

    if (!isLoggedIn) return;

    if (!Capacitor.isNativePlatform()) return;

    // Tracks the listeners this run registers, so cleanup removes exactly those; isCancelled covers cleanup firing while initPush is still awaiting.
    let isCancelled = false;
    const listenerHandles = [];

    async function initPush() {
      try {

        const permission = await PushNotifications.requestPermissions();
        if (permission.receive !== "granted") return;
        if (isCancelled) return;

        await PushNotifications.register();
        if (isCancelled) return;

        listenerHandles.push(await PushNotifications.addListener("registration", async (token) => {
          try {
            await api.post("/api/device-token", { token: token.value, platform: "mobile" });
          } catch (err) {
            if (err.response?.status === 409) {
            console.warn("Device token already registered to another account; skipping registration.");
              return;
            }
            console.error("Native push registration failed:", err);
          }
        }));

        listenerHandles.push(await PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (notification) => {
            console.log("Notification tapped:", notification);

            const route =
              notification.notification?.data?.route ||
              notification.data?.route ||
              "/";

            // Small delay ensures React is ready to handle the navigation.
            setTimeout(() => {
              window.location.replace(route);
            }, 300);
          }
        ));

        // Cleanup already ran while these listeners were being registered — drop them now so they don't outlive this effect run.
        if (isCancelled) {
          listenerHandles.forEach((handle) => handle.remove());
          listenerHandles.length = 0;
        }

      } catch (err) {
        console.error("Native push error:", err);
      }
    }

    initPush();

    // Removes this run's listeners so a logout/login cycle can't accumulate duplicates; register() is deliberately not undone, since unregister() would delete the device's FCM/APNS token.
    return () => {
      isCancelled = true;
      listenerHandles.forEach((handle) => handle.remove());
      listenerHandles.length = 0;
    };

  }, [isLoggedIn]);
}
