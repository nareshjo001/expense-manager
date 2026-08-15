// BALENISA Firebase Startup Resilience -- push.service.js contract.
//
// sendPush() is the ONLY production caller of firebaseAdmin.js's exports
// (confirmed by an exhaustive grep of backend/ -- app.js's /ping capability
// check is the only other caller, and it only calls isFirebaseAvailable()).
// sendPush() is itself called only by cron jobs (recurringJob.js,
// retryPush.js, insightsPush.js), never by an HTTP request handler -- there
// is no client-facing "bill-upload" or other route in this codebase that
// depends on Firebase (confirmed by grepping Controllers/BillControllers
// and Services/BillServices for any Firebase reference: none exist; bill
// upload is local filesystem + OCR only). This suite proves sendPush()
// fails closed (returns {success:false}, never throws) when Firebase is
// unavailable, reusing the exact {success:boolean} contract every caller
// already handles (schedule a retry / mark failed) -- so none of the cron
// files need to change.
//
// Mocks only ../config/firebaseAdmin and ../models/DeviceToken -- never
// touches a real Firebase project, network, or MongoDB.
"use strict";

const FIREBASE_ADMIN_PATH = "../config/firebaseAdmin";
const DEVICE_TOKEN_PATH = "../models/DeviceToken";
const PUSH_SERVICE_PATH = "../Services/push.service";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadPushService({ tokens, firebaseAvailable, sendImpl }) {
  jest.resetModules();

  const deleteOneMock = jest.fn(async () => {});
  jest.doMock(DEVICE_TOKEN_PATH, () => ({
    find: jest.fn(async () => tokens),
    deleteOne: deleteOneMock,
  }));

  const sendMock = jest.fn(sendImpl || (async () => "message-id"));
  const getAdminMock = jest.fn(() => ({ messaging: () => ({ send: sendMock }) }));
  const isFirebaseAvailableMock = jest.fn(() => firebaseAvailable);

  jest.doMock(FIREBASE_ADMIN_PATH, () => ({
    getAdmin: getAdminMock,
    isFirebaseAvailable: isFirebaseAvailableMock,
    FirebaseUnavailableError: class FirebaseUnavailableError extends Error {},
  }));

  const { sendPush } = require(PUSH_SERVICE_PATH);
  return { sendPush, sendMock, getAdminMock, isFirebaseAvailableMock, deleteOneMock };
}

describe("push.service.sendPush -- Firebase availability", () => {
  it("returns {success:false} without throwing when Firebase is unavailable, and never calls getAdmin()", async () => {
    const { sendPush, getAdminMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: false,
    });

    const result = await sendPush("user-1", "Title", "Body");

    expect(result).toEqual({ success: false });
    expect(getAdminMock).not.toHaveBeenCalled();
  });

  it("returns {success:false} immediately when the user has no registered devices, without even checking Firebase availability (existing behavior unchanged)", async () => {
    const { sendPush, isFirebaseAvailableMock } = loadPushService({
      tokens: [],
      firebaseAvailable: true,
    });

    const result = await sendPush("user-1", "Title", "Body");

    expect(result).toEqual({ success: false });
    expect(isFirebaseAvailableMock).not.toHaveBeenCalled();
  });

  it("valid mocked Firebase dependency: successful send behavior is unchanged -- returns {success:true}", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: true,
    });

    const result = await sendPush("user-1", "Title", "Body");

    expect(result).toEqual({ success: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("sends one message per registered device token when Firebase is available (unchanged fan-out behavior)", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [
        { token: "t1", platform: "web" },
        { token: "t2", platform: "mobile" },
      ],
      firebaseAvailable: true,
    });

    await sendPush("user-1", "Title", "Body");

    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("an individual send failure is caught, does not crash, and still returns the {success:false} contract", async () => {
    const err = new Error("generic send failure");

    const { sendPush } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: true,
      sendImpl: async () => {
        throw err;
      },
    });

    const result = await sendPush("user-1", "Title", "Body");

    expect(result).toEqual({ success: false });
  });
});

