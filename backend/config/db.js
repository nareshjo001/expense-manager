const mongoose = require('mongoose');

// Connect to MongoDB, rethrowing so server.js can fail fast on startup.
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_CONN);
    console.log('DB Connected');
  } catch (err) {
    console.error('DB Connection Failed');
    throw err;
  }
};

module.exports = connectDB;