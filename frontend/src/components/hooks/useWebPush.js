import { useEffect, useState, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { requestPushToken } from "../../pushNotification";
import api from "../../api/axios";

// Registers this browser for web push and manages the "enable notifications" prompt.
export function useWebPush(isLoggedIn) {

  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  const registerToken = useCallback(async () => {
    try {
      const deviceToken = await requestPushToken();
      if (!deviceToken) return;

      await api.post("/api/device-token", { token: deviceToken, platform: "web" });

    } catch (err) {
      if (err.response?.status === 409) {
        console.warn("Device token already registered to another account; skipping registration.");
        return;
      }
      console.error("Web push registration failed:", err);
    }
  }, []);

  useEffect(() => {

    if (!isLoggedIn) return;
    if (Capacitor.isNativePlatform()) return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      registerToken();
    }

    if (Notification.permission === "default") {
      setTimeout(() => {
        setShowNotificationPrompt(true);
      }, 5000);
    }

  }, [isLoggedIn, registerToken]);

  const handleEnable = async () => {
    setShowNotificationPrompt(false);
    await registerToken();
  };

  const handleLater = () => {
    setShowNotificationPrompt(false);
  };

  return {
    showNotificationPrompt,
    handleEnable,
    handleLater
  };
}
