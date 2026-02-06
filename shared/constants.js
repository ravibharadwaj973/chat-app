// Message Events
const MESSAGE_EVENTS = {
  // Client emits these
  SEND_MESSAGE: 'send-message',
  MESSAGE_DELIVERED: 'message-delivered',
  MESSAGE_READ: 'message-read',
  ADD_REACTION: 'reaction:add',
  REMOVE_REACTION: 'reaction:remove',
  REPLY_MESSAGE: 'reply-message',
  DELETE_MESSAGE: 'message:delete',
  
  // Server emits these
  NEW_MESSAGE: 'new-message',
  MESSAGE_SENT: 'message-sent',
  MESSAGE_DELIVERY_UPDATE: 'message-delivery-update',
  MESSAGE_READ_UPDATE: 'message-read-update',
  REACTION_ADDED: 'reaction-added',
  REACTION_REMOVED: 'reaction-removed',
  MESSAGE_DELETED: 'message-deleted',
  MESSAGE_DELETED_FOR_EVERYONE: 'message-deleted-for-everyone',
  
  // Typing events
  TYPING_START: 'typing-start',
  TYPING_STOP: 'typing-stop',
  USER_TYPING: 'user-typing',
  
  // Error events
  MESSAGE_ERROR: 'message-error',
  REACTION_ERROR: 'reaction-error',
  REPLY_ERROR: 'reply-error',
  DELETE_ERROR: 'delete-error',
};

// User Events
const USER_EVENTS = {
  USER_ONLINE: 'user-online',
  USER_OFFLINE: 'user-offline',
  USER_STATUS_CHANGE: 'user-status-change',
  FRIEND_ONLINE: 'friend-online',
  FRIEND_OFFLINE: 'friend-offline',
};

// Conversation Events
const CONVERSATION_EVENTS = {
  JOIN_CONVERSATION: 'join-conversation',
  LEAVE_CONVERSATION: 'leave-conversation',
  NEW_PARTICIPANT: 'new-participant',
  PARTICIPANT_LEFT: 'participant-left',
  CONVERSATION_CREATED: 'conversation-created',
  CONVERSATION_UPDATED: 'conversation-updated',
};

// Connection Events
const CONNECTION_EVENTS = {
  CONNECT: 'connect',
  DISCONNECT: 'disconnect',
  CONNECT_ERROR: 'connect_error',
  PING: 'ping',
  PONG: 'pong',
};

// Event constants
FRIEND_EVENTS = {
  REQUEST_RECEIVED: 'friend-request-received',
  REQUEST_ACCEPTED: 'friend-request-accepted',
  REQUEST_REJECTED: 'friend-request-rejected',
  REQUEST_CANCELLED: 'friend-request-cancelled',
  FRIEND_ADDED: 'friend-added',
  FRIEND_REMOVED: 'friend-removed',
  USER_BLOCKED_YOU: 'user-blocked-you',
  FRIEND_STATUS_CHANGED: 'friend-status-changed',
  FRIENDS_LIST_UPDATED: 'friends-list-updated'
};


module.exports = {
  MESSAGE_EVENTS,
  USER_EVENTS,
  CONVERSATION_EVENTS,
  CONNECTION_EVENTS,
  FRIEND_EVENTS,
};