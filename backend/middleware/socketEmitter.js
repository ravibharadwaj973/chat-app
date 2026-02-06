// This middleware attaches a socket emitter to requests
// Since we're running Socket.IO on a separate server,
// we'll implement HTTP-to-socket communication via REST calls
// or use Redis Pub/Sub for communication between servers

const axios = require('axios');

class SocketEmitter {
  constructor(socketServerUrl = null) {
    this.socketServerUrl = socketServerUrl || process.env.SOCKET_SERVER_URL;
  }

  // Emit event to socket server via HTTP
  async emitToUser(userId, event, data) {
    if (!this.socketServerUrl) {
      console.warn('Socket server URL not configured');
      return;
    }

    try {
      await axios.post(`${this.socketServerUrl}/api/emit`, {
        userId,
        event,
        data,
      }, {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Failed to emit socket event:', error.message);
    }
  }

  // Emit to multiple users
  async emitToUsers(userIds, event, data) {
    if (!this.socketServerUrl) return;
    
    for (const userId of userIds) {
      await this.emitToUser(userId, event, data);
    }
  }

  // Broadcast to conversation room
  async emitToConversation(conversationId, event, data) {
    if (!this.socketServerUrl) return;
    
    try {
      await axios.post(`${this.socketServerUrl}/api/emit/conversation`, {
        conversationId,
        event,
        data,
      });
    } catch (error) {
      console.error('Failed to emit to conversation:', error.message);
    }
  }
}

// Middleware to attach socketEmitter to requests
const socketEmitter = (socketServerUrl) => {
  const emitter = new SocketEmitter(socketServerUrl);
  
  return (req, res, next) => {
    req.socketEmitter = emitter;
    next();
  };
};

module.exports = socketEmitter;