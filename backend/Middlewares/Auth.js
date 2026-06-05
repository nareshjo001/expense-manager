// Import jsonwebtoken library
const jwt = require('jsonwebtoken');

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  try {
    // Get Authorization header from request
    const authHeader = req.headers.authorization;
    
    // Check if Authorization header exists and starts with "Bearer "
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        success: false, 
        message: "Authorization token missing"
      });
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ success: false, message: "Token missing" });
    }

    // Verify token using secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if decoded token contains user id
    if (!decoded || !decoded._id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token payload'
      });
    }

    // Attach user id to request object for later use
    req.userId = decoded._id;
    
    // Token is valid → move to next middleware/controller
    next();
  } catch (err) {
    // Token verification failed (expired or invalid)
    console.error("JWT verification failed");
    return res.status(401).json({ 
      success: false,
      message: "Invalid or expired token"
    });
  }
};

module.exports = verifyToken;