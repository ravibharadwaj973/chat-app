const Notification = require("../../models/notification");
const User = require("../../models/user");

class NotificationEventsHandler {
  constructor(io) {
    this.io = io;
  }

  registerEvents(socket) {
    const userId = socket.userId;

    console.log(`🔔 Registering notification events for: ${userId}`);

    // Listen for notification seen/read via socket
    socket.on('notification:seen', async (data) => {
      await this.handleNotificationSeen(data.notificationId, userId);
    });

    socket.on('notification:mark-all-read', async () => {
      await this.handleMarkAllRead(userId);
    });
  }

  // SOCKET-ONLY: Emit new notification to user
  async emitNewNotification(recipientId, notificationData) {
    // First save to database
    const notification = await Notification.create({
      recipient: recipientId,
      ...notificationData
    });

    // Populate sender if exists
    if (notificationData.sender) {
      await notification.populate({
        path: 'sender',
        select: 'username avatar status online'
      });
    }

    // Check user notification settings
    const user = await User.findById(recipientId).select('notificationSettings');
    const settings = user.notificationSettings || {};
    
    // Check if this type of notification is enabled
    const typeEnabled = settings[notificationData.type] !== false;
    const desktopEnabled = settings.desktopNotifications !== false;
    const soundsEnabled = settings.sounds !== false;
    
    // Check quiet hours
    const inQuietHours = this.isInQuietHours(settings.quietHours);
    
    if (typeEnabled && desktopEnabled && !inQuietHours) {
      // Emit real-time notification via socket
      this.io.to(`user:${recipientId}`).emit('notification:new', {
        _id: notification._id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        sender: notification.sender,
        data: notification.data,
        createdAt: notification.createdAt,
        read: notification.read
      });

      // Emit sound notification if enabled
      if (soundsEnabled) {
        this.io.to(`user:${recipientId}`).emit('notification:sound', {
          type: notification.type
        });
      }
    }

    return notification;
  }

  // SOCKET-ONLY: Friend Request Notification
  async emitFriendRequestNotification(recipientId, senderId, requestId) {
    const sender = await User.findById(senderId).select('username avatar');
    
    return this.emitNewNotification(recipientId, {
      type: 'friend_request',
      title: 'New Friend Request',
      body: `${sender.username} sent you a friend request`,
      sender: senderId,
      data: { requestId }
    });
  }

  // SOCKET-ONLY: Friend Request Accepted
  async emitFriendRequestAccepted(senderId, recipientId) {
    const recipient = await User.findById(recipientId).select('username avatar');
    
    return this.emitNewNotification(senderId, {
      type: 'friend_request_accepted',
      title: 'Friend Request Accepted',
      body: `${recipient.username} accepted your friend request`,
      sender: recipientId,
      data: {}
    });
  }

  // SOCKET-ONLY: New Message Notification
  async emitNewMessageNotification(recipientId, senderId, conversationId, content) {
    const sender = await User.findById(senderId).select('username avatar');
    
    return this.emitNewNotification(recipientId, {
      type: 'message',
      title: 'New Message',
      body: content.length > 50 ? `${content.substring(0, 50)}...` : content,
      sender: senderId,
      data: { conversationId }
    });
  }

  // SOCKET-ONLY: Group Invite Notification
  async emitGroupInviteNotification(recipientId, senderId, groupId, groupName) {
    const sender = await User.findById(senderId).select('username avatar');
    
    return this.emitNewNotification(recipientId, {
      type: 'group_invite',
      title: 'Group Invitation',
      body: `${sender.username} invited you to join ${groupName}`,
      sender: senderId,
      data: { groupId, groupName }
    });
  }

  // SOCKET-ONLY: Call Notification
  async emitCallNotification(recipientId, senderId, callType) {
    const sender = await User.findById(senderId).select('username avatar');
    const callTypeText = callType === 'video' ? 'Video Call' : 'Voice Call';
    
    return this.emitNewNotification(recipientId, {
      type: 'call',
      title: `Missed ${callTypeText}`,
      body: `${sender.username} called you`,
      sender: senderId,
      data: { callType }
    });
  }

  // SOCKET-ONLY: Group Update Notification
  async emitGroupUpdateNotification(recipientId, groupId, updateType, data) {
    const updateTitles = {
      'user_added': 'User Added to Group',
      'user_removed': 'User Removed from Group',
      'name_changed': 'Group Name Changed',
      'admin_changed': 'Group Admin Changed'
    };
    
    return this.emitNewNotification(recipientId, {
      type: 'group_update',
      title: updateTitles[updateType] || 'Group Updated',
      body: this.getGroupUpdateMessage(updateType, data),
      data: { groupId, updateType, ...data }
    });
  }

  // Helper: Handle notification seen via socket
  async handleNotificationSeen(notificationId, userId) {
    await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { read: true }
    );
  }

  // Helper: Handle mark all as read via socket
  async handleMarkAllRead(userId) {
    await Notification.updateMany(
      { recipient: userId, read: false },
      { read: true }
    );
    
    this.io.to(`user:${userId}`).emit('notification:all-read');
  }

  // Helper: Check quiet hours
  isInQuietHours(quietHours) {
    if (!quietHours || !quietHours.enabled) return false;
    
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const start = this.timeToMinutes(quietHours.start);
    const end = this.timeToMinutes(quietHours.end);
    
    if (start <= end) {
      return currentTime >= start && currentTime < end;
    } else {
      return currentTime >= start || currentTime < end;
    }
  }

  // Helper: Convert time string to minutes
  timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Helper: Get group update message
  getGroupUpdateMessage(updateType, data) {
    switch (updateType) {
      case 'user_added':
        return `${data.addedByUsername} added ${data.addedUsername} to the group`;
      case 'user_removed':
        return `${data.removedByUsername} removed ${data.removedUsername} from the group`;
      case 'name_changed':
        return `Group name changed to "${data.newName}"`;
      case 'admin_changed':
        return `${data.newAdminUsername} is now the group admin`;
      default:
        return 'Group has been updated';
    }
  }
}

module.exports = NotificationEventsHandler;