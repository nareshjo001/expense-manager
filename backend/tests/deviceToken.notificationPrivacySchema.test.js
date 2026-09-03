"use strict";

const mongoose = require("mongoose");
const DeviceToken = require("../models/DeviceToken");

describe("DeviceToken notification privacy schema", () => {
  it("defaults every new device to generic notification previews", () => {
    const registration = new DeviceToken({
      userId: new mongoose.Types.ObjectId(),
      token: "device-token",
      platform: "web",
    });

    expect(registration.notificationPreview).toBe("generic");
    expect(registration.validateSync()).toBeUndefined();
  });

  it("rejects preview values outside the privacy allowlist", () => {
    const registration = new DeviceToken({
      userId: new mongoose.Types.ObjectId(),
      token: "device-token",
      platform: "web",
      notificationPreview: "include-everything",
    });

    expect(registration.validateSync().errors.notificationPreview).toBeDefined();
  });
});
