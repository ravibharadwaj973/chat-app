const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  try {
    // Check token from cookies or Authorization header
    let token = req.cookies?.token ;
    
    if (!token) {
      return res.status(401).json({ 
        success: false, 
        error: "Access denied. No token provided." 
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Add user info to request
    req.user = decoded;
    req.token = token;
    
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false, 
        error: "Token expired. Please login again." 
      });
    }
    
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token." 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: "Authentication failed." 
    });
  }
};

const optionalAuth = (req, res, next) => {
  try {
    let token = req.cookies?.token ;
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      req.token = token;
    }
    
    next();
  } catch (err) {
    next(); // Continue without authentication
  }
};

module.exports = { authenticate, optionalAuth };