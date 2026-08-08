const router = require("express").Router();

const { ask } = require("../Controllers/SiaControllers/ask");
const verifyToken = require("../Middlewares/Auth");
const { siaLimiter } = require("../utils/rateLimiter");

// M3-1: verifyToken first (so req.userId is always set before the limiter
// keys on it), then the dedicated SIA limiter, then the controller.
router.post("/ask", verifyToken, siaLimiter, ask);

module.exports = router;
