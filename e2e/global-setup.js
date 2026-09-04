'use strict';

// TST-001-T05 -- seeds one verified E2E user directly against the real
// backend + MongoDB that playwright.config.js's `webServer` entries just
// started, so every spec can log in immediately instead of re-running
// signup in each test.
//
// This calls the REAL POST /auth/signup endpoint (the same code path a
// real user hits), so the seeded user gets a genuinely bcrypt-hashed
// password via the app's own signup controller
// (backend/Controllers/AuthControllers/signup.js). The ONLY step this
// deliberately bypasses is "read the OTP out of a delivered email" --
// nothing in CI or this sandbox can read a real inbox, and the OTP itself
// proves nothing about the app's own login/session code that this suite
// is actually here to exercise. So instead, once signup has written the
// user document (with otp/otpExpiry/isVerified:false), this connects to
// the SAME MongoDB directly and applies exactly the mutation
// backend/Controllers/AuthControllers/verifyOTP.js would have made had a
// human actually typed the emailed code: isVerified:true, OTP fields
// cleared.
const { MongoClient } = require('mongodb');
const { E2E_USER } = require('./fixtures/testUser');

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://127.0.0.1:8081';
const MONGO_CONN =
  process.env.E2E_MONGO_CONN ||
  process.env.MONGO_CONN ||
  'mongodb://127.0.0.1:27017/expense_manager_e2e';

async function globalSetup() {
  const signupResponse = await fetch(`${BACKEND_URL}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fullName: E2E_USER.fullName,
      email: E2E_USER.email,
      password: E2E_USER.password,
    }),
  });

  // 201 = freshly created (or re-issued OTP for a previously-unverified
  //       record) -- the normal case on a clean CI database.
  // 503 = the (dummy, unconfigured) OTP email failed to send. Harmless
  //       here: signup.js persists the user document BEFORE it attempts
  //       to send that email, so the record we're about to verify below
  //       already exists.
  // 409 = "User Already Exists" -- only returned when a PREVIOUS run
  //       already left this email fully verified (repeated local runs
  //       against a reused dev server/DB). Also safe to proceed.
  if (![201, 503, 409].includes(signupResponse.status)) {
    const body = await signupResponse.text().catch(() => '<unreadable body>');
    throw new Error(
      `[e2e global-setup] Unexpected /auth/signup status ${signupResponse.status} while seeding the E2E ` +
        `test user at ${BACKEND_URL}. Response body: ${body}`
    );
  }

  const client = new MongoClient(MONGO_CONN);
  try {
    await client.connect();
    const db = client.db();
    const users = db.collection('users');

    const updateResult = await users.findOneAndUpdate(
      { email: E2E_USER.email },
      {
        $set: { isVerified: true, isPasswordReset: false },
        $unset: {
          otp: '',
          otpExpiry: '',
          lastOtpSent: '',
          verificationExpiresAt: '',
          passwordResetExpiry: '',
        },
      },
      { returnDocument: 'after' }
    );

    // mongodb driver v6 returns the document directly; older drivers wrap
    // it as `{ value: doc }`. Handle both so this isn't silently broken by
    // a future driver bump.
    const verifiedUser =
      updateResult && Object.prototype.hasOwnProperty.call(updateResult, 'value')
        ? updateResult.value
        : updateResult;

    if (!verifiedUser) {
      throw new Error(
        `[e2e global-setup] Could not find the E2E test user (${E2E_USER.email}) in the "users" collection ` +
          `after calling /auth/signup. Checked MongoDB at the connection named by E2E_MONGO_CONN/MONGO_CONN.`
      );
    }

    if (!verifiedUser.isVerified) {
      throw new Error(
        `[e2e global-setup] Updated the E2E test user (${E2E_USER.email}) but isVerified is still falsy -- ` +
          `the seeded account will not be able to log in.`
      );
    }
  } finally {
    await client.close();
  }
}

module.exports = globalSetup;
