const FriendRequest = require("../../models/friend");
const User = require("../../models/user");
const redis = require("../lib/redis");

// Helper function to emit socket events
const emitSocketEvent = async (io, userId, event, data) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

// 1️⃣ Send Friend Request
const sendFriendRequest = async (req, res) => {
  try {
    const { toUserId, message } = req.body;
    const fromUserId = req.user.id;

    if (!toUserId) {
      return res.status(400).json({
        success: false,
        error: "Recipient user ID is required.",
      });
    }

    // Cannot send to yourself
    if (fromUserId === toUserId) {
      return res.status(400).json({
        success: false,
        error: "Cannot send friend request to yourself.",
      });
    }

    // Validate recipient
    const recipient = await User.findById(toUserId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        error: "Recipient user not found.",
      });
    }

    // Check if recipient allows friend requests
    if (!recipient.friendSettings.allowFriendRequests) {
      return res.status(403).json({
        success: false,
        error: "This user is not accepting friend requests.",
      });
    }

    // Recipient blocked sender
    if (recipient.blockedUsers.includes(fromUserId)) {
      return res.status(403).json({
        success: false,
        error: "You are blocked by this user.",
      });
    }

    // Sender blocked recipient
    const sender = await User.findById(fromUserId);
    if (sender.blockedUsers.includes(toUserId)) {
      return res.status(400).json({
        success: false,
        error: "You have blocked this user. Unblock them first.",
      });
    }

    // Already friends
    if (sender.friends.includes(toUserId)) {
      return res.status(400).json({
        success: false,
        error: "You are already friends with this user.",
      });
    }

    // Existing pending request
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { from: fromUserId, to: toUserId },
        { from: toUserId, to: fromUserId },
      ],
      status: "pending",
    });

    if (existingRequest) {
      if (existingRequest.from.toString() === fromUserId) {
        return res.status(409).json({
          success: false,
          error: "Friend request already sent.",
        });
      } else {
        return res.status(409).json({
          success: false,
          error: "This user has already sent you a friend request.",
        });
      }
    }

    // Last rejected request (cooldown 7 days)
    const previousRejected = await FriendRequest.findOne({
      $or: [
        { from: fromUserId, to: toUserId, status: "rejected" },
        { from: toUserId, to: fromUserId, status: "rejected" },
      ],
      updatedAt: {
        $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    });

    if (previousRejected) {
      return res.status(429).json({
        success: false,
        error: "Cannot send request. Previous request was recently rejected.",
        cooldownUntil: new Date(
          previousRejected.updatedAt.getTime() + 7 * 24 * 60 * 60 * 1000,
        ),
      });
    }

    // Create Friend Request
    const friendRequest = await FriendRequest.create({
      from: fromUserId,
      to: toUserId,
      message: message?.trim() || null,
      status: "pending",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    // Populate request details
    await friendRequest.populate([
      { path: "from", select: "username avatar status online" },
      { path: "to", select: "username avatar status online" },
    ]);
    const socketServer = req.app.get("socketServer");
    // AUTO ACCEPT
    if (recipient.friendSettings.autoAcceptFriends) {
      await acceptFriendRequestInternal(friendRequest._id, toUserId);

      const updatedRequest = await FriendRequest.findById(friendRequest._id)
        .populate("from", "username avatar status online")
        .populate("to", "username avatar status online");
      if (socketServer) {
        socketServer.io
          .to(`user:${fromUserId}`)
          .emit("friend-request-accepted", {
            request: updatedRequest,
            friend: updatedRequest.to,
          });

        // 2. Tell the RECEIVER (toUserId) that they have a new friend added automatically
        socketServer.io.to(`user:${toUserId}`).emit("friend-added", {
          friend: updatedRequest.from, // The sender is now their friend
        });
      }

      return res.status(201).json({
        success: true,
        message: "Friend request sent and automatically accepted.",
        data: updatedRequest,
      });
    }

    if (socketServer) {
      await socketServer.friendEvents.emitFriendRequestReceived(toUserId, {
        requestId: friendRequest._id,
        from: {
          username: req.user.username,
          avatar: req.user.avatar,
        },
      });
    }

    return res.status(201).json({
      success: true,
      message: "Friend request sent successfully.",
      data: friendRequest,
    });
  } catch (err) {
    console.error("Send Friend Request Error:", err);

    // Duplicate index
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "Friend request already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to send friend request.",
    });
  }
};

