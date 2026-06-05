import { useEffect, useState, useCallback } from "react";
import { Capacitor } from "@capacitor/core";
import { requestPushToken } from "../../pushNotification";

export function useWebPush(isLoggedIn) {

  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);

  const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
  const authToken = localStorage.getItem("token");

  const registerToken = useCallback(async () => {
    try {
      if (!BASE_URL || !authToken) return;

      const deviceToken = await requestPushToken();
      if (!deviceToken) return;

      const res = await fetch(`${BASE_URL}/auth/device-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`
        },
        body: JSON.stringify({
          token: deviceToken,
          platform: "web"
        })
      });

      console.log("Backend response:", res.status);

    } catch (err) {
      console.error("Web push registration failed:", err);
    }
  }, [BASE_URL, authToken]);

  useEffect(() => {

    if (!isLoggedIn) return;
    if (Capacitor.isNativePlatform()) return;
    if (!("Notification" in window)) return;
    if (!BASE_URL || !authToken) return;

    if (Notification.permission === "granted") {
      registerToken();
    }

    if (Notification.permission === "default") {
      setTimeout(() => {
        setShowNotificationPrompt(true);
      }, 5000);
    }

  }, [isLoggedIn, BASE_URL, authToken, registerToken]);

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