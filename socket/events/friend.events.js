const { FRIEND_EVENTS } = require('../../shared/constants');

class FriendEventsHandler {
  constructor(io) {
    this.io = io;

  }

  registerEvents(socket) {
    const userId = socket.userId;

    console.log(`🤝 Registering friend events for: ${userId}`);

    // Listen for friend request status updates (from client)
    socket.on('friend-request-seen', (data) => {
      this.handleFriendRequestSeen(data.requestId, userId);
    });

    // Listen for friend list refresh requests
    socket.on('refresh-friends', () => {
      this.emitToUser(userId, 'friends-list-updated', { timestamp: new Date() });
    });
  }

  // A) Friend Request Received
  async emitFriendRequestReceived(recipientId, requestData) {
    this.emitToUser(recipientId, FRIEND_EVENTS.REQUEST_RECEIVED, requestData);
  }

  // B) Friend Request Accepted
  async emitFriendRequestAccepted(senderId, requestData) {
    this.emitToUser(senderId, FRIEND_EVENTS.REQUEST_ACCEPTED, requestData);
  }

  // C) Friend Request Rejected
  async emitFriendRequestRejected(senderId, rejectionData) {
    this.emitToUser(senderId, FRIEND_EVENTS.REQUEST_REJECTED, rejectionData);
  }

  // D) Friend Added (when request accepted)
  async emitFriendAdded(userId, friendData) {
    this.emitToUser(userId, FRIEND_EVENTS.FRIEND_ADDED, friendData);
  }

  // E) Friend Removed
  async emitFriendRemoved(userId, removalData) {
    this.emitToUser(userId, FRIEND_EVENTS.FRIEND_REMOVED, removalData);
  }

  // F) Friend Request Cancelled
  async emitFriendRequestCancelled(recipientId, cancellationData) {
    this.emitToUser(recipientId, FRIEND_EVENTS.REQUEST_CANCELLED, cancellationData);
  }

  // G) User Blocked You
  async emitUserBlockedYou(userId, blockData) {
    this.emitToUser(userId, FRIEND_EVENTS.USER_BLOCKED_YOU, blockData);
  }

  // H) Friend Status Changed (online/offline)
  async emitFriendStatusChanged(userId, friendId, statusData) {
    this.emitToUser(userId, FRIEND_EVENTS.FRIEND_STATUS_CHANGED, {
      friendId,
      ...statusData
    });
  }

  // Helper method to emit to user
  emitToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date()
    });
  }

  // Handle friend request seen
  async handleFriendRequestSeen (requestId, userId) {
    console.log(`Friend request ${requestId} seen by user ${userId}`);
  
  }
}

module.exports = FriendEventsHandler;