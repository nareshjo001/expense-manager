// Import Express framework
const express = require('express'); 

// Import CORS middleware (allows requests from other origins)
const cors = require('cors');

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
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// Authentication routes
app.use('/auth', AuthRouter);

// Bill & Ml Routes
app.use('/bills', billRoutes);
app.use('/ml', mlRouter);

// Global error handler (must be last)
app.use(errorHandler);

// Function to start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDB();

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