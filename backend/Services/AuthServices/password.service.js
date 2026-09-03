const bcrypt = require('bcrypt');

const DUMMY_PASSWORD_HASH = bcrypt.hashSync('expense-manager-invalid-password', 10);

// Hash a password with bcrypt at 10 salt rounds.
const hashPassword = async (password) => {
  return bcrypt.hash(password, 10);
};

const comparePassword = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword);
};

const comparePasswordOrDummy = async (password, hashedPassword) => {
  return bcrypt.compare(password, hashedPassword || DUMMY_PASSWORD_HASH);
};

module.exports = {
  hashPassword,
  comparePassword,
  comparePasswordOrDummy,
  DUMMY_PASSWORD_HASH,
};
