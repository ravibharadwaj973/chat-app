const MessageEventsHandler = require('./message.events');
const UserEventsHandler = require('./user.events');
const ConversationEventsHandler = require('./conversation.events');

class EventRegistry {
  constructor(io) {
    this.io = io;
    this.messageHandler = new MessageEventsHandler(io);
    this.userHandler = new UserEventsHandler(io);
    this.conversationHandler = new ConversationEventsHandler(io);
  }

  registerAllEvents(socket) {
    // Register all event handlers
    this.messageHandler.registerEvents(socket);
    this.userHandler.registerEvents(socket);
    this.conversationHandler.registerEvents(socket);

    // Track user socket for multi-device support
    this.messageHandler.trackUserSocket(socket.userId, socket.id);

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User ${socket.userId} disconnected from socket ${socket.id}`);
      
      // Remove from tracking
      this.messageHandler.removeUserSocket(socket.userId, socket.id);
      
      // Update user status
      this.handleUserDisconnect(socket.userId);
    });
  }

  async handleUserDisconnect(userId) {
    // Check if user has any other active sockets
    const userSockets = this.messageHandler.userSockets.get(userId);
    
    if (!userSockets || userSockets.size === 0) {
      // No more active sockets, user is fully offline
      await this.userHandler.handleSetOffline(userId);
    }
  }
}

module.exports = EventRegistry;