const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");

const {
  getmessage,
  searchmessage,
  getMessageById,
  deleteMessage,
  sendMessage
} = require("../../backend/controllers/message.controller");

// All message APIs require auth
router.use(authenticate);

// Fetch messages
router.get("/:conversationId", getmessage);
router.post("/send", sendMessage);

// Search messages
router.get("/:conversationId/search", searchmessage);

// Get single message
router.get("/single/:messageId", getMessageById);

// Delete message
router.delete("/:messageId", deleteMessage);

module.exports = router;
