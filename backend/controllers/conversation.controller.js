const Conversation = require("../../models/conversation");
const Message = require("../../models/message");
const User = require("../../models/user");

// 1️⃣ Create Conversation
const createConversation = async (req, res) => {
  try {
    const { participants, isGroup, groupName, groupAvatar } = req.body;
    const userId = req.user.id;
    // Convert participants to an array safely
    let participantList = [];

    // CASE 1: frontend sends participants as array
    if (Array.isArray(req.body.participants)) {
      participantList = req.body.participants;
    }

    // CASE 2: frontend sends single id as string
    else if (typeof req.body.participants === "string") {
      participantList = [req.body.participants];
    }

    // CASE 3: frontend sends an object (like {"0": "id"})
    else if (
      typeof req.body.participants === "object" &&
      req.body.participants !== null
    ) {
      participantList = Object.values(req.body.participants);
    }

    // Merge current user
    const allParticipants = [req.user.id, ...participantList].map((id) =>
      id.toString()
    );

    // Validate group properties
    if (isGroup && !groupName) {
      return res.status(400).json({
        success: false,
        error: "Group name is required for group conversation.",
      });
    }

    // Prevent duplicate 1:1 chats
    if (!isGroup && allParticipants.length === 2) {
      const existing = await Conversation.findOne({
        isGroup: false,
        participants: { $all: allParticipants, $size: 2 },
      });

      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Conversation already exists.",
          data: existing,
        });
      }
    }

    // Validate users
    const users = await User.find({ _id: { $in: allParticipants } });
    if (users.length !== allParticipants.length) {
      return res.status(404).json({
        success: false,
        error: "Some participants not found.",
      });
    }

    // Create conversation
    const conversation = await Conversation.create({
      participants: allParticipants,
      isGroup,
      groupName: isGroup ? groupName : null,
      groupAvatar: isGroup ? groupAvatar : null,
      groupAdmin: isGroup ? userId : null,
      unreadCount: {},
    });

    // Initialize unread counters
    allParticipants.forEach((id) => {
      conversation.unreadCount.set(id.toString(), 0);
    });

    await conversation.save();

    // Populate data
    await conversation.populate({
      path: "participants",
      select: "username avatar status online lastSeen",
    });

    res.status(201).json({
      success: true,
      message: isGroup
        ? "Group created successfully."
        : "Conversation created successfully.",
      data: conversation,
    });
  } catch (err) {
    console.error("Create Conversation Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to create conversation.",
    });
  }
};

// 2️⃣ Get User Conversations
const getUserConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { archived = false, search = "" } = req.query;

    // Build query
    const query = {
      participants: userId,
      ...(archived ? { archivedBy: userId } : { archivedBy: { $ne: userId } }),
    };

    // Search filter
    if (search) {
      query.$or = [
        { groupName: { $regex: search, $options: "i" } },
        {
          isGroup: false,
          "participants.username": { $regex: search, $options: "i" },
        },
      ];
    }

    const conversations = await Conversation.find(query)
      .populate({
        path: "participants",
        select: "username avatar status online lastSeen",
        match: { _id: { $ne: userId } },
      })
      .populate({
        path: "lastMessage",
        select: "content sender messageType mediaUrl createdAt",
        populate: {
          path: "sender",
          select: "username avatar",
        },
      })
      .populate("groupAdmin", "username avatar")
      .sort({ updatedAt: -1 });

    // Format response
    const formattedConversations = conversations.map((conv) => {
      const convObj = conv.toObject();

      // For 1:1 chats, get the other participant
      if (!conv.isGroup) {
        const otherParticipant = conv.participants.find(
          (p) => p._id.toString() !== userId
        );
        convObj.otherParticipant = otherParticipant || null;
        convObj.displayName = otherParticipant?.username || "Unknown";
        convObj.displayAvatar = otherParticipant?.avatar || null;
      } else {
        convObj.displayName = conv.groupName;
        convObj.displayAvatar = conv.groupAvatar;
      }

      // Check if muted
      convObj.isMuted = conv.mutedBy.includes(userId);

      // Get unread count for this user
      convObj.unreadCount = conv.unreadCount.get(userId.toString()) || 0;

      return convObj;
    });

    res.status(200).json({
      success: true,
      data: formattedConversations,
      count: formattedConversations.length,
    });
  } catch (err) {
    console.error("Get Conversations Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch conversations.",
    });
  }
};

