const jwt = require("jsonwebtoken");
const User = require("../../models/user");
const cookieParser = require("cookie-parser")(); // Initialize it here

const socketAuth = async (socket, next) => {
  // 1. Manually run cookie-parser on the raw request
  // This turns the header string into the 'socket.request.cookies' object
  cookieParser(socket.request, {}, () => {});

  try {
    // 2. Now you can use the 'simple' way just like your backend!
    let token = socket.request.cookies?.token || socket.handshake.auth?.token;

    if (!token) {
      console.log("❌ Socket connection rejected: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }

    // 3. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 4. Find user
    const user = await User.findById(decoded.id);
    if (!user) return next(new Error("User not found"));

    socket.userId = decoded.id;
    next();
  } catch (err) {
    console.error("Socket Auth Error:", err.message);
    next(new Error("Authentication error"));
  }
};

module.exports = socketAuth;