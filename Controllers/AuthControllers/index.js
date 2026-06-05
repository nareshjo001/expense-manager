module.exports = {
  signup: require('./signup').signup,
  login: require('./login').login,
  verifyOTP: require('./verifyOTP').verifyOTP,
  resendOTP: require('./resendOTP').resendOTP,
  forgotPassword: require('./forgotPassword').forgotPassword,
  resetPassword: require('./resetPassword').resetPassword,
};