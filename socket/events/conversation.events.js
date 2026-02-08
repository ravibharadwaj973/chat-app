const Conversation = require("../../models/conversation");
const {
  CONVERSATION_EVENTS,
  MESSAGE_EVENTS,
} = require("../../shared/constants");

class ConversationEventsHandler {
  constructor(io) {
    this.io = io;
  }

  registerEvents(socket) {
    const userId = socket.userId;

    console.log(`💬 Registering conversation events for: ${userId}`);

    socket.on(CONVERSATION_EVENTS.JOIN_CONVERSATION, async (conversationId) => {
      await this.handleJoinConversation(conversationId, userId, socket);
    });

    socket.on(CONVERSATION_EVENTS.LEAVE_CONVERSATION, (conversationId) => {
      this.handleLeaveConversation(conversationId, socket);
    });

    // 3️⃣ Typing Indicators
    socket.on("typing-start", (data) => {
      this.handleTypingStart(data.conversationId, userId, socket);
    });

    socket.on("typing-stop", (data) => {
      this.handleTypingStop(data.conversationId, userId, socket);
    });
  }

  // 1️⃣ Join Conversation Room
  async handleJoinConversation(conversationId, userId, socket) {
    try {
      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: userId,
      });
const cleanId = conversationId.replace('conversation:', '');
      if (!conversation) {
        socket.emit("conversation-error", { error: "Not a participant" });
        return;
      }

      // Join the conversation room
      socket.join(conversationId.toString());

      // Join user's personal room for targeted messaging
      socket.join(`user:${userId}`);

      console.log(`👥 User ${userId} joined conversation ${conversationId}`);

      // Send confirmation
      const roomName = `conversation:${cleanId}`;
      socket.join(roomName);

      // 1. To the person who joined (Private confirmation)
      socket.emit("conversation-joined", { conversationId: cleanId });

      // 2. To EVERYONE ELSE in the room (The other person)
      socket.to(roomName).emit("user-entered-chat", {
        userId: userId,
        message: "Someone joined the chat",
      });

      // Notify others in conversation (optional)
      socket
        .to(`conversation:${conversationId}`)
        .emit(CONVERSATION_EVENTS.USER_JOINED, {
          userId,
          conversationId,
          joinedAt: new Date(),
        });
    } catch (error) {
      console.error("Join conversation error:", error);
      socket.emit("conversation-error", {
        error: "Failed to join conversation",
      });
    }
  }

  // 2️⃣ Leave Conversation Room
  handleLeaveConversation(conversationId, socket) {
    socket.leave(conversationId.toString());
    console.log(`User left conversation ${conversationId}`);

    // Notify others (optional)
    socket
      .to(`conversation:${conversationId}`)
      .emit(CONVERSATION_EVENTS.USER_LEFT, {
        userId: socket.userId,
        conversationId,
        leftAt: new Date(),
      });
  }

  // 3️⃣ Typing Indicators
  handleTypingStart(conversationId, userId, socket) {
  
  socket.to(`conversation:${conversationId}`).emit("user-typing", {
    userId,
    conversationId,
    typing: true,
  });
}

// 2. When the user stops typing
handleTypingStop(conversationId, userId, socket) {
  socket.to(`conversation:${conversationId}`).emit("user-typing", {
    userId,
    conversationId,
    typing: false,
  });
}

  // 📢 Broadcast Conversation Updates (Called from HTTP routes via socket)
  async broadcastConversationUpdate(conversationId, updateType, data) {
    try {
      const eventMap = {
        "user-added": CONVERSATION_EVENTS.USER_ADDED,
        "user-removed": CONVERSATION_EVENTS.USER_REMOVED,
        "name-changed": CONVERSATION_EVENTS.NAME_CHANGED,
        "avatar-changed": CONVERSATION_EVENTS.AVATAR_CHANGED,
        "admin-changed": CONVERSATION_EVENTS.ADMIN_CHANGED,
        "user-banned": CONVERSATION_EVENTS.USER_BANNED,
        "user-unbanned": CONVERSATION_EVENTS.USER_UNBANNED,
      };

      const event = eventMap[updateType];
      if (!event) {
        console.error("Unknown update type:", updateType);
        return;
      }

      // Emit to all participants in the conversation
      this.io.to(`conversation:${conversationId}`).emit(event, {
        conversationId,
        ...data,
        updatedAt: new Date(),
      });

      console.log(
        `📢 Broadcast ${updateType} for conversation ${conversationId}`,
      );
    } catch (error) {
      console.error("Broadcast conversation update error:", error);
    }
  }

  // 📢 Broadcast New Message (Called from message events)
  broadcastNewMessage(conversationId, messageData) {
    this.io
      .to(`conversation:${conversationId}`)
      .emit(MESSAGE_EVENTS.NEW_MESSAGE, {
        conversationId,
        message: messageData,
        timestamp: new Date(),
      });
  }

  // 📢 Broadcast Message Read Status
  broadcastMessageRead(conversationId, messageId, userId) {
    this.io
      .to(`conversation:${conversationId}`)
      .emit(MESSAGE_EVENTS.MESSAGE_READ_UPDATE, {
        conversationId,
        messageId,
        userId,
        readAt: new Date(),
      });
  }

  // 📢 Broadcast Message Delivery Status
  broadcastMessageDelivered(conversationId, messageId, userId) {
    this.io
      .to(`conversation:${conversationId}`)
      .emit(MESSAGE_EVENTS.MESSAGE_DELIVERY_UPDATE, {
        conversationId,
        messageId,
        userId,
        deliveredAt: new Date(),
      });
  }

  // 📢 Broadcast Presence Updates
  broadcastUserPresence(userId, status, online) {
    this.io.emit("user-presence-update", {
      userId,
      status,
      online,
      lastSeen: new Date(),
    });
  }
}

module.exports = ConversationEventsHandler;
