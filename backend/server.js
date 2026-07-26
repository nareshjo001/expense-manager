// Fix MongoDB Atlas SRV DNS resolution before anything else
const dns = require("dns");

dns.setServers([
  "8.8.8.8",
  "1.1.1.1"
]);

require("dotenv").config();

// Import packages
const express = require("express");
const cors = require("cors");
const axios = require("axios");

// Cron jobs
require("./cron/recurringJob");
require("./cron/retryPush");
require("./cron/feedbackCollector");

// Routes
const authRouter = require("./Routes/auth.routes");
const apiRouter = require("./Routes/api.routes");
const expenseRouter = require("./Routes/expense.routes");
const incomeRouter = require("./Routes/income.routes");
const billRoutes = require("./Routes/bill.routes");
const mlRouter = require("./Routes/ml.router");
const reportRouter = require("./Routes/report.routes");
const chartRouter = require("./Routes/chart.routes");

// Database
const connectDB = require("./config/db");

// Middleware
const errorHandler = require("./Middlewares/error.middleware");

// Rate limiting for authenticated API surfaces
const { apiLimiter } = require("./utils/rateLimiter");

// Redis
const { connectRedis } = require("./config/redis");

// Create app
const app = express();

// Port
const PORT = process.env.PORT || 8080;


// Middlewares
app.use(cors());
app.use(express.json());


// Routes
app.get("/", (req, res) => {
  res.send("Welcome! Connected to DB...");
});


app.get("/ping", async (req, res) => {
  try {
    await axios.get(`${process.env.ML_ROUTE}/`);

    res.status(200).json({
      success: true,
      backend: "up",
      ml: "up"
    });

  } catch (err) {
    res.status(503).json({
      success: false,
      backend: "up",
      ml: "down",
      message: "Server Unavailable."
    });
  }
});


// Credential/OTP endpoints. These carry their own stricter authLimiter
// internally, so apiLimiter (which keys on req.userId) is not applied here.
app.use("/auth", authRouter);

// apiLimiter is keyed on req.userId (falling back to req.ip), so it is
// applied to the authenticated route groups only.
app.use("/api", apiLimiter, apiRouter);
app.use("/expense", apiLimiter, expenseRouter);
app.use("/bills", apiLimiter, billRoutes);
app.use("/ml", apiLimiter, mlRouter);
app.use("/report", apiLimiter, reportRouter);
app.use("/chart", apiLimiter, chartRouter);
app.use("/income", apiLimiter, incomeRouter);

// Error handler (must be last)
app.use(errorHandler);


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