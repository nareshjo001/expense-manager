// BALENISA Firebase Startup Resilience and Environment-Contract Hardening.
"use strict";

const FIREBASE_ADMIN_MODULE_PATH = "../config/firebaseAdmin";
const FIREBASE_ADMIN_SDK_PATH = "firebase-admin";

const ORIGINAL_ENV_VALUE = process.env.FIREBASE_SERVICE_ACCOUNT;

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  if (ORIGINAL_ENV_VALUE === undefined) {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
  } else {
    process.env.FIREBASE_SERVICE_ACCOUNT = ORIGINAL_ENV_VALUE;
  }
});

function loadFirebaseAdmin({ initializeAppImpl, certImpl } = {}) {
  jest.resetModules();

  const initializeApp = jest.fn(initializeAppImpl || (() => ({ name: "[DEFAULT]" })));
  const cert = jest.fn(certImpl || ((serviceAccount) => ({ __cert: true, project_id: serviceAccount.project_id })));

  jest.doMock(FIREBASE_ADMIN_SDK_PATH, () => ({
    initializeApp,
    credential: { cert },
    messaging: jest.fn(),
  }));

  const mod = require(FIREBASE_ADMIN_MODULE_PATH);
  return { ...mod, initializeApp, cert };
}

const VALID_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: "service_account",
  project_id: "demo-project",
  client_email: "demo@demo-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nFAKE_KEY_MATERIAL\n-----END PRIVATE KEY-----\n",
});

describe("firebaseAdmin -- startup resilience", () => {
  it("1. missing FIREBASE_SERVICE_ACCOUNT does not throw on require or on first use, and reports unavailable", () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;

    let mod;
    expect(() => {
      mod = loadFirebaseAdmin();
    }).not.toThrow();

    expect(() => mod.isFirebaseAvailable()).not.toThrow();
    expect(mod.isFirebaseAvailable()).toBe(false);
  });

  it("2. malformed credential JSON does not throw on require or on first use, and reports unavailable", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = "{ this is not valid json";

    const mod = loadFirebaseAdmin();
    expect(() => mod.isFirebaseAvailable()).not.toThrow();
    expect(mod.isFirebaseAvailable()).toBe(false);
  });

  it("3. structurally incomplete credentials (missing private_key) do not throw and are unavailable", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: "demo-project",
      client_email: "demo@demo-project.iam.gserviceaccount.com",
      // private_key deliberately omitted
    });

    const mod = loadFirebaseAdmin();
    expect(() => mod.isFirebaseAvailable()).not.toThrow();
    expect(mod.isFirebaseAvailable()).toBe(false);
  });

  it("4. a Firebase SDK initialization failure (valid JSON, SDK rejects it) does not throw and is reported unavailable", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = VALID_SERVICE_ACCOUNT_JSON;

    const mod = loadFirebaseAdmin({
      initializeAppImpl: () => {
        throw new Error("SDK rejected credential");
      },
    });

    expect(() => mod.isFirebaseAvailable()).not.toThrow();
    expect(mod.isFirebaseAvailable()).toBe(false);
  });

  it("5. getAdmin() throws a sanitized FirebaseUnavailableError when unavailable -- never the raw parse/SDK error", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = "{ this is not valid json";

    const { getAdmin, FirebaseUnavailableError } = loadFirebaseAdmin();

    let caught;
    try {
      getAdmin();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(FirebaseUnavailableError);
    expect(caught.message).not.toContain("this is not valid json");
    expect(caught.message).not.toMatch(/SyntaxError|Unexpected token/);
  });

  it("6. valid configuration initializes Firebase exactly once even across multiple/'concurrent' calls", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = VALID_SERVICE_ACCOUNT_JSON;

    const { isFirebaseAvailable, getAdmin, initializeApp } = loadFirebaseAdmin();

    // ensureInitialized() is fully synchronous (no `await`), so repeated /
    isFirebaseAvailable();
    isFirebaseAvailable();
    getAdmin();
    getAdmin();
    isFirebaseAvailable();

    expect(initializeApp).toHaveBeenCalledTimes(1);
  });

  it("7. valid configuration reports available and getAdmin() returns the initialized SDK without throwing", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = VALID_SERVICE_ACCOUNT_JSON;

    const { isFirebaseAvailable, getAdmin } = loadFirebaseAdmin();

    expect(isFirebaseAvailable()).toBe(true);
    expect(() => getAdmin()).not.toThrow();
  });

  it("8. no credential/private-key value ever reaches console.error, even when the SDK's own error message contains one", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = VALID_SERVICE_ACCOUNT_JSON.replace(
      "FAKE_KEY_MATERIAL",
      "SUPER-SECRET-KEY-MATERIAL"
    );

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const mod = loadFirebaseAdmin({
      initializeAppImpl: () => {
        // Adversarial: the SDK's own thrown error embeds a fragment of the
        // credential -- proves the catch block never forwards err.message.
        throw new Error("cert rejected: SUPER-SECRET-KEY-MATERIAL is malformed");
      },
    });

    mod.isFirebaseAvailable();

    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).not.toContain("SUPER-SECRET-KEY-MATERIAL");

    errorSpy.mockRestore();
  });

  it("9. no credential value ever reaches console.error for a malformed-JSON env var containing secret-shaped text", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{"private_key":"SUPER-SECRET-KEY-MATERIAL", not valid json past here';

    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const mod = loadFirebaseAdmin();
    mod.isFirebaseAvailable();

    const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(loggedText).not.toContain("SUPER-SECRET-KEY-MATERIAL");

    errorSpy.mockRestore();
  });
});

describe("firebaseAdmin -- real module, real firebase-admin package, no mocking", () => {
  it("requiring the real firebaseAdmin.js, push.service.js, and app.js with FIREBASE_SERVICE_ACCOUNT absent does not throw (matches this project's own test environment, which has no FIREBASE_* var set)", () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    jest.resetModules();

    expect(() => {
      const firebaseAdmin = require("../config/firebaseAdmin");
      require("../Services/push.service");
      require("../app");
      expect(firebaseAdmin.isFirebaseAvailable()).toBe(false);
    }).not.toThrow();
  });
});
