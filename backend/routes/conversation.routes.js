const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
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
  leaveConversation
} = require('../../backend/controllers/conversation.controller');

// All routes require authentication
router.use(authenticate);

// Conversation CRUD
router.post('/', createConversation);
router.get('/', getUserConversations);
router.get('/search', searchConversations);
router.get('/:conversationId', getConversationById);
router.delete('/:conversationId', deleteConversation);
router.post('/:conversationId/leave', leaveConversation);

// Group management
router.post('/:conversationId/participants', authenticate,addParticipantToConversation);
router.delete('/:conversationId/participants', removeParticipantFromConversation);
router.put('/:conversationId/name', changeGroupName);
router.put('/:conversationId/avatar', changeGroupAvatar);
router.put('/:conversationId/admin', setGroupAdmin);
router.post('/:conversationId/ban', banUserFromConversation);
router.post('/:conversationId/unban', unbanUserFromConversation);

// User preferences
router.put('/:conversationId/mute', toggleMuteConversation);
router.put('/:conversationId/last-message', updateLastMessageInConversation);

module.exports = router;