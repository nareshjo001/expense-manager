// Import Express framework
const express = require('express'); 

// Import CORS middleware (allows requests from other origins)
const cors = require('cors');

const axios = require("axios");

// Load environment variables from .env file
require('dotenv').config();

// cron jobs
require('./cron/recurringJob');
require('./cron/retryPush');
require('./cron/feedbackCollector');

// Import authenticated routes
const AuthRouter = require('./Routes/api.routes');

// Import database connection function
const connectDB = require('./config/db');

// Import global error handling middleware
const errorHandler = require('./Middlewares/error.middleware');

// Create Express app
const app = express();

// Get port from environment or use 8080
const PORT = process.env.PORT || 8080;

const billRoutes = require('./Routes/billRoutes');
const mlRouter = require('./Routes/ml.router');
const reportRouter = require('./Routes/report.routes');

const { connectRedis } = require('./config/redis');

// *** Middlewares ***

// Enable CORS for all requests
app.use(cors());

// Parse incoming JSON requests
app.use(express.json());

// *** Routes ***

// Default route (for testing)
app.get('/', (req, res) => {
  res.send('Welcome! Connected to DB...');
});

// Health check route
app.get('/ping', async (req, res) => {
  try {
    const mlResponse = await axios.get(`${process.env.ML_ROUTE}/`);

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

// Authentication routes
app.use('/auth', AuthRouter);

// Bill & Ml Routes
app.use('/bills', billRoutes);
app.use('/ml', mlRouter);

// Report Routes
app.use("/report", reportRouter);

// Global error handler (must be last)
app.use(errorHandler);

// Function to start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

    await connectRedis();

    // Start listening for requests
    app.listen(PORT, "0.0.0.0",() => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server due to DB error', err);
    process.exit(1);
  }
};

// Call function to start server
startServer();