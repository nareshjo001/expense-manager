// NOT-003-T03/T04/T07 -- push.service.js's preference/quiet-hours gate and
// per-type preview override. Complements the pre-existing
// pushService.firebaseAvailability.test.js (which this file does not
// duplicate -- that file already covers Firebase-availability and the
// device-level generic/detailed default in full; this one covers only
// what NOT-003 added: gating on resolveSendPolicy and the preview
// override it can carry).
"use strict";

const FIREBASE_ADMIN_PATH = "../config/firebaseAdmin";
const DEVICE_TOKEN_PATH = "../models/DeviceToken";
const PREFERENCE_SERVICE_PATH = "../Services/NotificationServices/notificationPreferenceService";
const PUSH_SERVICE_PATH = "../Services/push.service";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadPushService({ tokens, policy, sendImpl }) {
  jest.resetModules();

  const findMock = jest.fn(async () => tokens);
  const deleteOneMock = jest.fn(async () => {});
  jest.doMock(DEVICE_TOKEN_PATH, () => ({ find: findMock, deleteOne: deleteOneMock }));

  const resolveSendPolicyMock = jest.fn(async () => policy);
  jest.doMock(PREFERENCE_SERVICE_PATH, () => ({ resolveSendPolicy: resolveSendPolicyMock }));

  const sendMock = jest.fn(sendImpl || (async () => "message-id"));
  const getAdminMock = jest.fn(() => ({ messaging: () => ({ send: sendMock }) }));
  const isFirebaseAvailableMock = jest.fn(() => true);
  jest.doMock(FIREBASE_ADMIN_PATH, () => ({
    getAdmin: getAdminMock,
    isFirebaseAvailable: isFirebaseAvailableMock,
    FirebaseUnavailableError: class FirebaseUnavailableError extends Error {},
  }));

  const { sendPush } = require(PUSH_SERVICE_PATH);
  return { sendPush, sendMock, findMock, resolveSendPolicyMock };
}

describe("push.service.sendPush -- NOT-003 preference gate", () => {
  test("a disabled type is suppressed BEFORE even looking up device tokens", async () => {
    const { sendPush, findMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      policy: { enabled: false, preview: "device", quiet: false },
    });

    const result = await sendPush("user-1", "Title", "Body", { type: "recurring-expense" });

    expect(result).toEqual({ success: false, suppressed: true, reason: "type_disabled" });
    expect(findMock).not.toHaveBeenCalled();
  });

  test("an active quiet-hours window is suppressed BEFORE looking up device tokens", async () => {
    const { sendPush, findMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      policy: { enabled: true, preview: "device", quiet: true },
    });

    const result = await sendPush("user-1", "Title", "Body", { type: "recurring-expense" });

    expect(result).toEqual({ success: false, suppressed: true, reason: "quiet_hours" });
    expect(findMock).not.toHaveBeenCalled();
  });

  test("resolveSendPolicy is called with the userId and the supplied type", async () => {
    const { sendPush, resolveSendPolicyMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      policy: { enabled: true, preview: "device", quiet: false },
    });

    await sendPush("user-1", "Title", "Body", { type: "recurring-expense-ended" });

    expect(resolveSendPolicyMock).toHaveBeenCalledWith("user-1", "recurring-expense-ended");
  });

  test("preview:'generic' override sends generic content even to a device that opted into detailed previews", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [{ token: "t1", platform: "mobile", notificationPreview: "detailed" }],
      policy: { enabled: true, preview: "generic", quiet: false },
    });

    await sendPush("user-1", "Recurring Expense Added", "Private Merchant has been logged", { type: "recurring-expense" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      notification: expect.objectContaining({
        title: "Expense Manager",
        body: "A recurring expense was added.",
      }),
    }));
  });

  // BUD-001-T06 -- generic preview text is per type. A category budget
  // alert must never be disguised as "A recurring expense was added." on a
  // device using the default generic preview.
  test("generic preview of a category-budget-alert uses budget-specific generic text", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [{ token: "t1", platform: "mobile", notificationPreview: "generic" }],
      policy: { enabled: true, preview: "device", quiet: false },
    });

    await sendPush("user-1", "Budget alert: Food", "You've used 92% of your Food budget for September.", {
      type: "category-budget-alert",
    });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      notification: expect.objectContaining({
        title: "Expense Manager",
        body: "You have a new budget alert.",
      }),
    }));
    const sent = JSON.stringify(sendMock.mock.calls[0][0]);
    expect(sent).not.toContain("Food");
    expect(sent).not.toContain("92%");
  });

  test("preview:'detailed' override sends real content even to a device that never opted in", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }], // no notificationPreview -- defaults generic on the device
      policy: { enabled: true, preview: "detailed", quiet: false },
    });

    await sendPush("user-1", "Recurring Expense Added", "Private Merchant has been logged", { type: "recurring-expense" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        title: "Recurring Expense Added",
        body: "Private Merchant has been logged",
      }),
    }));
  });

  test("preview:'device' defers to the device's own setting, unchanged from pre-NOT-003 behavior", async () => {
    const { sendMock, sendPush } = loadPushService({
      tokens: [{ token: "t1", platform: "web", notificationPreview: "detailed" }],
      policy: { enabled: true, preview: "device", quiet: false },
    });

    await sendPush("user-1", "Recurring Expense Added", "Private Merchant has been logged", { type: "recurring-expense" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "Recurring Expense Added" }),
    }));
  });

  test("the payload tag reflects the supplied type", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      policy: { enabled: true, preview: "device", quiet: false },
    });

    await sendPush("user-1", "Title", "Body", { type: "recurring-expense-ended" });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tag: "recurring-expense-ended" }),
    }));
  });

  test("an untyped call keeps the legacy 'recurring-expense' tag", async () => {
    const { sendPush, sendMock } = loadPushService({
      tokens: [{ token: "t1", platform: "web" }],
      policy: { enabled: true, preview: "device", quiet: false },
    });

    await sendPush("user-1", "Title", "Body");

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tag: "recurring-expense" }),
    }));
  });
});
