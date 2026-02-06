const User = require('../../models/user');
const bcrypt = require('bcryptjs');
const cloudinary = require('../lib/cloudnary');

const uploadBufferToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "chat-app/avatars",
        resource_type: "image",
      },
      (error, uploadResult) => {
        if (error) return reject(error);
        resolve(uploadResult);
      }
    );
    stream.end(buffer);
  });
};


// Update Profile
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { username, bio } = req.body;

    const updateData = {};
    if (username) updateData.username = username;
    if (bio !== undefined) updateData.bio = bio;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password -sessions');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found." 
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: user
    });

  } catch (err) {
    console.error("Update Profile Error:", err);
    
    if (err.code === 11000) {
      return res.status(409).json({ 
        success: false, 
        error: "Username already taken." 
      });
    }
    
    res.status(500).json({ 
      success: false, 
      error: "Failed to update profile." 
    });
  }
};

// Update Avatar
const updateAvatar = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "Avatar image is required."
      });
    }

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer);
    const avatarUrl = uploadResult.secure_url;

    const user = await User.findByIdAndUpdate(
      userId,
      { avatar: avatarUrl },
      { new: true }
    ).select("-password -sessions");

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Avatar updated successfully.",
      data: user
    });
  } catch (err) {
    console.error("Update Avatar Error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to update avatar."
    });
  }
};


// Update Status
const updateStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.body;

    const validStatuses = ["online", "away", "busy", "offline"];
    
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: "Invalid status." 
      });
    }

    const updateData = { status };
    
    if (status === "offline") {
      updateData.online = false;
      updateData.lastSeen = new Date();
    } else {
      updateData.online = true;
      updateData.lastSeen = new Date();
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true }
    ).select('-password -sessions');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found." 
      });
    }

    // Emit status change via Socket.IO
    if (req.io) {
      req.io.emit('user-status-changed', {
        userId: user._id,
        status: user.status,
        online: user.online,
        lastSeen: user.lastSeen
      });
    }

    res.status(200).json({
      success: true,
      message: "Status updated successfully.",
      data: user
    });

  } catch (err) {
    console.error("Update Status Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to update status." 
    });
  }
};

// Add Friend
const addFriend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body;

    if (!friendId) {
      return res.status(400).json({ 
        success: false, 
        error: "Friend ID is required." 
      });
    }

    if (userId === friendId) {
      return res.status(400).json({ 
        success: false, 
        error: "Cannot add yourself as friend." 
      });
    }

    const [user, friend] = await Promise.all([
      User.findById(userId),
      User.findById(friendId)
    ]);

    if (!friend) {
      return res.status(404).json({ 
        success: false, 
        error: "Friend not found." 
      });
    }

    // Check if already friends
    if (user.friends.includes(friendId)) {
      return res.status(409).json({ 
        success: false, 
        error: "Already friends." 
      });
    }

    // Check if blocked
    if (user.blockedUsers.includes(friendId)) {
      return res.status(403).json({ 
        success: false, 
        error: "Cannot add blocked user." 
      });
    }

    // Add to friends list (both sides)
    await Promise.all([
      User.findByIdAndUpdate(userId, {
        $addToSet: { friends: friendId }
      }),
      User.findByIdAndUpdate(friendId, {
        $addToSet: { friends: userId }
      })
    ]);

    // Get updated user
    const updatedUser = await User.findById(userId)
      .populate('friends', 'username avatar status online lastSeen');

    // Notify via Socket.IO
    if (req.io) {
      req.io.to(friend.socketId).emit('friend-added', {
        userId: userId,
        username: user.username,
        avatar: user.avatar
      });
    }

    res.status(200).json({
      success: true,
      message: "Friend added successfully.",
      data: updatedUser.friends
    });

  } catch (err) {
    console.error("Add Friend Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to add friend." 
    });
  }
};

// Remove Friend
const removeFriend = async (req, res) => {
  try {
    const userId = req.user.id;
    const { friendId } = req.body;

    if (!friendId) {
      return res.status(400).json({ 
        success: false, 
        error: "Friend ID is required." 
      });
    }

    const friend = await User.findById(friendId);
    
    // Remove from friends list (both sides)
    await Promise.all([
      User.findByIdAndUpdate(userId, {
        $pull: { friends: friendId }
      }),
      User.findByIdAndUpdate(friendId, {
        $pull: { friends: userId }
      })
    ]);

    // Get updated user
    const updatedUser = await User.findById(userId)
      .populate('friends', 'username avatar status online lastSeen');

    // Notify via Socket.IO
    if (req.io && friend) {
      req.io.to(friend.socketId).emit('friend-removed', {
        userId: userId
      });
    }

    res.status(200).json({
      success: true,
      message: "Friend removed successfully.",
      data: updatedUser.friends
    });

  } catch (err) {
    console.error("Remove Friend Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to remove friend." 
    });
  }
};

