const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
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
} = require('../../backend/controllers/user.controller');
const upload = require('../middleware/upload');

// User profile routes
router.put('/profile', authenticate, updateProfile);

router.put('/status', authenticate, updateStatus);
router.post('/avatar', authenticate, upload.single('avatar'), updateAvatar);

// User relations routes
router.post('/friends/add', authenticate, addFriend);
router.post('/friends/remove', authenticate, removeFriend);
router.post('/block', authenticate, blockUser);
router.post('/unblock', authenticate, unblockUser);

// User discovery routes
router.get('/all', authenticate, getAllUsers);
router.get('/search', authenticate, searchUsers);
router.get('/online', authenticate, getOnlineUsers);

// Session management
router.post('/sessions/terminate-all', authenticate, terminateAllSessions);

module.exports = router;