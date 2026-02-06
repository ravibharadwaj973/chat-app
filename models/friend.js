const mongoose = require('mongoose');
const {connection}=require('mongoose')

const friendRequestSchema = new mongoose.Schema(
  {
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "blocked"],
      default: "pending",
    },
    message: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    blockedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
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

// Compound index for unique pending requests
friendRequestSchema.index({ from: 1, to: 1, status: 1 }, { 
  unique: true,
  partialFilterExpression: { status: "pending" }
});

// Index for faster queries
friendRequestSchema.index({ to: 1, status: 1 });
friendRequestSchema.index({ from: 1, status: 1 });
friendRequestSchema.index({ status: 1, createdAt: -1 });
friendRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Virtual for sender details
friendRequestSchema.virtual('senderDetails', {
  ref: 'User',
  localField: 'from',
  foreignField: '_id',
  justOne: true,
});

// Virtual for receiver details
friendRequestSchema.virtual('receiverDetails', {
  ref: 'User',
  localField: 'to',
  foreignField: '_id',
  justOne: true,
});

// Pre-save middleware to validate
friendRequestSchema.pre('save', async function () {
  console.log("### ACTIVE PRE-SAVE HOOK RUNNING ###");

  if (this.from.toString() === this.to.toString()) {
    throw new Error('Cannot send friend request to yourself');
  }

  if (this.status === 'pending') {
    const User = mongoose.model('User');

    const [fromUser, toUser] = await Promise.all([
      User.findById(this.from),
      User.findById(this.to)
    ]);

    if (!fromUser || !toUser) {
      throw new Error('Invalid users');
    }

    if (fromUser.friends.includes(this.to) || toUser.friends.includes(this.from)) {
      throw new Error('Users are already friends');
    }
  }
});



module.exports = connection.model('FriendRequest', friendRequestSchema);