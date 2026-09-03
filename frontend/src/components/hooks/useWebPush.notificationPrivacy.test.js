import { act, renderHook } from "@testing-library/react";
import { useWebPush } from "./useWebPush";
import { requestPushToken } from "../../pushNotification";
import api from "../../api/axios";

jest.mock("../../pushNotification", () => ({ requestPushToken: jest.fn() }));
jest.mock("../../api/axios", () => ({ post: jest.fn() }));
jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  requestPushToken.mockResolvedValue("device-token");
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  jest.useRealTimers();
  localStorage.clear();
  jest.clearAllMocks();
});

describe("web notification preview privacy", () => {
  it("registers generic previews when the user leaves detailed previews off", async () => {
    const { result } = renderHook(() => useWebPush(false));

    await act(async () => result.current.handleEnable());

    expect(api.post).toHaveBeenCalledWith("/api/device-token", {
      token: "device-token",
      platform: "web",
      notificationPreview: "generic",
    });
    expect(localStorage.getItem("balensia_notification_preview_configured")).toBe("true");
  });

  it("registers detailed previews only after the user explicitly opts in", async () => {
    const { result } = renderHook(() => useWebPush(false));

    act(() => result.current.setShowDetailedPreviews(true));
    await act(async () => result.current.handleEnable());

    expect(api.post).toHaveBeenCalledWith("/api/device-token", {
      token: "device-token",
      platform: "web",
      notificationPreview: "detailed",
    });
  });

  it("offers the privacy choice once to devices that already granted notifications", () => {
    const originalNotification = window.Notification;
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted" },
    });

    const { result, unmount } = renderHook(() => useWebPush(true));
    act(() => jest.advanceTimersByTime(5000));

    expect(result.current.showNotificationPrompt).toBe(true);
    unmount();
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: originalNotification,
    });
  });
});
