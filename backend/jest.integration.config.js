// Separate Jest configuration for the M0-2 integration suite ONLY.
//
// backend/jest.config.js (M0-T) is untouched -- its testMatch
// ("<rootDir>/tests/**/*.test.js") cannot match this suite's files, which
// use the deliberately different ".itest.js" suffix below. `npm test`
// therefore continues to discover only the M0-T smoke test and never
// requires MongoDB/Redis/TEST_* variables.
module.exports = {
  testEnvironment: "node",
  rootDir: __dirname,
  testMatch: ["<rootDir>/tests/**/*.itest.js"],
  setupFiles: ["<rootDir>/tests/setup/integrationEnv.js"],
  testTimeout: 30000,
};
