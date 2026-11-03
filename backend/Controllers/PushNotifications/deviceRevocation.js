"use strict";

// DELETE /api/device-token: explicit, user-initiated revocation of ONE of the caller's own device tokens (this device only -- not "sign out everywhere").
const DeviceToken = require("../../models/DeviceToken");

const revokeDeviceToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== "string" || !token.trim()) {
      return res.status(400).json({ message: "Device token is required", success: false });
    }

    // Scoped to (token, userId) -- same ownership model as registration -- so this can never be used to delete a token belonging to a DIFFERENT account even if one were somehow guessed/leaked.
    await DeviceToken.deleteOne({ token: token.trim(), userId: req.userId });

    // Idempotent by design: deleting an already-gone (or never-owned-by- this-user) token is not an error -- a double-invoke on logout, or a client racing its own retry, must not surface a failure toast for what is, from the user's perspective, already the desired state.
    return res.status(200).json({ message: "Device token revoked", success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { revokeDeviceToken };
