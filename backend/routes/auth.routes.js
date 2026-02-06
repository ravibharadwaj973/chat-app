const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  registerUser,
  loginUser,
  logoutUser,
  getMe,
  googleLogin
} = require('../controllers/auth.controller');

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/google', googleLogin);


// Protected routes
router.post('/logout', authenticate, logoutUser);
router.get('/me', authenticate, getMe);

module.exports = router;