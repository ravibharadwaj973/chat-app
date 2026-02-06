const socketIo = require("socket.io");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const socketAuth = require("./middleware/socketAuth");
// const redisClient = require("redis");

const UserEventsHandler = require("./events/user.events");
const MessageEventsHandler = require("./events/message.events");
const ConversationEventsHandler = require("./events/conversation.events");
const FriendEventsHandler = require("./events/friend.events");

const connectDB = require("../config/db");
require("dotenv").config({ path: "../.env" });
const redisClient = require("../backend/lib/redis");
class SocketServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);

    this.io = socketIo(this.server, {
      cors: {
        origin: process.env.CLIENT_URL || "http://localhost:3000",
        credentials: true,
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.connectedUsers = new Map();

    // FIXED — each handler must have its own variable
    this.userEvents = new UserEventsHandler(this.io);
    this.messageEvents = new MessageEventsHandler(this.io);
    this.conversationEvents = new ConversationEventsHandler(this.io);
    this.friendEvents = new FriendEventsHandler(this.io);
  }

  async initializeDatabase() {
    try {
      await connectDB();
      require("../models/user");
      console.log("✅ Socket Server: MongoDB connected");
    } catch (err) {
      console.error("❌ Socket Server: MongoDB connection error:", err);
      process.exit(1);
    }
  }

  setupMiddleware() {
    this.io.use(socketAuth);
  }

  setupSocketEvents() {
    this.io.on("connection", (socket) => {
      const userId = socket.userId;
      console.log(`✅ Socket connected: ${socket.id} (User: ${userId})`);

      // Track user socket (NOW messageEvents exists)
      this.messageEvents.trackUserSocket(userId, socket.id);

      this.connectedUsers.set(userId, {
        socketId: socket.id,
        connectedAt: new Date(),
        lastActive: new Date(),
      });

      // Register all event handlers
      this.userEvents.registerEvents(socket);
      this.messageEvents.registerEvents(socket);
      this.conversationEvents.registerEvents(socket);
      this.friendEvents.registerEvents(socket);

      // Join user personal room
      socket.join(`user:${userId}`);

      // Join conversation rooms
      socket.on("join-conversation", (conversationId) => {
        socket.join(`conversation:${conversationId}`);
      });

      socket.on("join-conversations", (ids) => {
        ids.forEach((id) => socket.join(`conversation:${id}`));
      });

      socket.on("heartbeat", () => {
        const user = this.connectedUsers.get(userId);
        if (user) {
          user.lastActive = new Date();
        }
        socket.emit("heartbeat-ack", { timestamp: new Date() });
      });

      socket.on("disconnect", async () => {
        this.messageEvents.removeUserSocket(userId, socket.id);
        const redis = this.io.opts.redisClient;
        if (redis) {
          // 1. Remove from Redis
          await redis.del(`status:${userId}`);
          console.log("data get delete from redis");
          // 2. Notify others
          socket.broadcast.emit("user-status-change", {
            userId,
            status: "offline",
          });
        }
        console.log(`❌ Socket disconnected: ${socket.id}`);
      });
    });
  }

  setupHealthCheck() {
    this.app.get("/health", (req, res) => {
      res.status(200).json({
        status: "OK",
        connectedUsers: this.connectedUsers.size,
        timestamp: new Date().toISOString(),
        socketConnections: this.io.engine.clientsCount,
      });
    });
  }

  async start(port = process.env.SOCKET_PORT || 5001) {
    try {
      await this.initializeDatabase();

      // Check if the server is already listening to prevent EADDRINUSE
      if (this.server.listening) {
        console.log("⚠️ Server is already listening. Skipping start.");
        return;
      }

      this.setupMiddleware();
      this.setupSocketEvents();
      this.setupHealthCheck();

      // Catch the error specifically on the server instance
      this.server.on("error", (e) => {
        if (e.code === "EADDRINUSE") {
          console.error(`❌ Port ${port} is busy. Retrying in 2 seconds...`);
          setTimeout(() => {
            this.server.close();
            this.server.listen(port);
          }, 2000);
        }
      });

      this.server.listen(port, () => {
        console.log(`🔌 Socket.IO Server running on port ${port}`);
      });
    } catch (err) {
      console.error("Critical Start Error:", err);
    }
  }

  stop() {
    this.io.close();
    this.server.close();
    mongoose.disconnect();
    console.log("Socket server stopped");
  }
}

module.exports = SocketServer;
