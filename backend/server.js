// Fix MongoDB Atlas SRV DNS resolution before anything else
const dns = require("dns");

dns.setServers([
  "8.8.8.8",
  "1.1.1.1"
]);

require("dotenv").config();

// Cron jobs
require("./cron/recurringJob");
require("./cron/retryPush");
require("./cron/feedbackCollector");

// Express application (routes, middleware) -- see app.js
const app = require("./app");

// Database
const connectDB = require("./config/db");

// Redis
const { connectRedis } = require("./config/redis");

// Port
const PORT = process.env.PORT || 8080;


// Start Server
const startServer = async () => {
  try {

    await connectDB();

    await connectRedis();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });


  } catch (err) {

    console.error("Failed to start server:", err);

    process.exit(1);
  }
};


startServer();
