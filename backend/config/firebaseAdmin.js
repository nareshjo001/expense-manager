const admin = require("firebase-admin");

// Firebase is an OPTIONAL capability (push notifications only -- see
// Services/push.service.js, its only caller). It must never crash backend
// startup: this module used to call admin.initializeApp() unguarded at
// top-level require() time, which threw synchronously on a missing or
// malformed FIREBASE_SERVICE_ACCOUNT -- and because server.js requires the
// cron jobs (which require push.service.js, which requires this file)
// before app.listen(), that throw took down the ENTIRE application, not
// just push notifications.
class FirebaseUnavailableError extends Error {
  constructor(reason) {
    super(`Firebase is unavailable: ${reason}`);
    this.name = "FirebaseUnavailableError";
  }
}

let initialized = false; // guards re-running init more than once per process
let firebaseApp = null;  // set only on a fully successful init
let unavailableReason = null;

// Lazy, guarded, singleton initialization. Runs at most once per process,
// on the first call to isFirebaseAvailable()/getAdmin() from any caller.
// The whole function body is synchronous (no `await`), so there is no
// async window in which a second/concurrent caller could observe
// `initialized` still false and race into a duplicate admin.initializeApp()
// call -- the first caller to run this function completes it fully before
// any other caller can run any JS at all.
const ensureInitialized = () => {
  if (initialized) return;
  initialized = true;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    unavailableReason = "FIREBASE_SERVICE_ACCOUNT is not set";
    console.error("[firebaseAdmin] Firebase unavailable: FIREBASE_SERVICE_ACCOUNT is not set. Push notifications are disabled.");
    return;
  }

  // Never log `raw` or the parse error's message -- a malformed value could
  // itself contain fragments of a real credential pasted incorrectly.
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    unavailableReason = "FIREBASE_SERVICE_ACCOUNT is not valid JSON";
    console.error("[firebaseAdmin] Firebase unavailable: FIREBASE_SERVICE_ACCOUNT is not valid JSON. Push notifications are disabled.");
    return;
  }

  if (
    !serviceAccount ||
    typeof serviceAccount !== "object" ||
    !serviceAccount.project_id ||
    !serviceAccount.client_email ||
    !serviceAccount.private_key
  ) {
    unavailableReason = "FIREBASE_SERVICE_ACCOUNT is missing required fields";
    console.error("[firebaseAdmin] Firebase unavailable: FIREBASE_SERVICE_ACCOUNT is missing required fields (project_id/client_email/private_key). Push notifications are disabled.");
    return;
  }

  // Never log the raw SDK error -- admin.credential.cert() can embed
  // parts of the malformed key material in its thrown error message.
  try {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch {
    unavailableReason = "Firebase SDK failed to initialize";
    firebaseApp = null;
    console.error("[firebaseAdmin] Firebase unavailable: SDK initialization failed. Push notifications are disabled.");
  }
};

const isFirebaseAvailable = () => {
  ensureInitialized();
  return firebaseApp !== null;
};

// Returns the initialized firebase-admin SDK. Throws a sanitized
// FirebaseUnavailableError (never the raw parse/SDK error) if Firebase
// isn't configured -- callers that can degrade gracefully should check
// isFirebaseAvailable() first instead of catching this.
const getAdmin = () => {
  ensureInitialized();
  if (!firebaseApp) {
    throw new FirebaseUnavailableError(unavailableReason || "not configured");
  }
  return admin;
};

module.exports = { getAdmin, isFirebaseAvailable, FirebaseUnavailableError };
