// OBS-001-T07 -- no model may declare the same index twice.
//
// Three preference models declared { userId: 1 } unique both with
// `unique: true` on the field and with schema.index(). MongoDB ends up with
// one index either way, but Mongoose prints a plain-text duplicate-index
// warning on every start -- 13 unstructured stderr lines in the
// verifyObservability.js staging run. This catches the next one at unit level.
"use strict";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

require("../config/Schemas");
const modelsDir = path.join(__dirname, "..", "models");
for (const file of fs.readdirSync(modelsDir)) {
  if (file.endsWith(".js")) require(path.join(modelsDir, file));
}

test.each(mongoose.modelNames())("model %s declares each index once", (name) => {
  const keys = mongoose.model(name).schema.indexes().map(([key]) => JSON.stringify(key));
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  expect(duplicates).toEqual([]);
});