// 3️⃣ Get Conversation by ID
const getConversationById = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    })
      .populate({
        path: "participants",
        select: "username avatar status online lastSeen email bio",
      })
      .populate("groupAdmin", "username avatar")
      .populate({
        path: "lastMessage",
        select: "content sender messageType mediaUrl createdAt",
        populate: {
          path: "sender",
          select: "username avatar",
        },
      });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found or access denied.",
      });
    }

    // Format response
    const convObj = conversation.toObject();

    // For 1:1 chats, identify other participant
    if (!conversation.isGroup) {
      const otherParticipant = conversation.participants.find(
        (p) => p._id.toString() !== userId
      );
      convObj.otherParticipant = otherParticipant || null;
      convObj.displayName = otherParticipant?.username || "Unknown";
      convObj.displayAvatar = otherParticipant?.avatar || null;
    } else {
      convObj.displayName = conversation.groupName;
      convObj.displayAvatar = conversation.groupAvatar;
    }

    // Additional metadata
    convObj.isMuted = conversation.mutedBy.includes(userId);
    convObj.isArchived = conversation.archivedBy.includes(userId);
    convObj.unreadCount = conversation.unreadCount.get(userId.toString()) || 0;

    // Check if user is banned
    const isBanned = conversation.bannedUsers.some(
      (ban) => ban.userId.toString() === userId
    );
    convObj.isBanned = isBanned;

    res.status(200).json({
      success: true,
      data: convObj,
    });
  } catch (err) {
    console.error("Get Conversation Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch conversation.",
    });
  }
};

// 4️⃣ Delete/Archive Conversation
const deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    console.log(conversationId)
    const userId = req.user.id;
     const permanent = req.body?.permanent === true || req.query.permanent === "true";

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    if (permanent) {
      // Only group admin or participants can delete permanently
      if (
        conversation.isGroup &&
        conversation.groupAdmin?.toString() !== userId
      ) {
        return res.status(403).json({
          success: false,
          error: "Only group admin can delete permanently.",
        });
      }

      // Delete all messages first
      await Message.deleteMany({ conversationId });

      // Delete conversation
      await Conversation.findByIdAndDelete(conversationId);

      res.status(200).json({
        success: true,
        message: "Conversation permanently deleted.",
      });
    } else {
      // Archive conversation for this user
      if (!conversation.archivedBy.includes(userId)) {
        conversation.archivedBy.push(userId);
        await conversation.save();
      }

      res.status(200).json({
        success: true,
        message: "Conversation archived.",
      });
    }
  } catch (err) {
    console.error("Delete Conversation Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete conversation.",
    });
  }
};

// 5️⃣ Add Participant to Conversation (Group)
const addParticipantToConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId: newUserId } = req.body;
    const adminId = req.user.id;
console.log(adminId)
    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      groupAdmin: adminId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found or you are not admin.",
      });
    }

    // Check if user already in conversation
    if (conversation.participants.includes(newUserId)) {
      return res.status(400).json({
        success: false,
        error: "User already in group.",
      });
    }

    // Check if user is banned
    const isBanned = conversation.bannedUsers.some(
      (ban) => ban.userId.toString() === newUserId
    );
    if (isBanned) {
      return res.status(403).json({
        success: false,
        error: "User is banned from this group.",
      });
    }

    // Add user to participants
    conversation.participants.push(newUserId);

    // Initialize unread count for new participant
    conversation.unreadCount.set(newUserId.toString(), 0);

    await conversation.save();

    // Populate new participant details
    const newUser = await User.findById(newUserId).select("username avatar");

    res.status(200).json({
      success: true,
      message: "User added to group.",
      data: {
        userId: newUserId,
        username: newUser.username,
        avatar: newUser.avatar,
      },
    });
  } catch (err) {
    console.error("Add Participant Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to add participant.",
    });
  }
};

// 6️⃣ Remove Participant from Conversation
const removeParticipantFromConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId: removeUserId } = req.body;
    const adminId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      groupAdmin: adminId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found or you are not admin.",
      });
    }

    // Check if trying to remove admin
    if (conversation.groupAdmin?.toString() === removeUserId) {
      return res.status(400).json({
        success: false,
        error: "Cannot remove group admin. Transfer admin rights first.",
      });
    }

    // Remove user from participants
    conversation.participants = conversation.participants.filter(
      (participant) => participant.toString() !== removeUserId
    );

    // Remove unread count
    conversation.unreadCount.delete(removeUserId.toString());

    await conversation.save();

    res.status(200).json({
      success: true,
      message: "User removed from group.",
    });
  } catch (err) {
    console.error("Remove Participant Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to remove participant.",
    });
  }
};

