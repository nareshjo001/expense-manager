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
const AuthRouter = require("./Routes/api.routes");
const expenseRouter = require("./Routes/expense.routes");
const billRoutes = require("./Routes/bill.routes");
const mlRouter = require("./Routes/ml.router");
const reportRouter = require("./Routes/report.routes");
const chartRouter = require("./Routes/chart.routes");

// Database
const connectDB = require("./config/db");

// Middleware
const errorHandler = require("./Middlewares/error.middleware");

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


app.use("/auth", AuthRouter);
app.use("/expense", expenseRouter);
app.use("/bills", billRoutes);
app.use("/ml", mlRouter);
app.use("/report", reportRouter);
app.use("/chart", chartRouter);

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