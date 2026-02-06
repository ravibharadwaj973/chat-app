
const {connection}=require("mongoose")
const mongoose =require("mongoose")

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      minlength: 6,
    },
    avatar: {
      type: String,
      default: null,
    },
    online: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["online", "away", "busy", "offline"],
      default: "offline",
    },
    bio: {
      type: String,
      maxlength: 100,
      default: "",
    },
    friends: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    socketId: {
      type: String,
      default: null,
    },
    sessions: [{
      token: String,
      createdAt: { type: Date, default: Date.now },
      lastActive: { type: Date, default: Date.now }
    }],
    friendSettings: {
      allowFriendRequests: {
        type: Boolean,
        default: true,
      },
      allowRequestsFromNonFriends: {
        type: Boolean,
        default: true,
      },
      autoAcceptFriends: {
        type: Boolean,
        default: false,
      },
    },
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes

userSchema.index({ 'friends': 1 });
userSchema.index({ 'blockedUsers': 1 });

// Virtual for friend requests sent
userSchema.virtual('sentRequests', {
  ref: 'FriendRequest',
  localField: '_id',
  foreignField: 'from',
});

// Virtual for friend requests received
userSchema.virtual('receivedRequests', {
  ref: 'FriendRequest',
  localField: '_id',
  foreignField: 'to',
});

module.exports = connection.model.User|| connection.model('User', userSchema);