"use strict";

const DEVICE_TOKEN_PATH = "../models/DeviceToken";
const CONTROLLER_PATH = "../Controllers/PushNotifications/deviceRegistration";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadController({ claimed = null, createResult = {} } = {}) {
  const findOneAndUpdate = jest.fn().mockResolvedValue(claimed);
  const create = jest.fn().mockResolvedValue(createResult);
  jest.doMock(DEVICE_TOKEN_PATH, () => ({ findOneAndUpdate, create }));
  const { deviceRegistration } = require(CONTROLLER_PATH);
  return { deviceRegistration, findOneAndUpdate, create };
}

function responseHarness() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe("device notification privacy registration", () => {
  it("rejects an unsupported preview mode before accessing the database", async () => {
    const harness = loadController();
    const res = responseHarness();

    await harness.deviceRegistration({
      userId: "user-1",
      body: { token: "token-1", platform: "web", notificationPreview: "full-financial-data" },
    }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(harness.findOneAndUpdate).not.toHaveBeenCalled();
    expect(harness.create).not.toHaveBeenCalled();
  });

  it("creates a new registration with the explicit detailed opt-in", async () => {
    const harness = loadController();
    const res = responseHarness();

    await harness.deviceRegistration({
      userId: "user-1",
      body: { token: " token-1 ", platform: "web", notificationPreview: "detailed" },
    }, res);

    expect(harness.create).toHaveBeenCalledWith({
      token: "token-1",
      userId: "user-1",
      platform: "web",
      notificationPreview: "detailed",
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does not reset an existing device preference when registration omits it", async () => {
    const harness = loadController({ claimed: { token: "token-1" } });
    const res = responseHarness();

    await harness.deviceRegistration({
      userId: "user-1",
      body: { token: "token-1", platform: "mobile" },
    }, res);

    expect(harness.findOneAndUpdate).toHaveBeenCalledWith(
      { token: "token-1", userId: "user-1" },
      { $set: { userId: "user-1", platform: "mobile" } },
      { new: true }
    );
    expect(harness.create).not.toHaveBeenCalled();
  });
});