// 2️⃣ Cancel Friend Request
const cancelFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    const request = await FriendRequest.findOne({
      _id: requestId,
      from: userId,
      status: "pending",
    }).populate("to", "username avatar status online"); // Populate recipient details

    if (!request) {
      return res.status(404).json({
        success: false,
        error: "Friend request not found or cannot be cancelled.",
      });
    }

    // Get sender details for socket event
    const sender = await User.findById(userId).select("username avatar");

    // Soft delete or remove
    await FriendRequest.findByIdAndDelete(requestId);

    // Emit socket event to recipient using FriendEventsHandler
    if (req.io) {
      // Import and use FriendEventsHandler
      const FriendEventsHandler = require("../socket/events/friend.events");
      const friendHandler = new FriendEventsHandler(req.io);

      await friendHandler.emitFriendRequestCancelled(request.to._id, {
        requestId: request._id,
        cancelledBy: {
          _id: userId,
          username: sender.username,
          avatar: sender.avatar,
        },
        cancelledAt: new Date(),
        recipient: {
          _id: request.to._id,
          username: request.to.username,
          avatar: request.to.avatar,
        },
      });
    }

    res.status(200).json({
      success: true,
      message: "Friend request cancelled successfully.",
      data: {
        requestId: request._id,
        cancelledAt: new Date(),
        recipient: {
          _id: request.to._id,
          username: request.to.username,
        },
      },
    });
  } catch (err) {
    console.error("Cancel Friend Request Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to cancel friend request.",
    });
  }
};

// 3️⃣ Accept Friend Request
const acceptFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;

    const request = await FriendRequest.findOne({
      _id: requestId,
      to: userId,
      status: "pending",
    }).populate("from", "username avatar status online");

    if (!request) {
      return res.status(404).json({
        success: false,
        error: "Friend request not found or already processed.",
      });
    }

    // Call internal accept function
    await acceptFriendRequestInternal(requestId, userId);

    // Get updated request with populated data
    const updatedRequest = await FriendRequest.findById(requestId)
      .populate("from", "username avatar status online")
      .populate("to", "username avatar status online");

    // Get both users for socket events
    const [sender, receiver] = await Promise.all([
      User.findById(request.from).select("username avatar status online"),
      User.findById(request.to).select("username avatar status online"),
    ]);
    const socketServer = req.app.get("socketServer");
    // Emit socket events
    if (socketServer) {
      socketServer.io
        .to(`user:${request.from}`)
        .emit("friend-request-accepted", {
          request: updatedRequest,
          friend: {
            _id: receiver._id,
            username: receiver.username,
            avatar: receiver.avatar,
            status: receiver.status,
            online: receiver.online,
          },
        });

      // 2. Notify the RECEIVER (the person who just clicked 'Accept')
      socketServer.io.to(`user:${request.to}`).emit("friend-added", {
        friend: {
          _id: sender._id,
          username: sender.username,
          avatar: sender.avatar,
          status: sender.status,
          online: sender.online,
        },
      });
    }
    res.status(200).json({
      success: true,
      message: "Friend request accepted successfully.",
      data: {
        request: updatedRequest,
        friend: {
          _id: sender._id,
          username: sender.username,
          avatar: sender.avatar,
          status: sender.status,
          online: sender.online,
        },
      },
    });
  } catch (err) {
    console.error("Accept Friend Request Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to accept friend request.",
    });
  }
};

