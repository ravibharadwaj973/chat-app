const mongoose = require('mongoose');
const {connection}=require("mongoose")

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    isGroup: {
      type: Boolean,
      default: false,
    },
    groupName: {
      type: String,
      trim: true,
    },
    groupAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    groupAvatar: {
      type: String,
      trim: true,
    },
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    mutedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    archivedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  unreadCount: {
  type: Map,
  of: Number,
  default: () => new Map()
},
    typingUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        typingAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    bannedUsers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        bannedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        bannedAt: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          trim: true,
        },
      },
    ],
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for better query performance
conversationSchema.index({ participants: 1 });
conversationSchema.index({ isGroup: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ 'mutedBy': 1 });
conversationSchema.index({ 'archivedBy': 1 });

// Virtual for messages
conversationSchema.virtual('messages', {
  ref: 'Message',
  localField: '_id',
  foreignField: 'conversationId',
});

// Virtual for last message details
conversationSchema.virtual('lastMessageDetails', {
  ref: 'Message',
  localField: 'lastMessage',
  foreignField: '_id',
  justOne: true,
});

module.exports = connection.model('Conversation', conversationSchema);