// 7️⃣ Change Group Name
const changeGroupName = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { groupName } = req.body;
    const userId = req.user.id;

    if (!groupName || groupName.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Group name is required.",
      });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      $or: [{ groupAdmin: userId }, { participants: userId }],
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found or access denied.",
      });
    }

    // Only admin can change name
    if (conversation.groupAdmin?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: "Only group admin can change group name.",
      });
    }

    const oldName = conversation.groupName;
    conversation.groupName = groupName.trim();
    await conversation.save();

    res.status(200).json({
      success: true,
      message: "Group name updated.",
      data: {
        oldName,
        newName: conversation.groupName,
      },
    });
  } catch (err) {
    console.error("Change Group Name Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to change group name.",
    });
  }
};

// 8️⃣ Change Group Avatar
const changeGroupAvatar = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { avatarUrl } = req.body;
    const userId = req.user.id;

    if (!avatarUrl) {
      return res.status(400).json({
        success: false,
        error: "Avatar URL is required.",
      });
    }

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      $or: [{ groupAdmin: userId }, { participants: userId }],
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found or access denied.",
      });
    }

    // Only admin can change avatar
    if (conversation.groupAdmin?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        error: "Only group admin can change group avatar.",
      });
    }

    conversation.groupAvatar = avatarUrl;
    await conversation.save();

    res.status(200).json({
      success: true,
      message: "Group avatar updated.",
      data: {
        avatarUrl: conversation.groupAvatar,
      },
    });
  } catch (err) {
    console.error("Change Group Avatar Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to change group avatar.",
    });
  }
};

// 9️⃣ Search Conversations
const searchConversations = async (req, res) => {
  try {
    const userId = req.user.id;
    const { query, type = "all" } = req.query;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Search query must be at least 2 characters.",
      });
    }

    const searchQuery = {
      participants: userId,
      $or: [],
    };

    if (type === "all" || type === "groups") {
      searchQuery.$or.push({
        isGroup: true,
        groupName: { $regex: query, $options: "i" },
      });
    }

    if (type === "all" || type === "users") {
      // Find users matching the query
      const users = await User.find({
        username: { $regex: query, $options: "i" },
        _id: { $ne: userId },
      }).select("_id");

      const userIds = users.map((user) => user._id);

      if (userIds.length > 0) {
        searchQuery.$or.push({
          isGroup: false,
          participants: { $in: userIds },
        });
      }
    }

    // If no OR conditions, return empty
    if (searchQuery.$or.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        count: 0,
      });
    }

    const conversations = await Conversation.find(searchQuery)
      .populate({
        path: "participants",
        select: "username avatar status online lastSeen",
        match: { _id: { $ne: userId } },
      })
      .populate("groupAdmin", "username avatar")
      .limit(20);

    // Format results
    const formattedResults = conversations.map((conv) => {
      const convObj = conv.toObject();

      if (conv.isGroup) {
        convObj.type = "group";
        convObj.displayName = conv.groupName;
        convObj.displayAvatar = conv.groupAvatar;
      } else {
        convObj.type = "user";
        const otherParticipant = conv.participants.find(
          (p) => p && p._id.toString() !== userId
        );
        convObj.displayName = otherParticipant?.username || "Unknown";
        convObj.displayAvatar = otherParticipant?.avatar || null;
        convObj.otherParticipant = otherParticipant;
      }

      convObj.unreadCount = conv.unreadCount.get(userId.toString()) || 0;
      convObj.isMuted = conv.mutedBy.includes(userId);

      return convObj;
    });

    res.status(200).json({
      success: true,
      data: formattedResults,
      count: formattedResults.length,
    });
  } catch (err) {
    console.error("Search Conversations Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to search conversations.",
    });
  }
};

// 🔟 Set Group Admin
const setGroupAdmin = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId: newAdminId } = req.body;
    const currentAdminId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      groupAdmin: currentAdminId,
      participants: newAdminId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found, you are not admin, or user not in group.",
      });
    }

    const oldAdminId = conversation.groupAdmin;
    conversation.groupAdmin = newAdminId;
    await conversation.save();

    res.status(200).json({
      success: true,
      message: "Group admin changed.",
      data: {
        oldAdminId,
        newAdminId,
      },
    });
  } catch (err) {
    console.error("Set Group Admin Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to change group admin.",
    });
  }
};

