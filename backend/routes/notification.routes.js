const express = require('express');
const router = express.Router();
const {  getUserNotifications,
  markAsRead,
  updateNotificationSettings,
  getNotificationSettings,
  createNotification,
  getUnreadCount,
  clearAllNotifications,
  markAllAsRead,
  deleteNotification,} = require('../controllers/notification.controller');
const {authenticate} = require('../middleware/auth.middleware');

// All routes require authentication
router.use(authenticate);

// GET /api/notifications - Get user notifications
router.get('/', getUserNotifications);

// GET /api/notifications/unread-count - Get unread count
router.get('/unread-count', getUnreadCount);

// GET /api/notifications/settings - Get notification settings
router.get('/settings', getNotificationSettings);

// PATCH /api/notifications/settings - Update notification settings
router.patch('/settings', updateNotificationSettings);

// PATCH /api/notifications/:notificationId/read - Mark as read
router.patch('/:notificationId/read', markAsRead);

// PATCH /api/notifications/read/all - Mark all as read
router.patch('/read/all', markAllAsRead);

// DELETE /api/notifications/:notificationId - Delete notification
router.delete('/:notificationId', deleteNotification);

// DELETE /api/notifications - Clear all notifications
router.delete('/',clearAllNotifications);

module.exports = router;