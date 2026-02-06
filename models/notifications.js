const mongoose = require("mongoose");
const {connection}=require("mongoose")
const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
  require:true,
      index: true, // Add index for faster queries
    },
    type: {
      type: String,
      enum: [
        "friend_request", 
        "friend_request_accepted", 
        "message", 
        "call", 
        "group_invite", 
        "group_update", 
        "system",
        "mention"
      ],
      required: true,
      index: true, // Add index for faster queries
    },
    title: {
      type: String,
      trim: true,
      required: true,
    },
    body: {
      type: String,
      trim: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Use data field instead of relatedId for more flexibility
    data: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {}
    },
    read: {
      type: Boolean,
      default: false,
      index: true, // Add index for faster queries
    },
    expiresAt: {
      type: Date,
      default: function() {
        // Auto-expire after 30 days for most notifications
        const date = new Date();
        date.setDate(date.getDate() + 30);
        return date;
      },
      index: { expires: 0 }, // TTL index for auto-deletion
    },
    // Add metadata for better querying
    metadata: {
      conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
      },
      messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
      },
      requestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "FriendRequest",
      },
      groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
      },
      callId: String,
    }
  },
  { 
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Add virtual fields for backward compatibility
notificationSchema.virtual('relatedId').get(function() {
  // Map data field to relatedId for backward compatibility
  if (this.type === 'friend_request' && this.data?.requestId) {
    return this.data.requestId;
  }
  if (this.type === 'message' && this.data?.messageId) {
    return this.data.messageId;
  }
  if (this.type === 'group_invite' && this.data?.groupId) {
    return this.data.groupId;
  }
  if (this.type === 'call' && this.data?.callId) {
    return this.data.callId;
  }
  return null;
});

// Virtual for time ago
notificationSchema.virtual('timeAgo').get(function() {
  const seconds = Math.floor((new Date() - this.createdAt) / 1000);
  
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + " years ago";
  
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + " months ago";
  
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + " days ago";
  
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + " hours ago";
  
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + " minutes ago";
  
  return Math.floor(seconds) + " seconds ago";
});

// Virtual for formatted date
notificationSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

// Add indexes for common queries
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, read: 1 });
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Pre-save middleware to set metadata from data
notificationSchema.pre('save', function(next) {
  if (this.data) {
    this.metadata = {
      conversationId: this.data.conversationId || null,
      messageId: this.data.messageId || null,
      requestId: this.data.requestId || null,
      groupId: this.data.groupId || null,
      callId: this.data.callId || null,
    };
  }
  next();
});

// Static method to create notification with proper defaults
notificationSchema.statics.createNotification = async function(data) {
  const notificationData = {
    recipient: data.recipient,
    type: data.type,
    title: data.title,
    body: data.body,
    sender: data.sender || null,
    data: data.data || {},
    read: data.read || false,
    expiresAt: data.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
  };

  return this.create(notificationData);
};

// Method to mark as read
notificationSchema.methods.markAsRead = async function() {
  this.read = true;
  return this.save();
};

// Method to get action buttons based on type
notificationSchema.methods.getActions = function() {
  const actions = {
    friend_request: [
      { id: 'accept', label: 'Accept', variant: 'success', action: 'friend_request_accept' },
      { id: 'reject', label: 'Reject', variant: 'danger', action: 'friend_request_reject' },
      { id: 'view_profile', label: 'View Profile', variant: 'secondary', action: 'view_profile' }
    ],
    friend_request_accepted: [
      { id: 'message', label: 'Message', variant: 'primary', action: 'start_conversation' },
      { id: 'view_profile', label: 'View Profile', variant: 'secondary', action: 'view_profile' }
    ],
    message: [
      { id: 'view_message', label: 'View Message', variant: 'primary', action: 'view_message' },
      { id: 'reply', label: 'Reply', variant: 'secondary', action: 'reply_message' }
    ],
    call: [
      { id: 'call_back', label: 'Call Back', variant: 'success', action: 'call_back' },
      { id: 'send_message', label: 'Send Message', variant: 'secondary', action: 'send_message' }
    ],
    group_invite: [
      { id: 'accept_invite', label: 'Join Group', variant: 'success', action: 'accept_group_invite' },
      { id: 'decline_invite', label: 'Decline', variant: 'danger', action: 'decline_group_invite' },
      { id: 'view_group', label: 'View Group', variant: 'secondary', action: 'view_group' }
    ],
    group_update: [
      { id: 'view_group', label: 'View Group', variant: 'primary', action: 'view_group' }
    ],
    mention: [
      { id: 'view_message', label: 'View Message', variant: 'primary', action: 'view_message' },
      { id: 'reply', label: 'Reply', variant: 'secondary', action: 'reply_message' }
    ],
    system: [
      { id: 'view_details', label: 'View Details', variant: 'secondary', action: 'view_system_details' }
    ]
  };

  return actions[this.type] || [];
};

const Notification = connection.models.Notification || connection.model("Notification", notificationSchema);

module.exports = Notification;