import { act, renderHook } from "@testing-library/react";
import { useWebPush } from "./useWebPush";
import api from "../../api/axios";

// FE-003-T05 -- useWebPush.js now loads "../../pushNotification" (and the
// Firebase SDK behind it) via a dynamic import() instead of a static one,
// so it's only pulled in when a push token is actually requested. Jest 27
// hangs indefinitely if a test file BOTH statically imports a named export
// from a jest.mock()'d module AND the code under test dynamically
// import()s that same specifier -- confirmed in isolation, unrelated to
// fake timers or React. The `mock`-prefixed-variable pattern below is
// Jest's own documented way to reference a mock's jest.fn() without a
// static import of the mocked module itself, which sidesteps the hang
// entirely (babel-plugin-jest-hoist allows `mock`-prefixed bindings to be
// referenced inside the hoisted jest.mock() factory below).
const mockRequestPushToken = jest.fn();
jest.mock("../../pushNotification", () => ({ requestPushToken: mockRequestPushToken }));
jest.mock("../../api/axios", () => ({ post: jest.fn() }));
jest.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  mockRequestPushToken.mockResolvedValue("device-token");
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