// Security correction: err.message and the raw Error object must never be
// logged for an FCM send failure -- provider error messages are not
// guaranteed to be secret-safe and can echo back the registration token or
// fragments of the notification payload. push.service.js now logs a single
// static, content-free message instead. These tests use an adversarial
// error whose .message embeds sentinel values standing in for a private-key
// fragment, an FCM registration token, and a payload value, and prove none
// of those sentinels -- nor the raw Error object, nor err.message itself --
// ever reaches console.log/console.error/console.warn in any form,
// including after JSON serialization.
describe("push.service.sendPush -- FCM send-failure logging is fully sanitized", () => {
  const SENTINEL_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----SENTINEL_KEY_MATERIAL-----END PRIVATE KEY-----";
  const SENTINEL_TOKEN = "SENTINEL_FCM_REGISTRATION_TOKEN_abc123";
  const SENTINEL_PAYLOAD = "SENTINEL_PAYLOAD_VALUE_xyz789";

  function buildSentinelError(code) {
    const err = new Error(
      `FCM rejected message: key=${SENTINEL_PRIVATE_KEY} token=${SENTINEL_TOKEN} payload=${SENTINEL_PAYLOAD}`
    );
    err.code = code || "messaging/invalid-argument";
    return err;
  }

  function spyOnAllConsoleMethods() {
    return {
      log: jest.spyOn(console, "log").mockImplementation(() => {}),
      error: jest.spyOn(console, "error").mockImplementation(() => {}),
      warn: jest.spyOn(console, "warn").mockImplementation(() => {}),
    };
  }

  function allLoggedCalls(spies) {
    return [...spies.log.mock.calls, ...spies.error.mock.calls, ...spies.warn.mock.calls];
  }

  function restoreAll(spies) {
    spies.log.mockRestore();
    spies.error.mockRestore();
    spies.warn.mockRestore();
  }

  it("1-3. no sentinel value (private-key fragment / FCM token / payload value) appears in any console.log/error/warn argument, even after serialization -- and the {success:false} contract is preserved", async () => {
    const spies = spyOnAllConsoleMethods();
    const err = buildSentinelError();

    const { sendPush } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: true,
      sendImpl: async () => {
        throw err;
      },
    });

    const result = await sendPush("user-1", "Title", "Body");
    expect(result).toEqual({ success: false }); // requirement 6: contract preserved

    const serialized = allLoggedCalls(spies)
      .map((call) =>
        call
          .map((arg) => {
            if (typeof arg === "string") return arg;
            try {
              return JSON.stringify(arg);
            } catch {
              return String(arg);
            }
          })
          .join(" ")
      )
      .join("\n");

    expect(serialized).not.toContain(SENTINEL_PRIVATE_KEY);
    expect(serialized).not.toContain(SENTINEL_TOKEN);
    expect(serialized).not.toContain(SENTINEL_PAYLOAD);
    expect(serialized).not.toContain(err.message);

    restoreAll(spies);
  });

  it("4. the raw Error object and err.message are never passed as an argument to any console method", async () => {
    const spies = spyOnAllConsoleMethods();
    const err = buildSentinelError();

    const { sendPush } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: true,
      sendImpl: async () => {
        throw err;
      },
    });

    await sendPush("user-1", "Title", "Body");

    for (const call of allLoggedCalls(spies)) {
      for (const arg of call) {
        expect(arg).not.toBe(err);
        expect(arg).not.toBe(err.message);
        expect(arg instanceof Error).toBe(false);
      }
    }

    restoreAll(spies);
  });

  it("5. logs exactly the static sanitized message, with no dynamic/error-derived content", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    const err = buildSentinelError();

    const { sendPush } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: true,
      sendImpl: async () => {
        throw err;
      },
    });

    await sendPush("user-1", "Title", "Body");

    expect(logSpy).toHaveBeenCalledWith("Push Error: FCM send failed.");
    logSpy.mockRestore();
  });

  it("7. token cleanup for a registration-token error code still runs, unaffected by the logging change (retry/cron-facing behavior preserved)", async () => {
    const err = buildSentinelError("messaging/invalid-registration-token");

    const { sendPush, deleteOneMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      firebaseAvailable: true,
      sendImpl: async () => {
        throw err;
      },
    });

    const result = await sendPush("user-1", "Title", "Body");

    expect(result).toEqual({ success: false });
    expect(deleteOneMock).toHaveBeenCalledWith({ token: "t1" });
  });
});
