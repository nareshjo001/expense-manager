const Joi = require("joi");

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required();
const password = Joi.string()
  .min(8)
  .max(72)
  .custom((value, helpers) => (
    Buffer.byteLength(value, "utf8") <= 72
      ? value
      : helpers.message({ custom: "Password must not exceed 72 UTF-8 bytes" })
  ))
  .required();

const authSchemas = Object.freeze({
  signup: Joi.object({
    fullName: Joi.string().trim().min(4).max(50).required(),
    email,
    password,
  }).unknown(false),
  login: Joi.object({
    email,
    password: Joi.string().min(1).max(72).required(),
  }).unknown(false),
  emailOnly: Joi.object({ email }).unknown(false),
  verifyOtp: Joi.object({
    email,
    otp: Joi.string().pattern(/^\d{6}$/).required(),
  }).unknown(false),
  resetPassword: Joi.object({
    email,
    password,
    resetToken: Joi.string().pattern(/^[A-Za-z0-9_-]{43}$/).required(),
  }).unknown(false),
});

const validationMessage = (error) => {
  const rawMessage = error.details[0].message.replace(/"/g, "");
  return rawMessage.charAt(0).toUpperCase() + rawMessage.slice(1);
};

const validateAuthRequest = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: true,
    convert: true,
  });

  if (error) {
    return res.status(400).json({
      success: false,
      code: "AUTH_VALIDATION_ERROR",
      message: validationMessage(error),
    });
  }

  req.body = value;
  next();
};

module.exports = {
  authSchemas,
  validateAuthRequest,
};
