const SibApiV3Sdk = require('sib-api-v3-sdk');

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

// Send an OTP email for signup or password reset.
const sendOTPEmail = async (toEmail, otp, purpose = "verify") => {
  let subject = "Expense Tracker OTP Verification";

  if (purpose === "reset") {
    subject = "OTP Verification for Password Reset";
  }

  await tranEmailApi.sendTransacEmail({
    sender: {
      email: "etrackerhq@gmail.com",
      name: "Expense Tracker"
    },
    to: [{ email: toEmail }],
    subject,
    htmlContent: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #2E86C1;">Expense Tracker OTP Verification</h2>
          <p>Your OTP is: <strong>${otp}</strong></p>
          <p>It will expire in 5 minutes.</p>
          <p style="font-size: 0.9em; color: #777;">If you didn't request this, please ignore this email.</p>
        </div>
    `
  });
};


// OBS-001-T06 -- best-effort operational alert email, sent to the
// configured owner address (OBS_ALERT_OWNER_EMAIL) via the same
// already-approved Brevo transactional client as sendOTPEmail. Callers
// (backend/utils/alerts.js) already catch and log any rejection, so this
// intentionally does not swallow errors itself.
const sendOperationalAlertEmail = async (toEmail, alert) => {
  const { alertType, metricValue, threshold, runbookUrl } = alert || {};

  await tranEmailApi.sendTransacEmail({
    sender: {
      email: "etrackerhq@gmail.com",
      name: "Expense Tracker"
    },
    to: [{ email: toEmail }],
    subject: `Expense Tracker alert: ${alertType || "unknown"}`,
    htmlContent: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <h2 style="color: #dc2626;">Operational alert: ${alertType || "unknown"}</h2>
          <p>Observed value: <strong>${metricValue}</strong> (threshold: ${threshold})</p>
          <p>Runbook: ${runbookUrl}</p>
        </div>
    `
  });
};

module.exports = { sendOTPEmail, sendOperationalAlertEmail };