// Internal accept function (reusable)
const acceptFriendRequestInternal = async (requestId, acceptorId) => {
  const session = await FriendRequest.startSession();
  session.startTransaction();

  try {
    const request = await FriendRequest.findById(requestId).session(session);

    if (!request || request.status !== "pending") {
      throw new Error("Invalid request");
    }

    // Update request status
    request.status = "accepted";
    await request.save({ session });

    // Add each other as friends
    await User.findByIdAndUpdate(
      request.from,
      { $addToSet: { friends: request.to } },
      { session },
    );

    await User.findByIdAndUpdate(
      request.to,
      { $addToSet: { friends: request.from } },
      { session },
    );

    // Delete any other pending requests between these users
    await FriendRequest.deleteMany({
      $or: [
        { from: request.from, to: request.to, status: "pending" },
        { from: request.to, to: request.from, status: "pending" },
      ],
      _id: { $ne: requestId },
    }).session(session);

    await session.commitTransaction();
    session.endSession();
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

// 4️⃣ Reject Friend Request
const rejectFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user.id;
    const { blockUser = false } = req.body;

    const request = await FriendRequest.findOne({
      _id: requestId,
      to: userId,
      status: "pending",
    }).populate("from", "username avatar");

    if (!request) {
      return res.status(404).json({
        success: false,
        error: "Friend request not found or already processed.",
      });
    }

    if (blockUser) {
      // Block the sender
      await User.findByIdAndUpdate(userId, {
        $addToSet: { blockedUsers: request.from },
      });

      // Update request as blocked
      request.status = "blocked";
      request.isBlocked = true;
      request.blockedBy = userId;
      request.blockedAt = new Date();
      await request.save();
    } else {
      // Simply reject
      request.status = "rejected";
      await request.save();
    }
    const socketServer = req.app.get("socketServer");
    // Emit socket event to sender
    if (socketServer) {
      socketServer.io
        .to(`user:${request.from}`)
        .emit("friend-request-rejected", {
          requestId: request._id,
          rejectedBy: userId,
          blocked: blockUser,
          rejectedAt: new Date(),
          message: blockUser ? "User blocked you" : null,
        });
    }

    res.status(200).json({
      success: true,
      message: blockUser
        ? "Friend request rejected and user blocked."
        : "Friend request rejected.",
      data: {
        requestId: request._id,
        blocked: blockUser,
      },
    });
  } catch (err) {
    console.error("Reject Friend Request Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to reject friend request.",
    });
  }
};

// 5️⃣ Get Pending Requests
const getPendingRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type = "received", page = 1, limit = 20 } = req.query;

    const query = { status: "pending" };

    if (type === "received") {
      query.to = userId;
    } else if (type === "sent") {
      query.from = userId;
    } else {
      return res.status(400).json({
        success: false,
        error: "Invalid type. Use 'received' or 'sent'.",
      });
    }

    const skip = (page - 1) * parseInt(limit);

    const [requests, total] = await Promise.all([
      FriendRequest.find(query)
        .populate(
          type === "received" ? "from" : "to",
          "username avatar status online lastSeen bio",
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      FriendRequest.countDocuments(query),
    ]);

    // Format response
    const formattedRequests = requests.map((req) => ({
      _id: req._id,
      ...(type === "received"
        ? {
            from: req.from,
            sender: req.from, // Alias for easier access
          }
        : {
            to: req.to,
            recipient: req.to, // Alias for easier access
          }),
      message: req.message,
      status: req.status,
      createdAt: req.createdAt,
      expiresAt: req.expiresAt,
    }));

    res.status(200).json({
      success: true,
      data: formattedRequests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        type,
      },
    });
  } catch (err) {
    console.error("Get Pending Requests Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch pending requests.",
    });
  }
};

// 6️⃣ Get Friends List
const getFriendsList = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search = "", page = 1, limit = 50 } = req.query;
   
    const cacheKey = `friends:${userId}:${search}:${page}:${limit}`;
    const redis = req.app.get("redis");

    // 1. TRY FETCHING FROM REDIS
    if (redis) {
      const cachedFriends = await redis.get(cacheKey);
      if (cachedFriends) {
        console.log("⚡ Friends list served from Redis");
        return res.status(200).json(JSON.parse(cachedFriends));
      }
    }

    // 2. IF NOT IN CACHE, PULL FROM MONGODB
    const user = await User.findById(userId).populate({
      path: "friends",
      select: "username avatar status online lastSeen bio",
      match: {
        ...(search && { username: { $regex: search, $options: "i" } }),
      },
      options: {
        sort: { username: 1 },
        skip: (page - 1) * parseInt(limit),
        limit: parseInt(limit),
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, error: "User not found." });
    }

    const total = await User.countDocuments({
      _id: { $in: user.friends },
      ...(search && { username: { $regex: search, $options: "i" } }),
    });

    const responsePayload = {
      success: true,
      data: user.friends,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
        search,
      },
    };

    // 3. SAVE TO REDIS
    if (redis) {
      // We set a shorter TTL (e.g., 2 minutes) because friend data changes often
      await redis.set(cacheKey, JSON.stringify(responsePayload), { EX: 120 });
    }

    res.status(200).json(responsePayload);
  } catch (err) {
    console.error("Get Friends List Error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch friends list." });
  }
};

