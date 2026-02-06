const Message = require("../../models/message");
const Conversation = require("../../models/conversation");
const User = require("../../models/user");
const { MESSAGE_EVENTS } = require("../../shared/constants");

class MessageEventsHandler {
  constructor(io) {
    this.io = io;
    this.userSockets = new Map(); // userId -> socketId(s)
  }

  registerEvents(socket) {
    const userId = socket.userId;

    console.log(`📨 Registering message events for user: ${userId}`);

    // 1️⃣ Send Message Event
    socket.on(MESSAGE_EVENTS.SEND_MESSAGE, async (data, callback) => {
      console.log(`📤 Send message from ${userId}:`, data.conversationId);
      try {
        const result = await this.handleSendMessage(data, userId);

        // Send acknowledgment to sender
        if (callback) {
          callback({
            success: true,
            data: result.message,
            messageId: result.message._id,
          });
        }

        // Emit to sender's other devices
        this.emitToUser(userId, MESSAGE_EVENTS.MESSAGE_SENT, {
          message: result.message,
          conversationId: data.conversationId,
        });
      } catch (error) {
        console.error("Send message error:", error);
        if (callback) {
          callback({ success: false, error: error.message });
        }
        socket.emit(MESSAGE_EVENTS.MESSAGE_ERROR, { error: error.message });
      }
    });

    // 2️⃣ Mark Message as Delivered
    socket.on(MESSAGE_EVENTS.MESSAGE_DELIVERED, async (data) => {
      console.log(`📬 Message delivered: ${data.messageId} by ${userId}`);
      try {
        await this.handleMessageDelivered(data.messageId, userId);
      } catch (error) {
        console.error("Mark delivered error:", error);
      }
    });

    // 3️⃣ Mark Message as Read
    socket.on(MESSAGE_EVENTS.MESSAGE_READ, async (data) => {
      console.log(`👁️ Message read: ${data.messageId} by ${userId}`);
      try {
        await this.handleMessageRead(
          data.messageId,
          userId,
          data.conversationId,
        );
      } catch (error) {
        console.error("Mark read error:", error);
      }
    });

    // 4️⃣ Add Reaction to Message
    socket.on(MESSAGE_EVENTS.ADD_REACTION, async (data, callback) => {
      console.log(
        `❤️ Add reaction: ${data.messageId} with ${data.emoji} by ${userId}`,
      );
      try {
        const reaction = await this.handleAddReaction(
          data.messageId,
          userId,
          data.emoji,
        );

        if (callback) {
          callback({ success: true, data: reaction });
        }
      } catch (error) {
        console.error("Add reaction error:", error);
        if (callback) {
          callback({ success: false, error: error.message });
        }
        socket.emit(MESSAGE_EVENTS.REACTION_ERROR, { error: error.message });
      }
    });

    // 5️⃣ Remove Reaction from Message
    socket.on(MESSAGE_EVENTS.REMOVE_REACTION, async (data, callback) => {
      console.log(`❌ Remove reaction: ${data.messageId} by ${userId}`);
      try {
        await this.handleRemoveReaction(
          data.messageId,
          data.reactionId,
          userId,
        );

        if (callback) {
          callback({ success: true });
        }
      } catch (error) {
        console.error("Remove reaction error:", error);
        if (callback) {
          callback({ success: false, error: error.message });
        }
      }
    });

    // 6️⃣ Reply to Message
    socket.on(MESSAGE_EVENTS.REPLY_MESSAGE, async (data, callback) => {
      console.log(`↩️ Reply to message: ${data.messageId} by ${userId}`);
      try {
        const reply = await this.handleReplyMessage(
          data.messageId,
          userId,
          data.content,
          data.messageType,
        );

        if (callback) {
          callback({ success: true, data: reply });
        }
      } catch (error) {
        console.error("Reply message error:", error);
        if (callback) {
          callback({ success: false, error: error.message });
        }
        socket.emit(MESSAGE_EVENTS.REPLY_ERROR, { error: error.message });
      }
    });

    // 7️⃣ Delete Message
    socket.on(MESSAGE_EVENTS.DELETE_MESSAGE, async (data, callback) => {
      console.log(
        `🗑️ Delete message: ${data.messageId} by ${userId} (forEveryone: ${data.deleteForEveryone})`,
      );
      try {
        await this.handleDeleteMessage(
          data.messageId,
          userId,
          data.deleteForEveryone,
        );

        if (callback) {
          callback({ success: true });
        }
      } catch (error) {
        console.error("Delete message error:", error);
        if (callback) {
          callback({ success: false, error: error.message });
        }
        socket.emit(MESSAGE_EVENTS.DELETE_ERROR, { error: error.message });
      }
    });

    // Typing Events
    socket.on(MESSAGE_EVENTS.TYPING_START, (data) => {
      console.log(
        `⌨️ Typing start in conversation: ${data.conversationId} by ${userId}`,
      );
      this.handleTypingStart(data.conversationId, userId);
    });

    socket.on(MESSAGE_EVENTS.TYPING_STOP, (data) => {
      console.log(
        `⏹️ Typing stop in conversation: ${data.conversationId} by ${userId}`,
      );
      this.handleTypingStop(data.conversationId, userId);
    });
  }

