// Separate Jest config for the integration suite only -- jest.config.js's testMatch can't match this suite's ".itest.js" files, so `npm test` never requires MongoDB/Redis/TEST_* variables.
module.exports = {
  testEnvironment: "node",
  rootDir: __dirname,
  testMatch: ["<rootDir>/tests/**/*.itest.js"],
  setupFiles: ["<rootDir>/tests/setup/integrationEnv.js"],
  testTimeout: 30000,
};
