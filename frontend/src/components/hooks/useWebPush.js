import { useEffect, useState, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { requestPushToken } from "../../pushNotification";
import api from "../../api/axios";

const PRIVACY_CHOICE_KEY = "balensia_notification_preview_configured";

// Registers this browser for web push and manages the "enable notifications" prompt.
export function useWebPush(isLoggedIn) {

  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [showDetailedPreviews, setShowDetailedPreviews] = useState(false);

  const registerToken = useCallback(async (notificationPreview) => {
    try {
      const deviceToken = await requestPushToken();
      if (!deviceToken) return;

      const registration = { token: deviceToken, platform: "web" };
      if (notificationPreview) registration.notificationPreview = notificationPreview;
      await api.post("/api/device-token", registration);
      return true;

    } catch (err) {
      if (err.response?.status === 409) {
        console.warn("Device token already registered to another account; skipping registration.");
        return false;
      }
      console.error("Web push registration failed.");
      return false;
    }
  }, []);

  useEffect(() => {

    if (!isLoggedIn) return;
    if (Capacitor.isNativePlatform()) return;
    if (!("Notification" in window)) return;
    let promptTimer;
    if (Notification.permission === "granted") {
      registerToken();
      if (localStorage.getItem(PRIVACY_CHOICE_KEY) !== "true") {
        promptTimer = setTimeout(() => setShowNotificationPrompt(true), 5000);
      }
    }

    if (Notification.permission === "default") {
      promptTimer = setTimeout(() => setShowNotificationPrompt(true), 5000);
    }

    return () => clearTimeout(promptTimer);

  }, [isLoggedIn, registerToken]);

  const handleEnable = async () => {
    setShowNotificationPrompt(false);
    const registered = await registerToken(showDetailedPreviews ? "detailed" : "generic");
    if (registered) localStorage.setItem(PRIVACY_CHOICE_KEY, "true");
  };

  const handleLater = () => {
    setShowNotificationPrompt(false);
  };

  return {
    showNotificationPrompt,
    showDetailedPreviews,
    setShowDetailedPreviews,
    handleEnable,
    handleLater
  };
}
