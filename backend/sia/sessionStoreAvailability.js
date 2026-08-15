// Single source of truth for "is the bounded SIA session store usable right now" -- factored out of ask.js specifically so tests can force the active/connected session path without mutating the real, global `mongoose` singleton's connection state (doing that directly breaks every other model compiled elsewhere, since Mongoose eagerly binds a real native collection once readyState claims "connected"). Mocking this one small module instead leaves the rest of the application's real Mongoose behavior untouched.
"use strict";

const mongoose = require("mongoose");

function isSessionStoreAvailable() {
  return Boolean(mongoose.connection && mongoose.connection.readyState === 1);
}

module.exports = {
  isSessionStoreAvailable,
};