  // 🔧 Helper Methods

  async handleSendMessage(data, userId) {
    const {
      conversationId,
      content,
      messageType = "text",
      mediaUrl,
      repliedTo,
    } = data;

    // Validate conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Check if sender is a participant
    if (!conversation.participants.includes(userId)) {
      throw new Error("Not a participant");
    }

    // Validate repliedTo if provided
    if (repliedTo) {
      const repliedMessage = await Message.findOne({
        _id: repliedTo,
        conversationId,
        deleted: false,
      });
      if (!repliedMessage) {
        throw new Error("Replied message not found");
      }
    }

    // Create message
    const message = await Message.create({
      conversationId,
      sender: userId,
      content,
      messageType,
      mediaUrl,
      repliedTo,
    });

    // Populate sender details
    await message.populate({
      path: "repliedTo",
      populate: { path: "sender", select: "username avatar" },
    });

    // Update conversation
    conversation.lastMessage = message._id;

    // Increment unread count for recipients
    conversation.participants.forEach((participantId) => {
      if (participantId.toString() !== userId.toString()) {
        const currentCount =
          conversation.unreadCount.get(participantId.toString()) || 0;
        conversation.unreadCount.set(
          participantId.toString(),
          currentCount + 1,
        );
      }
    });

    await conversation.save();

    // Get sender details
    const sender = await User.findById(userId).select("username avatar");

    // Prepare message data
    const messageData = {
      ...message.toObject(),
      sender: {
        _id: sender._id,
        username: sender.username,
        avatar: sender.avatar,
      },
    };

    // Broadcast to conversation participants (except sender on this device)
    conversation.participants.forEach((participantId) => {
      if (participantId.toString() !== userId.toString()) {
        this.emitToUser(participantId, MESSAGE_EVENTS.NEW_MESSAGE, {
          message: messageData,
          conversationId,
          unreadCount:
            conversation.unreadCount.get(participantId.toString()) || 0,
        });
      }
    });

    // Emit to conversation room for real-time updates
    this.io
      .to(`conversation:${conversationId}`)
      .emit(MESSAGE_EVENTS.NEW_MESSAGE, {
        message: messageData,
        conversationId,
      });

    return { message: messageData, conversation };
  }

  async handleMessageDelivered(messageId, userId) {
    const message = await Message.findById(messageId);
    if (!message) return;

    // Check if already delivered to this user
    const alreadyDelivered = message.deliveredTo.some(
      (delivery) => delivery.userId.toString() === userId,
    );

    if (!alreadyDelivered) {
      // Update in database
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: {
          deliveredTo: {
            userId: userId,
            deliveredAt: new Date(),
          },
        },
      });