// 7️⃣ Block User
const blockUser = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user.id;

    if (currentUserId === targetUserId) {
      return res.status(400).json({
        success: false,
        error: "Cannot block yourself.",
      });
    }

    const [currentUser, targetUser] = await Promise.all([
      User.findById(currentUserId),
      User.findById(targetUserId),
    ]);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    // Check if already blocked
    if (currentUser.blockedUsers.includes(targetUserId)) {
      return res.status(400).json({
        success: false,
        error: "User is already blocked.",
      });
    }

    // Add to blocked users
    currentUser.blockedUsers.push(targetUserId);
    await currentUser.save();

    // Remove from friends if they were friends
    if (currentUser.friends.includes(targetUserId)) {
      currentUser.friends = currentUser.friends.filter(
        (friendId) => friendId.toString() !== targetUserId,
      );
      await currentUser.save();

      // Also remove from target's friends list
      targetUser.friends = targetUser.friends.filter(
        (friendId) => friendId.toString() !== currentUserId,
      );
      await targetUser.save();

      // Update any existing friend requests
      await FriendRequest.updateMany(
        {
          $or: [
            { from: currentUserId, to: targetUserId },
            { from: targetUserId, to: currentUserId },
          ],
        },
        {
          status: "blocked",
          isBlocked: true,
          blockedBy: currentUserId,
          blockedAt: new Date(),
        },
      );
    } else {
      // Reject any pending friend requests
      await FriendRequest.updateMany(
        {
          $or: [
            { from: currentUserId, to: targetUserId, status: "pending" },
            { from: targetUserId, to: currentUserId, status: "pending" },
          ],
        },
        {
          status: "blocked",
          isBlocked: true,
          blockedBy: currentUserId,
          blockedAt: new Date(),
        },
      );
    }

    // Emit socket event
    if (req.io) {
      await emitSocketEvent(req.io, targetUserId, "user-blocked-you", {
        blockedBy: {
          _id: currentUser._id,
          username: currentUser.username,
          avatar: currentUser.avatar,
        },
        blockedAt: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: "User blocked successfully.",
      data: {
        userId: targetUserId,
        username: targetUser.username,
        blockedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("Block User Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to block user.",
    });
  }
};

// 8️⃣ Unblock User
const unblockUser = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user.id;

    const currentUser = await User.findById(currentUserId);

    if (!currentUser.blockedUsers.includes(targetUserId)) {
      return res.status(400).json({
        success: false,
        error: "User is not blocked.",
      });
    }

    // Remove from blocked users
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (blockedId) => blockedId.toString() !== targetUserId,
    );
    await currentUser.save();

    // Update any blocked friend requests
    await FriendRequest.updateMany(
      {
        $or: [
          {
            from: currentUserId,
            to: targetUserId,
            status: "blocked",
            blockedBy: currentUserId,
          },
          {
            from: targetUserId,
            to: currentUserId,
            status: "blocked",
            blockedBy: currentUserId,
          },
        ],
      },
      {
        status: "rejected",
        isBlocked: false,
        blockedBy: null,
        blockedAt: null,
      },
    );

    res.status(200).json({
      success: true,
      message: "User unblocked successfully.",
      data: {
        userId: targetUserId,
      },
    });
  } catch (err) {
    console.error("Unblock User Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to unblock user.",
    });
  }
};

// 9️⃣ Remove Friend
const removeFriend = async (req, res) => {
  try {
    const { userId: friendId } = req.params;
    const currentUserId = req.user.id;

    if (currentUserId === friendId) {
      return res.status(400).json({
        success: false,
        error: "Cannot remove yourself as friend.",
      });
    }

    const [currentUser, friend] = await Promise.all([
      User.findById(currentUserId),
      User.findById(friendId),
    ]);

    if (!friend) {
      return res.status(404).json({
        success: false,
        error: "Friend not found.",
      });
    }

    // Check if they are friends
    if (!currentUser.friends.includes(friendId)) {
      return res.status(400).json({
        success: false,
        error: "You are not friends with this user.",
      });
    }

    // Remove from friends list (both sides)
    currentUser.friends = currentUser.friends.filter(
      (id) => id.toString() !== friendId,
    );
    friend.friends = friend.friends.filter(
      (id) => id.toString() !== currentUserId,
    );

    await Promise.all([currentUser.save(), friend.save()]);

    // Delete any accepted friend requests
    await FriendRequest.deleteMany({
      $or: [
        { from: currentUserId, to: friendId, status: "accepted" },
        { from: friendId, to: currentUserId, status: "accepted" },
      ],
    });

    // Emit socket event
    if (req.io) {
      await emitSocketEvent(req.io, friendId, "friend-removed", {
        removedBy: {
          _id: currentUser._id,
          username: currentUser.username,
          avatar: currentUser.avatar,
        },
        removedAt: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: "Friend removed successfully.",
      data: {
        userId: friendId,
        username: friend.username,
      },
    });
  } catch (err) {
    console.error("Remove Friend Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to remove friend.",
    });
  }
};