// 1️⃣1️⃣ Ban User from Group
const banUserFromConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId: banUserId, reason } = req.body;
    const adminId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      groupAdmin: adminId,
      participants: banUserId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found, you are not admin, or user not in group.",
      });
    }

    // Check if already banned
    const alreadyBanned = conversation.bannedUsers.some(
      (ban) => ban.userId.toString() === banUserId
    );

    if (alreadyBanned) {
      return res.status(400).json({
        success: false,
        error: "User already banned.",
      });
    }

    // Add to banned users
    conversation.bannedUsers.push({
      userId: banUserId,
      bannedBy: adminId,
      reason: reason || null,
    });

    // Remove from participants
    conversation.participants = conversation.participants.filter(
      (participant) => participant.toString() !== banUserId
    );

    // Remove unread count
    conversation.unreadCount.delete(banUserId.toString());

    await conversation.save();

    res.status(200).json({
      success: true,
      message: "User banned from group.",
      data: {
        userId: banUserId,
        bannedBy: adminId,
        reason: reason || null,
      },
    });
  } catch (err) {
    console.error("Ban User Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to ban user.",
    });
  }
};

// 1️⃣2️⃣ Unban User from Group
const unbanUserFromConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { userId: unbanUserId } = req.body;
    const adminId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      groupAdmin: adminId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found or you are not admin.",
      });
    }

    // Remove from banned users
    conversation.bannedUsers = conversation.bannedUsers.filter(
      (ban) => ban.userId.toString() !== unbanUserId
    );

    await conversation.save();

    res.status(200).json({
      success: true,
      message: "User unbanned from group.",
      data: {
        userId: unbanUserId,
      },
    });
  } catch (err) {
    console.error("Unban User Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to unban user.",
    });
  }
};

// 1️⃣3️⃣ Update Last Message in Conversation
const updateLastMessageInConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { messageId } = req.body;
    const userId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }

    // Verify message exists and belongs to conversation
    const message = await Message.findOne({
      _id: messageId,
      conversationId,
    });

    if (!message) {
      return res.status(404).json({
        success: false,
        error: "Message not found.",
      });
    }

    conversation.lastMessage = messageId;
    await conversation.save();

    res.status(200).json({
      success: true,
      message: "Last message updated.",
    });
  } catch (err) {
    console.error("Update Last Message Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update last message.",
    });
  }
};

// 1️⃣4️⃣ Toggle Mute Conversation
const toggleMuteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    const { mute  } = req.body;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Conversation not found.",
      });
    }


    if (mute) {
      // Add to mutedBy if not already muted
      if (!conversation.mutedBy.includes(userId)) {
        conversation.mutedBy.push(userId);
      }
    } else {
      // Remove from mutedBy
      conversation.mutedBy = conversation.mutedBy.filter(
        (id) => id.toString() !== userId
      );
    }

    await conversation.save();

    res.status(200).json({
      success: true,
      message: mute ? "Conversation muted." : "Conversation unmuted.",
      data: {
        isMuted: mute,
      },
    });
  } catch (err) {
    console.error("Toggle Mute Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to toggle mute.",
    });
  }
};

// 1️⃣5️⃣ Leave Group
const leaveConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;

    const conversation = await Conversation.findOne({
      _id: conversationId,
      isGroup: true,
      participants: userId,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: "Group not found or you are not a member.",
      });
    }

    // Check if user is admin
    if (conversation.groupAdmin?.toString() === userId) {
      return res.status(400).json({
        success: false,
        error: "Group admin cannot leave. Transfer admin rights first.",
      });
    }

    // Remove user from participants
    conversation.participants = conversation.participants.filter(
      (participant) => participant.toString() !== userId
    );

    // Remove unread count
    conversation.unreadCount.delete(userId.toString());

    // Remove from mutedBy
    conversation.mutedBy = conversation.mutedBy.filter(
      (id) => id.toString() !== userId
    );

    // Remove from archivedBy
    conversation.archivedBy = conversation.archivedBy.filter(
      (id) => id.toString() !== userId
    );

    await conversation.save();

    res.status(200).json({
      success: true,
      message: "You have left the group.",
    });
  } catch (err) {
    console.error("Leave Group Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to leave group.",
    });
  }
};

module.exports = {
  createConversation,
  getUserConversations,
  getConversationById,
  deleteConversation,
  addParticipantToConversation,
  removeParticipantFromConversation,
  changeGroupName,
  changeGroupAvatar,
  searchConversations,
  setGroupAdmin,
  banUserFromConversation,
  unbanUserFromConversation,
  updateLastMessageInConversation,
  toggleMuteConversation,
  leaveConversation,
};
