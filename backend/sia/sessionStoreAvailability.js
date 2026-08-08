// Single source of truth for "is the bounded SIA session store usable
// right now" -- Batch 2 architecture closure.
//
// Factored out of Controllers/SiaControllers/ask.js specifically so tests
// can force the active/connected session path without mutating the real,
// global `mongoose` singleton's connection state (doing that directly
// breaks every OTHER model compiled elsewhere in app.js's require graph --
// Mongoose eagerly attempts to bind a real native collection once
// `readyState` claims "connected", which crashes for any model that was
// never actually connected). Mocking this one small module instead leaves
// the rest of the application's real Mongoose behavior completely
// untouched.
"use strict";

const mongoose = require("mongoose");

function isSessionStoreAvailable() {
  return Boolean(mongoose.connection && mongoose.connection.readyState === 1);
}

module.exports = {
  isSessionStoreAvailable,
};
