module.exports = {
  signup: require('./signup').signup,
  login: require('./login').login,
  verifyOTP: require('./verifyOTP').verifyOTP,
  resendOTP: require('./resendOTP').resendOTP,
  forgotPassword: require('./forgotPassword').forgotPassword,
  resetPassword: require('./resetPassword').resetPassword,
  refresh: require('./session').refresh,
  logout: require('./session').logout,
  logoutAll: require('./session').logoutAll,
  // PRV-001-T03
  requestDeletion: require('./accountDeletion').requestDeletion,
  cancelDeletion: require('./accountDeletion').cancelDeletion,
  getDeletionStatus: require('./accountDeletion').getDeletionStatus,
};
