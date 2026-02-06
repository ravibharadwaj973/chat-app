const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
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
  updateFriendSettings
} = require('../controllers/friend.controller');

// All routes require authentication
router.use(authenticate);

// Friend Requests
router.post('/requests', sendFriendRequest);
router.get('/requests', getPendingRequests);
router.delete('/requests/:requestId', cancelFriendRequest);
router.post('/requests/:requestId/accept', acceptFriendRequest);
router.post('/requests/:requestId/reject', rejectFriendRequest);

// Friends Management
router.get('/', getFriendsList);
router.delete('/:userId', removeFriend);
router.get('/suggestions', getFriendSuggestions);

// Block Management
router.post('/block/:userId', blockUser);
router.post('/unblock/:userId', unblockUser);
router.get('/blocked', getBlockedUsers);

// Settings
router.put('/settings', updateFriendSettings);

module.exports = router;