      // Notify sender
      this.emitToUser(message.sender, MESSAGE_EVENTS.MESSAGE_DELIVERY_UPDATE, {
        messageId,
        userId,
        deliveredAt: new Date(),
      });
    }
  }

  async handleMessageRead(messageId, userId, conversationId) {
    const [message, conversation] = await Promise.all([
      Message.findById(messageId),
      Conversation.findById(conversationId),
    ]);

    if (!message || !conversation) return;

    // Check if already read by this user
    const alreadyRead = message.readBy.some(
      (read) => read.userId.toString() === userId,
    );

    if (!alreadyRead) {
      // Update in database
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: {
          readBy: {
            userId: userId,
            readAt: new Date(),
          },
        },
      });

      // Update conversation unread count
      const currentCount = conversation.unreadCount.get(userId.toString()) || 0;
      if (currentCount > 0) {
        conversation.unreadCount.set(userId.toString(), currentCount - 1);
        await conversation.save();
      }

      // Notify sender if different from reader
      if (message.sender.toString() !== userId) {
        this.emitToUser(message.sender, MESSAGE_EVENTS.MESSAGE_READ_UPDATE, {
          messageId,
          userId,
          readAt: new Date(),
          conversationId,
        });
      }

      // Emit to conversation room
      this.io
        .to(`conversation:${conversationId}`)
        .emit(MESSAGE_EVENTS.MESSAGE_READ_UPDATE, {
          messageId,
          userId,
        });
    }
  }

  async handleAddReaction(messageId, userId, emoji) {
    const message = await Message.findById(messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // Check if user already reacted with this emoji
    const existingReaction = message.reactions.find(
      (reaction) =>
        reaction.user.toString() === userId && reaction.emoji === emoji,
    );

    if (existingReaction) {
      throw new Error("Already reacted with this emoji");
    }

    // Add reaction
    message.reactions.push({
      user: userId,
      emoji: emoji.trim(),
      addedAt: new Date(),
    });

    await message.save();

    // Populate user details
    await message.populate({
      path: "reactions.user",
      select: "username avatar",
    });

    // Get the newly added reaction
    const newReaction = message.reactions[message.reactions.length - 1];

    // Broadcast to conversation
    this.io
      .to(`conversation:${message.conversationId}`)
      .emit(MESSAGE_EVENTS.REACTION_ADDED, {
        messageId,
        reaction: newReaction,
        conversationId: message.conversationId,
      });

    return newReaction;
  }

  async handleRemoveReaction(messageId, reactionId, userId) {
    const message = await Message.findById(messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // Find the reaction
    const reactionIndex = message.reactions.findIndex(
      (reaction) =>
        reaction._id.toString() === reactionId &&
        reaction.user.toString() === userId,
    );

    if (reactionIndex === -1) {
      throw new Error("Reaction not found");
    }

    // Remove reaction
    message.reactions.splice(reactionIndex, 1);
    await message.save();

    // Broadcast to conversation
    this.io
      .to(`conversation:${message.conversationId}`)
      .emit(MESSAGE_EVENTS.REACTION_REMOVED, {
        messageId,
        reactionId,
        userId,
        conversationId: message.conversationId,
      });
  }

  async handleReplyMessage(
    originalMessageId,
    userId,
    content,
    messageType = "text",
  ) {
    // Get the original message
    const originalMessage = await Message.findById(originalMessageId).populate(
      "sender",
      "username avatar",
    );

    if (!originalMessage) {
      throw new Error("Original message not found");
    }

    // Create reply using handleSendMessage
    const replyData = {
      conversationId: originalMessage.conversationId,
      content,
      messageType,
      repliedTo: originalMessageId,
    };

    const result = await this.handleSendMessage(replyData, userId);

    // Emit special reply event
    this.io
      .to(`conversation:${originalMessage.conversationId}`)
      .emit("message-reply", {
        originalMessageId,
        replyMessage: result.message,
        conversationId: originalMessage.conversationId,
      });

    return result.message;
  }

  async handleDeleteMessage(messageId, userId, deleteForEveryone = false) {
    const message = await Message.findById(messageId);
    if (!message) {
      throw new Error("Message not found");
    }

    // Check permissions
    const conversation = await Conversation.findOne({
      _id: message.conversationId,
      participants: userId,
    });

    if (!conversation) {
      throw new Error("Not a participant");
    }

    if (deleteForEveryone) {
      // Check if user is admin or sender
      const isSender = message.sender.toString() === userId;
      const isGroupAdmin = conversation.groupAdmin?.toString() === userId;

      if (!isSender && !isGroupAdmin && conversation.isGroup) {
        throw new Error("Only sender or group admin can delete for everyone");
      }

      // Delete for everyone
      await Message.findByIdAndUpdate(messageId, {
        deleted: true,
        deletedAt: new Date(),
        deletedBy: userId,
        content:
          message.messageType === "text" ? "This message was deleted" : null,
        mediaUrl: null,
        fileName: null,
        fileSize: null,
      });

      // Broadcast to conversation
      this.io
        .to(`conversation:${message.conversationId}`)
        .emit(MESSAGE_EVENTS.MESSAGE_DELETED_FOR_EVERYONE, {
          messageId,
          deletedBy: userId,
          deletedAt: new Date(),
          conversationId: message.conversationId,
        });
    } else {
      // Delete for me only
      await Message.findByIdAndUpdate(messageId, {
        $addToSet: { deletedBy: userId },
      });

      // Notify sender that user deleted the message
      if (message.sender.toString() !== userId) {
        this.emitToUser(message.sender, "message-deleted-by-recipient", {
          messageId,
          deletedBy: userId,
          conversationId: message.conversationId,
        });
      }

      // Broadcast to conversation
      this.io
        .to(`conversation:${message.conversationId}`)
        .emit(MESSAGE_EVENTS.MESSAGE_DELETED, {
          messageId,
          deletedBy: userId,
          deletedAt: new Date(),
          conversationId: message.conversationId,
        });
    }
  }

  handleTypingStart(conversationId, userId) {
    this.io
      .to(`conversation:${conversationId}`)
      .emit(MESSAGE_EVENTS.USER_TYPING, {
        userId,
        conversationId,
        typing: true,
      });
  }

  handleTypingStop(conversationId, userId) {
    this.io
      .to(`conversation:${conversationId}`)
      .emit(MESSAGE_EVENTS.USER_TYPING, {
        userId,
        conversationId,
        typing: false,
      });
  }

  // Helper to emit to all user's sockets (multiple devices)
  emitToUser(userId, event, data) {
    const userSockets = this.userSockets.get(userId.toString());
    if (userSockets) {
      userSockets.forEach((socketId) => {
        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.emit(event, data);
        }
      });
    }
  }

  // Track user sockets
  trackUserSocket(userId, socketId) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId).add(socketId);
  }

  removeUserSocket(userId, socketId) {
    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }
}

module.exports = MessageEventsHandler;