// 🔟 Get Blocked Users
const getBlockedUsers = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).populate({
      path: "blockedUsers",
      select: "username avatar email",
    });

    res.status(200).json({
      success: true,
      data: user.blockedUsers || [],
      count: user.blockedUsers?.length || 0,
    });
  } catch (err) {
    console.error("Get Blocked Users Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch blocked users.",
    });
  }
};

// 1️⃣1️⃣ Get Friend Suggestions
const getFriendSuggestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 10 } = req.query;
    
    const user = await User.findById(userId)
    .populate("friends", "_id")
    .populate("blockedUsers", "_id");

    const cacheKey = `suggestions:${userId}:${limit}`;
      const redis = req.app.get("redis"); 

    // 1. CHECK REDIS FIRST
    if (redis) {
      const cachedData = await redis.get(cacheKey);
      if (cachedData) {
        console.log("⚡ Found in Redis! Returning cached data.");
        return res.status(200).json({
          success: true,
          data: JSON.parse(cachedData), // Convert string back to Object
          source: "cache"
        });
      }
    }

    const friendIds = user.friends.map((f) => f._id);
    const blockedIds = user.blockedUsers.map((b) => b._id);

    // Get mutual friends' friends who are not already friends/blocked
    const suggestions = await User.aggregate([
      {
        $match: {
          _id: { $ne: userId },
          _id: { $nin: [...friendIds, ...blockedIds] },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "friends",
          foreignField: "_id",
          as: "mutualFriends",
        },
      },
      {
        $addFields: {
          mutualCount: {
            $size: {
              $setIntersection: [
                friendIds,
                { $map: { input: "$mutualFriends", as: "mf", in: "$$mf._id" } },
              ],
            },
          },
          hasCommonInterests: { $literal: 0 }, // Could be enhanced with user interests
        },
      },
      {
        $sort: {
          mutualCount: -1,
          online: -1,
          createdAt: -1,
        },
      },
      {
        $limit: parseInt(limit),
      },
      {
        $project: {
          _id: 1,
          username: 1,
          avatar: 1,
          status: 1,
          online: 1,
          bio: 1,
          mutualCount: 1,
          hasSentRequest: { $literal: false }, // Could check for pending requests
        },
      },
    ]);

    try {
      await redis.set(cacheKey, JSON.stringify(suggestions), {
        EX: 300,
      });
      console.log("worked");
    } catch (cacheErr) {
      console.error("Redis Set Error:", cacheErr);
    }

    const socketServer = req.app.get("socketServer");
    if (socketServer) {
      console.log(`📡 Testing socket emit for user: ${userId}`);
      socketServer.io.to(`user:${userId}`).emit("test_socket_connection", {
        message: "suggested friend is fetched succesfully",
        suggestionsCount: suggestions.length,
        timestamp: new Date(),
      });
      console.log(`📡 Testing socket emit for user: ${userId}`);
    } else {
      console.warn("⚠️ SocketServer instance not found in req.app");
    }

    res.status(200).json({
      success: true,
      data: suggestions,
      count: suggestions.length,
    });
  } catch (err) {
    console.error("Get Friend Suggestions Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch friend suggestions.",
    });
  }
};

// 1️⃣2️⃣ Update Friend Settings
const updateFriendSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      allowFriendRequests,
      allowRequestsFromNonFriends,
      autoAcceptFriends,
    } = req.body;

    const user = await User.findById(userId);

    if (allowFriendRequests !== undefined) {
      user.friendSettings.allowFriendRequests = allowFriendRequests;
    }

    if (allowRequestsFromNonFriends !== undefined) {
      user.friendSettings.allowRequestsFromNonFriends =
        allowRequestsFromNonFriends;
    }

    if (autoAcceptFriends !== undefined) {
      user.friendSettings.autoAcceptFriends = autoAcceptFriends;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: "Friend settings updated successfully.",
      data: user.friendSettings,
    });
  } catch (err) {
    console.error("Update Friend Settings Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update friend settings.",
    });
  }
};

module.exports = {
  sendFriendRequest,
  cancelFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  getPendingRequests,
  getFriendsList,
  blockUser,
  unblockUser,
  removeFriend,
  getBlockedUsers,
  getFriendSuggestions,
  updateFriendSettings,
};
