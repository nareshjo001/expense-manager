const SibApiV3Sdk = require('sib-api-v3-sdk');

const client = SibApiV3Sdk.ApiClient.instance;
client.authentications["api-key"].apiKey = process.env.BREVO_API_KEY;

const tranEmailApi = new SibApiV3Sdk.TransactionalEmailsApi();

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

module.exports = { sendOTPEmail };