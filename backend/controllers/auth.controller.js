const User = require('../../models/user');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Register User

const registerUser = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "All fields are required." 
      });
    }

    if (username.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: "Username must be at least 3 characters." 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false, 
        error: "Password must be at least 6 characters." 
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        error: "User already exists." 
      });
    }


    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await User.create({
      username,
      email,
      password: hashedPassword,
      online: true,
      status: "online",
      lastSeen: new Date(),
      bio: "Hey there! I'm new here.",
    });

    // Generate token
    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username,
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Add session
    user.sessions.push({ token });
    await user.save();

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Remove sensitive data
    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      status: user.status,
      online: user.online,
      bio: user.bio,
      lastSeen: user.lastSeen,
      friends: user.friends,
    };

    res.status(201).json({
      success: true,
      message: "User registered successfully.",
      data: userResponse,
      token
    });

  } catch (err) {
    console.error("Register Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Registration failed." 
    });
  }
};

// Login User
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Email and password are required." 
      });
    }
  

    // Find user
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(402).json({ 
        success: false, 
        error: "Invalid credentials." 
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid credentials." 
      });
    }

    // Generate token
    const token = jwt.sign(
      { 
        id: user._id, 
        username: user.username,
        email: user.email 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Update user status
    user.online = true;
    user.status = "online";
    user.lastSeen = new Date();
    user.sessions.push({ token });
    await user.save();

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Prepare response
    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      status: user.status,
      online: user.online,
      bio: user.bio,
      lastSeen: user.lastSeen,
      friends: user.friends,
    };

    res.status(200).json({
      success: true,
      message: "Login successful.",
      data: userResponse,
      token
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Login failed." 
    });
  }
};

// Logout User
const logoutUser = async (req, res) => {
  try {
    const token = req.token;
    const userId = req.user.id;

    // Remove token from user's sessions
    await User.findByIdAndUpdate(userId, {
      $pull: { sessions: { token } },
      $set: { 
        online: false, 
        status: "offline",
        lastSeen: new Date() 
      }
    });

    // Clear cookie
    res.clearCookie('token');

    res.status(200).json({
      success: true,
      message: "Logged out successfully."
    });

  } catch (err) {
    console.error("Logout Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Logout failed." 
    });
  }
};

// Google Login
const googleLogin = async (req, res) => {
  try {
    const { token: googleToken } = req.body;

    if (!googleToken) {
      return res.status(400).json({
        success: false,
        error: "Google token is required."
      });
    }

    // Verify Google Token
    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Google login failed: No email found."
      });
    }

    // Check if user exists
    let user = await User.findOne({ email });

    // If user does not exist → create
    if (!user) {
      user = await User.create({
        username: name.replace(/\s+/g, '').toLowerCase(), // remove spaces
        email,
        password: null,                 // NO LOCAL PASSWORD
        avatar: picture || null,
        online: true,
        status: "online",
        lastSeen: new Date(),
        bio: "Google user 🤖",
      });
    } else {
      // Update login state
      user.online = true;
      user.status = "online";
      user.lastSeen = new Date();
    }

    // Generate our own JWT
    const sessionToken = jwt.sign(
      {
        id: user._id,
        username: user.username,
        email: user.email
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Save session
    user.sessions.push({ token: sessionToken });
    await user.save();

    // Send cookie
    res.cookie('token', sessionToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Prepare user response
    const userResponse = {
      id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      status: user.status,
      online: user.online,
      bio: user.bio,
      lastSeen: user.lastSeen,
      friends: user.friends,
    };

    res.status(200).json({
      success: true,
      message: "Google login successful.",
      data: userResponse,
      token: sessionToken
    });

  } catch (err) {
    console.error("Google Login Error:", err);
    res.status(500).json({
      success: false,
      error: "Google login failed."
    });
  }
};

// Get Me
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -sessions')
      .populate('friends', 'username avatar status online lastSeen')
      .populate('blockedUsers', 'username avatar');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found." 
      });
    }

    res.status(200).json({
      success: true,
      data: user
    });

  } catch (err) {
    console.error("GetMe Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch user data." 
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  getMe,
  googleLogin
};