const Message = require("../../models/message");
const Conversation = require("../../models/conversation");
const mongoose = require("mongoose");
const redisClient =require("../lib/redis")


const sendMessage = async (req, res) => {
  try {
    const { content, conversationId, type, mediaUrl = null, repliedTo = null } = req.body;
    const userId = req.user.id;

    // 1. Verify conversation exists and user is a participant
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({ success: false, error: "Conversation not found." });
    }

    // 2. Create and save message
    const newMessage = new Message({
      conversationId,
      sender: userId,
      content,
      messageType: type || "text",
      mediaUrl,
      repliedTo: repliedTo || null, // Ensure this matches your Schema field name
    });
    await newMessage.save();

    // 3. Populate correctly (Using the field name 'repliedTo')
    const populatedMessage = await Message.findById(newMessage._id)
      .populate("sender", "username avatar")
      .populate({
        path: "repliedTo",
        populate: { path: "sender", select: "username avatar" },
      });

    // 4. Update conversation metadata
    conversation.lastMessage = newMessage._id;
    // You should know this: We increment unread count for everyone EXCEPT the sender
    conversation.participants.forEach(pId => {
      if (pId.toString() !== userId.toString()) {
        const currentCount = conversation.unreadCount.get(pId.toString()) || 0;
        conversation.unreadCount.set(pId.toString(), currentCount + 1);
      }
    });
    await conversation.save();

    // 5. --- SOCKET REAL-TIME NOTIFICATION ---
    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      // Send to the conversation room (includes everyone currently looking at the chat)
      socketServer.io.to(`conversation:${conversationId}`).emit("new-message", populatedMessage);
      
      // Notify participants who aren't in the room to update their sidebar/unread count
      conversation.participants.forEach(pId => {
        if (pId.toString() !== userId.toString()) {
          socketServer.io.to(`user:${pId}`).emit("update-conversation-list", {
            conversationId,
            lastMessage: populatedMessage,
          });
        }
      });
    }

    // 6. --- REDIS CACHE INVALIDATION ---
    const redis = req.app.get("redis");
    if (redis) {
      // Clear conversation list cache for all participants so they see the new "lastMessage"
      const clearCachePromises = conversation.participants.map(pId => 
        redis.del(`conversations:${pId}`)
      );
      await Promise.all(clearCachePromises);
    }

    return res.status(201).json({
      success: true,
      data: populatedMessage,
    });

  } catch (err) {
    console.error("Send Message Error:", err);
    return res.status(500).json({ success: false, error: "Failed to send message." });
  }
};
// -------------------------
// 1. GET MESSAGE HISTORY
// -------------------------
const getmessage = async (req,res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    // Validate conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    // Fetch messages
    const messages = await Message.find({ conversationId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", "username avatar")
      .populate({
        path: "repliedTo",
        select: "content sender type mediaUrl",
        populate: { path: "sender", select: "username avatar" },
      });

    const total = await Message.countDocuments({ conversationId });

    res.status(200).json({
      success: true,
      page,
      totalPages: Math.ceil(total / limit),
      count: messages.length,
      data: messages.reverse(),
    });
  } catch (err) {
    console.error("Get Messages Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages.",
    });
  }
};

// -------------------------
// 2. SEARCH MESSAGES
// -------------------------
const searchmessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        error: "Search query is required.",
      });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    const messages = await Message.find({
      conversationId,
      content: { $regex: query, $options: "i" },
    })
      .sort({ createdAt: -1 })
      .populate("sender", "username avatar");

    res.status(200).json({
      success: true,
      count: messages.length,
      data: messages,
    });
  } catch (err) {
    console.error("Search Messages Error:", err);
    res.status(500).json({
      success: false,
      error: "Search failed.",
    });
  }
};

// -------------------------
// 3. GET SINGLE MESSAGE
// -------------------------
const getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await Message.findById(messageId)
      .populate("sender", "username avatar")
      .populate({
        path: "repliedTo",
        select: "content sender type mediaUrl",
        populate: { path: "sender", select: "username avatar" },
      });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    res.status(200).json({
      success: true,
      data: message,
    });
  } catch (err) {
    console.error("Get Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch message.",
    });
  }
};

// -------------------------
// 4. DELETE MESSAGE (HTTP)
// -------------------------
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    console.log(messageId)
    const userId = req.user.id;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    if (message.sender.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: "You can delete only your own messages.",
      });
    }

    message.deleted = true;
    message.deletedAt = new Date();
    message.content = "This message was deleted";
    message.mediaUrl = null;

    await message.save();

    res.status(200).json({
      success: true,
      message: "Message deleted.",
    });
  } catch (err) {
    console.error("Delete Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete message.",
    });
  }
};
module.exports = {
  sendMessage,
  getMessageById,
  deleteMessage,
  getmessage,
  searchmessage,
};
{/**
   console.log(conversation.participants)
    const participantArray = conversation.participants || [];
   
    const recipients = participantArray.filter(
      (p) => p.toString() !== userId.toString()
    );

    // Create notifications and publish to Redis if there are recipients
    if (recipients.length > 0) {
      const notificationPromises = recipients.map(async (recipientId) => {
        if (!recipientId) return null;

        return await Notification.create({
          recipient: "697c3faa070b5310004252a0",
          sender: userId,
          type: "message",
          title: `New message from ${populatedMessage.sender.username}`,
          body: content.length > 50 ? content.substring(0, 47) + "..." : content,
          data: {
            conversationId: conversationId,
            messageId: newMessage._id,
          }
        });
      });

      const savedNotifications = await Promise.all(notificationPromises);

      // Publish each notification to Redis
      savedNotifications.forEach(async (notif) => {
        if (notif) {
          await redisClient.publish('NEW_NOTIFICATION', JSON.stringify({
            recipientId: notif.recipient.toString(),
            notification: notif
          }));
        }
      });
    }
 */}