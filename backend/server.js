const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const compression = require("compression");
const morgan = require("morgan");
const http = require("http");
require("dotenv").config({ path: "../.env" });

// Import Databases
const connectDB = require("../config/db");
const redisClient = require("./lib/redis"); // Imported as redisClient

// Import routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const messageRoutes = require("./routes/message.route");
const conversationRoutes = require("./routes/conversation.routes");
const friendRoutes = require("./routes/friend.routes");

// Import middleware
const { errorHandler, notFound } = require("./middleware/error.middleware");
const SocketServer = require("../socket/socket");

// Initialize Express app
const app = express();
const server = http.createServer(app);
app.set("redis", redisClient);
// Basic Middlewares
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(compression());

// Security & Logging
app.use(
  helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }),
);
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

// CORS
const corsOptions = {
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Cookie",
  ],
};
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// --- REDIS EXAMPLE ROUTES ---
app.get("/api/redis/get/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const value = await redisClient.get(key); // Use redisClient
    if (value) {
      return res.json({ source: "cache", data: value });
    }
    res.json({ message: "Key not found" });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get("/api/redis/set/:key/:value", async (req, res) => {
  try {
    const { key, value } = req.params;
    await redisClient.set(key, value, { EX: 3600 });
    res.send(`Successfully stored ${key} in Redis`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const socketServer = new SocketServer();
socketServer.start(5001);
app.set("socketServer", socketServer);

// --- API ROUTES ---
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV,
  });
});

// Start sequence
const startServer = async () => {
  try {
    // Fix for potential local DNS issues
    const dns = require("node:dns");
    dns.setDefaultResultOrder("ipv4first");

    // 1. Connect MongoDB
    await connectDB();

    // 2. Redis Connection is handled inside lib/redis.js (auto-connect)

    // 3. Mount Routes
    app.use("/api/auth", authRoutes);
    app.use("/api/users", userRoutes);
    app.use("/api/friends", friendRoutes);
    app.use("/api/conversations", conversationRoutes);
    app.use("/api/messages", messageRoutes);

    // Static Files & Error Handling
    app.use("/uploads", express.static("uploads"));
    app.use(notFound);
    app.use(errorHandler);

    const PORT = process.env.PORT || 7000;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
};

// Error Listeners
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION! 💥", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION! 💥", err);
  server.close(() => process.exit(1));
});

startServer();

module.exports = { app, server };