// Block User
const blockUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { targetId } = req.body;

    if (!targetId) {
      return res.status(400).json({ 
        success: false, 
        error: "User ID is required." 
      });
    }

    if (userId === targetId) {
      return res.status(400).json({ 
        success: false, 
        error: "Cannot block yourself." 
      });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found." 
      });
    }

    // Remove from friends if they are friends
    // Add to blocked list
    await User.findByIdAndUpdate(userId, {
      $pull: { friends: targetId },
      $addToSet: { blockedUsers: targetId }
    });

    const updatedUser = await User.findById(userId)
      .populate('blockedUsers', 'username avatar');

    // Notify via Socket.IO
    if (req.io) {
      req.io.to(targetUser.socketId).emit('user-blocked', {
        userId: userId
      });
    }

    res.status(200).json({
      success: true,
      message: "User blocked successfully.",
      data: updatedUser.blockedUsers
    });

  } catch (err) {
    console.error("Block User Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to block user." 
    });
  }
};

// Unblock User
const unblockUser = async (req, res) => {
  try {
    const userId = req.user.id;
    const { targetId } = req.body;

    if (!targetId) {
      return res.status(400).json({ 
        success: false, 
        error: "User ID is required." 
      });
    }

    await User.findByIdAndUpdate(userId, {
      $pull: { blockedUsers: targetId }
    });

    const updatedUser = await User.findById(userId)
      .populate('blockedUsers', 'username avatar');

    res.status(200).json({
      success: true,
      message: "User unblocked successfully.",
      data: updatedUser.blockedUsers
    });

  } catch (err) {
    console.error("Unblock User Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to unblock user." 
    });
  }
};

// Get All Users (with optional search)
const getAllUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    // Build query
    let query = { _id: { $ne: userId } };

    // Add search filter
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (page - 1) * limit;

    // Get users (exclude password and sessions)
    const users = await User.find(query)
      .select('-password -sessions -blockedUsers')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ online: -1, username: 1 });

    // Get total count for pagination
    const total = await User.countDocuments(query);

    // Check friendship status for each user
    const currentUser = await User.findById(userId);
    const usersWithStatus = users.map(user => ({
      ...user.toObject(),
      isFriend: currentUser.friends.includes(user._id),
      isBlocked: currentUser.blockedUsers.includes(user._id)
    }));

    res.status(200).json({
      success: true,
      data: usersWithStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (err) {
    console.error("Get All Users Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch users." 
    });
  }
};

// Search Users
const searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.user.id;

    if (!query || query.length < 2) {
      return res.status(400).json({ 
        success: false, 
        error: "Search query must be at least 2 characters." 
      });
    }

    const users = await User.find({
      _id: { $ne: userId },
      $or: [
        { username: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } }
      ]
    })
    .select('username avatar status online lastSeen bio')
    .limit(10);

    const currentUser = await User.findById(userId);
    const usersWithStatus = users.map(user => ({
      ...user.toObject(),
      isFriend: currentUser.friends.includes(user._id),
      isBlocked: currentUser.blockedUsers.includes(user._id)
    }));

    res.status(200).json({
      success: true,
      data: usersWithStatus
    });

  } catch (err) {
    console.error("Search Users Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Search failed." 
    });
  }
};

// Get Online Users
const getOnlineUsers = async (req, res) => {
  try {
    const userId = req.user.id;

    const onlineUsers = await User.find({
      _id: { $ne: userId },
      online: true,
      status: { $ne: "offline" }
    })
    .select('username avatar status lastSeen')
    .sort({ lastSeen: -1 });

    res.status(200).json({
      success: true,
      data: onlineUsers
    });

  } catch (err) {
    console.error("Get Online Users Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch online users." 
    });
  }
}

// Terminate All Sessions (Logout from all devices)
const terminateAllSessions = async (req, res) => {
  try {
    const userId = req.user.id;

    await User.findByIdAndUpdate(userId, {
      sessions: [],
      online: false,
      status: "offline",
      lastSeen: new Date()
    });

    // Clear cookie
    res.clearCookie('token');

    // Notify all sockets to disconnect
    if (req.io) {
      req.io.emit('force-logout', { userId });
    }

    res.status(200).json({
      success: true,
      message: "All sessions terminated successfully."
    });

  } catch (err) {
    console.error("Terminate Sessions Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to terminate sessions." 
    });
  }
};

module.exports = {
  updateProfile,
  updateAvatar,
  updateStatus,
  addFriend,
  removeFriend,
  blockUser,
  unblockUser,
  getAllUsers,
  searchUsers,
  getOnlineUsers,
  terminateAllSessions
};