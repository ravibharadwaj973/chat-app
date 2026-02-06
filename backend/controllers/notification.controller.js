const Notification = require("../models/notification");
const mongoose = require("mongoose");
const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      type,
      unreadOnly = false,
      before,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = { recipient: userId };

    if (type) {
      query.type = type;
    }

    if (unreadOnly === "true") {
      query.read = false;
    }

    if (before) {
      query.createdAt = { $lt: new Date(before) };
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .populate({
          path: "sender",
          select: "username avatar status online",
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Notification.countDocuments(query),
    ]);

    // Format notifications
    const formattedNotifications = notifications.map((notif) => {
      const notification = notif.toObject();

      // Format date
      notification.formattedDate = formatDate(notification.createdAt);
      notification.timeAgo = timeAgo(notification.createdAt);

      return notification;
    });

    // Get unread count
    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      read: false,
    });

    res.status(200).json({
      success: true,
      data: formattedNotifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
        hasMore: total > skip + formattedNotifications.length,
      },
      unreadCount,
      totalCount: total,
    });
  } catch (err) {
    console.error("Get Notifications Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to fetch notifications.",
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndUpdate(
      {
        _id: notificationId,
        recipient: userId,
      },
      { read: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification marked as read.",
      data: notification,
    });
  } catch (err) {
    console.error("Mark as Read Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to mark notification as read.",
    });
  }
};
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.id;

    await Notification.updateMany(
      {
        recipient: userId,
        read: false,
      },
      { read: true }
    );

    res.status(200).json({
      success: true,
      message: "All notifications marked as read.",
    });
  } catch (err) {
    console.error("Mark All as Read Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to mark notifications as read.",
    });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.id;

    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      recipient: userId,
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: "Notification not found.",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted.",
    });
  } catch (err) {
    console.error("Delete Notification Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to delete notification.",
    });
  }
};

const clearAllNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;

    const query = { recipient: userId };
    if (type) {
      query.type = type;
    }

    await Notification.deleteMany(query);

    res.status(200).json({
      success: true,
      message: "All notifications cleared.",
    });
  } catch (err) {
    console.error("Clear All Notifications Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to clear notifications.",
    });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user.id;

    const total = await Notification.countDocuments({
      recipient: userId,
      read: false,
    });

    // Get counts by type
    const counts = await Notification.aggregate([
      {
        $match: {
          recipient: mongoose.Types.ObjectId(userId),
          read: false,
        },
      },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]);

    const byType = counts.reduce((obj, item) => {
      obj[item._id] = item.count;
      return obj;
    }, {});

    res.status(200).json({
      success: true,
      data: {
        total,
        byType,
      },
    });
  } catch (err) {
    console.error("Get Unread Count Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to get unread count.",
    });
  }
};
const createNotification = async (req, res) => {
  try {
    const notification = await Notification.create(data);

    // Populate sender if exists
    if (data.sender) {
      await notification.populate({
        path: "sender",
        select: "username avatar status online",
      });
    }

    return notification;
  } catch (err) {
    console.error("Create Notification Error:", err);
    return null;
  }
};

const getNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await User.findById(userId).select("notificationSettings");

    res.status(200).json({
      success: true,
      data: user.notificationSettings || getDefaultSettings(),
    });
  } catch (err) {
    console.error("Get Settings Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to get notification settings.",
    });
  }
};
const updateNotificationSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = req.body;

    await User.findByIdAndUpdate(userId, {
      $set: { notificationSettings: settings },
    });

    res.status(200).json({
      success: true,
      message: "Notification settings updated.",
      data: settings,
    });
  } catch (err) {
    console.error("Update Settings Error:", err);
    res.status(500).json({
      success: false,
      error: "Failed to update notification settings.",
    });
  }
};

function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);

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
}

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getDefaultSettings() {
  return {
    friendRequests: true,
    messages: true,
    groupInvites: true,
    mentions: true,
    calls: true,
    systemUpdates: true,
    sounds: true,
    desktopNotifications: true,
    emailNotifications: false,
    muteUntil: null,
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
    },
  };
}
module.exports = {
  getUserNotifications,
  markAsRead,
  updateNotificationSettings,
  getNotificationSettings,
  createNotification,
  getUnreadCount,
  clearAllNotifications,
  markAllAsRead,
  deleteNotification,
};
