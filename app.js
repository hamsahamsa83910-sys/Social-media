const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const db = require('./database');
const { 
  analyzeSentiment, 
  checkToxicity, 
  generateCaption, 
  getRecommendedPosts, 
  getFriendSuggestions,
  suggestTags,
  getTrendingHashtags
} = require('./services/ai');
const { 
  sendVerificationCode, 
  sendPasswordResetCode, 
  generate2FA, 
  verify2FA 
} = require('./services/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkeysocialapp';

// Ensure public upload directories exist
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Copy default assets if not present
const defaultAvatar = path.join(uploadDir, 'default-avatar.png');
const defaultCover = path.join(uploadDir, 'default-cover.png');
if (!fs.existsSync(defaultAvatar)) {
  // Write a tiny 1x1 blue PNG buffer
  const avatarBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEfQHzbp45BwAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(defaultAvatar, avatarBuffer);
}
if (!fs.existsSync(defaultCover)) {
  // Write a tiny 1x1 purple PNG buffer
  const coverBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/DwAEfgH5b546xgAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(defaultCover, coverBuffer);
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp|gif|mp4|webm|ogg|mov|avi/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only images and videos are allowed!'));
  }
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token missing' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token is invalid or expired' });
    
    // Check if user exists and is not banned
    const userStmt = db.prepare('SELECT is_banned FROM users WHERE id = ?');
    const dbUser = userStmt.get(user.id);
    
    if (!dbUser) {
      return res.status(401).json({ error: 'User session invalid. Please log in again.' });
    }
    if (dbUser.is_banned === 1) {
      return res.status(403).json({ error: 'Your account has been banned.' });
    }
    
    req.user = user;
    next();
  });
}

// Map online users: userId -> socketId
const onlineUsers = new Map();

// Helper to create notifications and emit in real-time
function createNotification(userId, senderId, type, referenceId) {
  const targetId = parseInt(userId);
  const actorId = parseInt(senderId);
  if (targetId === actorId) return; // Don't notify yourself

  const stmt = db.prepare(`
    INSERT INTO notifications (user_id, sender_id, type, reference_id)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(targetId, actorId, type, referenceId);
  const notifId = result.lastInsertRowid;

  // Fetch full notification details to send
  const detailsStmt = db.prepare(`
    SELECT n.*, u.username as sender_username, u.profile_pic as sender_avatar
    FROM notifications n
    JOIN users u ON n.sender_id = u.id
    WHERE n.id = ?
  `);
  const notification = detailsStmt.get(notifId);

  // Send real-time if user is online
  const socketId = onlineUsers.get(targetId);
  if (socketId) {
    io.to(socketId).emit('new_notification', notification);
  }
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. AUTHENTICATION

// User Registration
app.post('/api/auth/register', (req, res) => {
  const { username, email, password, tags } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP
    const interestTags = tags || '';

    const stmt = db.prepare(`
      INSERT INTO users (username, email, password_hash, interest_tags, verification_token)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(username, email, hash, interestTags, code);
    
    sendVerificationCode(email, username, code);
    res.status(201).json({ message: 'Registration successful. Verification code sent to email.' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed: users.username')) {
      return res.status(400).json({ error: 'Username is already taken' });
    }
    if (error.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(400).json({ error: 'Email is already registered' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Verify Email during registration
app.post('/api/auth/verify-email', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and verification code are required' });

  const stmt = db.prepare('SELECT id, verification_token FROM users WHERE email = ?');
  const user = stmt.get(email);

  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const codeStr = String(code).trim();
  if (user.verification_token !== codeStr) return res.status(400).json({ error: 'Invalid verification code' });

  const verifyStmt = db.prepare('UPDATE users SET is_verified = 1, verification_token = NULL WHERE id = ?');
  verifyStmt.run(user.id);

  res.json({ message: 'Email verified successfully. You can now log in.' });
});

// User Login
app.post('/api/auth/login', (req, res) => {
  const { usernameOrEmail, password } = req.body;
  if (!usernameOrEmail || !password) return res.status(400).json({ error: 'All fields are required' });

  const stmt = db.prepare(`
    SELECT * FROM users 
    WHERE username = ? OR email = ?
  `);
  const user = stmt.get(usernameOrEmail, usernameOrEmail);

  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  if (user.is_banned === 1) return res.status(403).json({ error: 'This account has been banned by the administrator.' });
  if (user.is_verified === 0) {
    return res.status(403).json({ 
      error: 'Please verify your email before logging in.',
      requiresVerification: true,
      email: user.email
    });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) return res.status(401).json({ error: 'Invalid username or password' });

  // Handle Two-Factor Authentication (2FA)
  if (user.two_factor_enabled === 1) {
    return res.json({ 
      require2FA: true, 
      userId: user.id,
      message: 'Two-factor authentication is required'
    });
  }

  // Generate JWT token
  const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '24h' });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      bio: user.bio,
      profile_pic: user.profile_pic,
      cover_pic: user.cover_pic,
      isAdmin: user.is_admin
    }
  });
});

// Verify 2FA TOTP Code
app.post('/api/auth/verify-2fa', (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ error: 'User ID and TOTP code are required' });

  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const user = stmt.get(parseInt(userId));

  if (!user) return res.status(404).json({ error: 'User not found' });

  const verified = verify2FA(user.two_factor_secret, String(code).trim());
  if (!verified) return res.status(400).json({ error: 'Invalid verification code' });

  // Sign token
  const token = jwt.sign({ id: user.id, username: user.username, isAdmin: user.is_admin }, JWT_SECRET, { expiresIn: '24h' });
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      bio: user.bio,
      profile_pic: user.profile_pic,
      cover_pic: user.cover_pic,
      isAdmin: user.is_admin
    }
  });
});

// Forgot Password Request
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const stmt = db.prepare('SELECT id, username FROM users WHERE email = ?');
  const user = stmt.get(email);

  if (!user) return res.status(404).json({ error: 'No user registered with this email' });

  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit reset code
  const expiry = Date.now() + 15 * 60 * 1000; // 15 mins

  const updateStmt = db.prepare(`
    UPDATE users 
    SET reset_token = ?, reset_token_expiry = ? 
    WHERE id = ?
  `);
  updateStmt.run(code, expiry, user.id);

  sendPasswordResetCode(email, user.username, code);
  res.json({ message: 'Password recovery code has been sent to your email.' });
});

// Reset Password
app.post('/api/auth/reset-password', (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) return res.status(400).json({ error: 'All fields are required' });

  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  const user = stmt.get(email);

  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.reset_token || user.reset_token !== String(code).trim()) {
    return res.status(400).json({ error: 'Invalid recovery code' });
  }
  if (Date.now() > user.reset_token_expiry) {
    return res.status(400).json({ error: 'Recovery code has expired' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  const resetStmt = db.prepare(`
    UPDATE users 
    SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL 
    WHERE id = ?
  `);
  resetStmt.run(newHash, user.id);

  res.json({ message: 'Password has been reset successfully. You can now log in.' });
});

// Toggle 2FA in settings
app.post('/api/auth/toggle-2fa', authenticateToken, async (req, res) => {
  const { enable, code } = req.body;
  const userId = req.user.id;

  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  const user = stmt.get(userId);

  if (enable) {
    // If request has code, we are confirming/activating 2FA
    if (code) {
      const pendingSecret = req.body.secret;
      const verified = verify2FA(pendingSecret, String(code).trim());
      if (!verified) {
        return res.status(400).json({ error: 'Invalid authentication code. Verification failed.' });
      }

      const updateStmt = db.prepare(`
        UPDATE users 
        SET two_factor_enabled = 1, two_factor_secret = ? 
        WHERE id = ?
      `);
      updateStmt.run(pendingSecret, userId);
      return res.json({ enabled: true, message: '2FA has been successfully enabled!' });
    } else {
      // First step: generate secret and QR code to display
      try {
        const { secret, qrCode } = await generate2FA(user.username);
        return res.json({ qrCode, secret, message: 'Scan the QR code and verify with your authenticator app.' });
      } catch (err) {
        return res.status(500).json({ error: 'Could not generate 2FA credentials' });
      }
    }
  } else {
    // Disable 2FA
    if (!code) return res.status(400).json({ error: 'Authenticator code is required to disable 2FA' });
    const verified = verify2FA(user.two_factor_secret, String(code).trim());
    if (!verified) return res.status(400).json({ error: 'Invalid authenticator code. Deactivation denied.' });

    const disableStmt = db.prepare(`
      UPDATE users 
      SET two_factor_enabled = 0, two_factor_secret = NULL 
      WHERE id = ?
    `);
    disableStmt.run(userId);
    res.json({ enabled: false, message: '2FA has been disabled.' });
  }
});

// 2. USER FEED & POSTS

// Get Chronological Feed of Followed Users
app.get('/api/posts/feed', authenticateToken, (req, res) => {
  const userId = req.user.id;

  try {
    // Get posts from users followed, and also include the user's own posts
    const feedQuery = db.prepare(`
      SELECT p.*, u.username, u.profile_pic,
             (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
             (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id = ? 
         OR p.user_id IN (SELECT followed_id FROM followers WHERE follower_id = ?)
      ORDER BY p.created_at DESC
    `);
    const posts = feedQuery.all(userId, userId, userId);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get AI Recommended Feed
app.get('/api/posts/explore', authenticateToken, (req, res) => {
  const userId = req.user.id;

  try {
    // Fetch current user interests
    const userQuery = db.prepare('SELECT interest_tags FROM users WHERE id = ?');
    const user = userQuery.get(userId);
    const userInterests = user ? user.interest_tags : '';

    // Fetch all posts except those from banned users
    const exploreQuery = db.prepare(`
      SELECT p.*, u.username, u.profile_pic,
             (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
             (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
             (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE u.is_banned = 0
    `);
    const allPosts = exploreQuery.all(userId);
    
    // Sort and recommend via AI Recommendation Service
    const recommended = getRecommendedPosts(userId, allPosts, userInterests);
    res.json(recommended);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Post
app.post('/api/posts', authenticateToken, (req, res) => {
  const { content, imageUrl, tags } = req.body;
  const userId = req.user.id;

  if (!content) return res.status(400).json({ error: 'Post content cannot be empty' });

  try {
    const stmt = db.prepare(`
      INSERT INTO posts (user_id, content, image_url, tags)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(userId, content, imageUrl || null, tags || null);
    
    // Fetch full post to return
    const getPost = db.prepare(`
      SELECT p.*, u.username, u.profile_pic, 0 as likes_count, 0 as comments_count, 0 as is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = ?
    `);
    const post = getPost.get(result.lastInsertRowid);
    
    // Trigger real-time notifications to followers that user posted (optional enhancement)
    res.status(201).json(post);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Suggest Post Caption (AI Feature)
app.post('/api/posts/suggest-caption', authenticateToken, async (req, res) => {
  const { tags, context } = req.body;
  try {
    const caption = await generateCaption(tags, context);
    res.json({ caption });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Edit Post
app.put('/api/posts/:id', authenticateToken, (req, res) => {
  const { content, imageUrl, tags } = req.body;
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  if (!content) return res.status(400).json({ error: 'Post content cannot be empty' });

  const getPost = db.prepare('SELECT user_id FROM posts WHERE id = ?');
  const post = getPost.get(postId);

  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== userId && req.user.isAdmin !== 1) {
    return res.status(403).json({ error: 'Unauthorized to edit this post' });
  }

  const updateStmt = db.prepare(`
    UPDATE posts 
    SET content = ?, image_url = ?, tags = ? 
    WHERE id = ?
  `);
  updateStmt.run(content, imageUrl || null, tags || null, postId);

  res.json({ message: 'Post updated successfully' });
});

// Delete Post
app.delete('/api/posts/:id', authenticateToken, (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  const getPost = db.prepare('SELECT user_id FROM posts WHERE id = ?');
  const post = getPost.get(postId);

  if (!post) return res.status(404).json({ error: 'Post not found' });
  if (post.user_id !== userId && req.user.isAdmin !== 1) {
    return res.status(403).json({ error: 'Unauthorized to delete this post' });
  }

  const deleteStmt = db.prepare('DELETE FROM posts WHERE id = ?');
  deleteStmt.run(postId);

  res.json({ message: 'Post deleted successfully' });
});

// Like/Unlike Post
app.post('/api/posts/:id/like', authenticateToken, (req, res) => {
  const postId = parseInt(req.params.id);
  const userId = req.user.id;

  const postStmt = db.prepare('SELECT user_id FROM posts WHERE id = ?');
  const post = postStmt.get(postId);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Check if liked
  const checkStmt = db.prepare('SELECT id FROM likes WHERE user_id = ? AND post_id = ?');
  const likeRecord = checkStmt.get(userId, postId);

  if (likeRecord) {
    // Unlike
    const deleteStmt = db.prepare('DELETE FROM likes WHERE user_id = ? AND post_id = ?');
    deleteStmt.run(userId, postId);
    res.json({ liked: false });
  } else {
    // Like
    const insertStmt = db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)');
    insertStmt.run(userId, postId);
    
    // Notify post creator
    createNotification(post.user_id, userId, 'like', postId);
    res.json({ liked: true });
  }
});

// Report content
app.post('/api/posts/:id/report', authenticateToken, (req, res) => {
  const postId = parseInt(req.params.id);
  const { reason } = req.body;
  const reporterId = req.user.id;

  if (!reason) return res.status(400).json({ error: 'Reason for report is required' });

  // Get post owner to notify
  const postStmt = db.prepare('SELECT user_id FROM posts WHERE id = ?');
  const post = postStmt.get(postId);

  const stmt = db.prepare(`
    INSERT INTO reports (reporter_id, target_type, target_id, reason)
    VALUES (?, 'post', ?, ?)
  `);
  stmt.run(reporterId, postId, reason);

  if (post) {
    createNotification(post.user_id, reporterId, 'report', postId);
  }

  res.status(201).json({ message: 'Post has been reported to administrators.' });
});

// 3. COMMENTS SYSTEM

// Add Comment (with toxicity checks and sentiment analysis)
app.post('/api/comments', authenticateToken, (req, res) => {
  const { postId, content, bypassToxicity } = req.body;
  const userId = req.user.id;

  if (!postId || !content) return res.status(400).json({ error: 'Post ID and comment content are required' });

  // Toxic Check
  const toxicity = checkToxicity(content);
  if (toxicity.isToxic && !bypassToxicity) {
    return res.status(202).json({
      warn: true,
      error: 'Warning: Your comment contains potentially offensive or toxic language.',
      matches: toxicity.matches
    });
  }

  try {
    const postStmt = db.prepare('SELECT user_id FROM posts WHERE id = ?');
    const post = postStmt.get(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    // AI Sentiment Analysis
    const sentimentResult = analyzeSentiment(content);

    const insertStmt = db.prepare(`
      INSERT INTO comments (post_id, user_id, content, sentiment, sentiment_score)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = insertStmt.run(postId, userId, content, sentimentResult.sentiment, sentimentResult.score);
    const commentId = result.lastInsertRowid;

    // Fetch comment to return
    const getComment = db.prepare(`
      SELECT c.*, u.username, u.profile_pic
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.id = ?
    `);
    const comment = getComment.get(commentId);

    // Notify post creator
    createNotification(post.user_id, userId, 'comment', postId);

    res.status(201).json(comment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch comments for a post
app.get('/api/posts/:id/comments', authenticateToken, (req, res) => {
  const postId = parseInt(req.params.id);
  try {
    const stmt = db.prepare(`
      SELECT c.*, u.username, u.profile_pic
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `);
    const comments = stmt.all(postId);
    res.json(comments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Comment
app.delete('/api/comments/:id', authenticateToken, (req, res) => {
  const commentId = parseInt(req.params.id);
  const userId = req.user.id;

  const stmt = db.prepare('SELECT user_id FROM comments WHERE id = ?');
  const comment = stmt.get(commentId);

  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.user_id !== userId && req.user.isAdmin !== 1) {
    return res.status(403).json({ error: 'Unauthorized to delete this comment' });
  }

  const deleteStmt = db.prepare('DELETE FROM comments WHERE id = ?');
  deleteStmt.run(commentId);

  res.json({ message: 'Comment deleted successfully' });
});

// 4. USERS & PROFILES

// Get User Profile
app.get('/api/users/profile/:username', authenticateToken, (req, res) => {
  const username = req.params.username;
  const currentUserId = req.user.id;

  const profileStmt = db.prepare(`
    SELECT id, username, bio, profile_pic, cover_pic, interest_tags, is_admin, created_at,
           (SELECT COUNT(*) FROM followers WHERE followed_id = users.id) as followers_count,
           (SELECT COUNT(*) FROM followers WHERE follower_id = users.id) as following_count,
           (SELECT COUNT(*) FROM followers WHERE follower_id = ? AND followed_id = users.id) as is_following
    FROM users
    WHERE username = ? AND is_banned = 0
  `);
  const profile = profileStmt.get(currentUserId, username);

  if (!profile) return res.status(404).json({ error: 'User profile not found' });

  // Get user's posts
  const postsStmt = db.prepare(`
    SELECT p.*, u.username, u.profile_pic,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id) as likes_count,
           (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count,
           (SELECT COUNT(*) FROM likes WHERE post_id = p.id AND user_id = ?) as is_liked
    FROM posts p
    JOIN users u ON p.user_id = u.id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `);
  const posts = postsStmt.all(currentUserId, profile.id);

  res.json({ profile, posts });
});

// Edit Profile Bio/Interests
app.post('/api/users/profile/edit', authenticateToken, (req, res) => {
  const { bio, tags } = req.body;
  const userId = req.user.id;

  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET bio = ?, interest_tags = ? 
      WHERE id = ?
    `);
    stmt.run(bio || null, tags || null, userId);

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload Profile/Cover Image
app.post('/api/users/profile/upload', authenticateToken, upload.single('image'), (req, res) => {
  const { type } = req.body; // "avatar" or "cover"
  const userId = req.user.id;

  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  if (type !== 'avatar' && type !== 'cover') {
    return res.status(400).json({ error: 'Invalid upload type (must be "avatar" or "cover")' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  const dbColumn = type === 'avatar' ? 'profile_pic' : 'cover_pic';

  try {
    const stmt = db.prepare(`
      UPDATE users 
      SET ${dbColumn} = ? 
      WHERE id = ?
    `);
    stmt.run(fileUrl, userId);

    res.json({ 
      message: 'Photo updated successfully',
      fileUrl
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Follow/Unfollow User
app.post('/api/users/follow/:id', authenticateToken, (req, res) => {
  const followedId = parseInt(req.params.id);
  const followerId = req.user.id;

  if (parseInt(followedId) === followerId) {
    return res.status(400).json({ error: 'You cannot follow yourself' });
  }

  const checkUser = db.prepare('SELECT id FROM users WHERE id = ?');
  if (!checkUser.get(followedId)) {
    return res.status(404).json({ error: 'User does not exist' });
  }

  const followCheck = db.prepare('SELECT id FROM followers WHERE follower_id = ? AND followed_id = ?');
  const record = followCheck.get(followerId, followedId);

  if (record) {
    // Unfollow
    const stmt = db.prepare('DELETE FROM followers WHERE follower_id = ? AND followed_id = ?');
    stmt.run(followerId, followedId);
    res.json({ following: false });
  } else {
    // Follow
    const stmt = db.prepare('INSERT INTO followers (follower_id, followed_id) VALUES (?, ?)');
    stmt.run(followerId, followedId);
    
    // Notify target user
    createNotification(followedId, followerId, 'follow', followerId);
    res.json({ following: true });
  }
});

// Get User Followers List
app.get('/api/users/:id/followers', authenticateToken, (req, res) => {
  const targetUserId = parseInt(req.params.id);
  try {
    const stmt = db.prepare(`
      SELECT u.id, u.username, u.profile_pic, u.bio
      FROM followers f
      JOIN users u ON f.follower_id = u.id
      WHERE f.followed_id = ? AND u.is_banned = 0
    `);
    const list = stmt.all(targetUserId);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get User Following List
app.get('/api/users/:id/following', authenticateToken, (req, res) => {
  const targetUserId = parseInt(req.params.id);
  try {
    const stmt = db.prepare(`
      SELECT u.id, u.username, u.profile_pic, u.bio
      FROM followers f
      JOIN users u ON f.followed_id = u.id
      WHERE f.follower_id = ? AND u.is_banned = 0
    `);
    const list = stmt.all(targetUserId);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Smart Friend Suggestions Endpoint
app.get('/api/users/suggestions', authenticateToken, (req, res) => {
  const userId = req.user.id;
  try {
    const suggestions = getFriendSuggestions(userId, db);
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Report User
app.post('/api/users/:id/report', authenticateToken, (req, res) => {
  const targetUserId = parseInt(req.params.id);
  const { reason } = req.body;
  const reporterId = req.user.id;

  if (!reason) return res.status(400).json({ error: 'Reason for report is required' });

  const stmt = db.prepare(`
    INSERT INTO reports (reporter_id, target_type, target_id, reason)
    VALUES (?, 'user', ?, ?)
  `);
  stmt.run(reporterId, targetUserId, reason);
  res.status(201).json({ message: 'User has been reported to administrators.' });
});

// 5. CHAT SYSTEM

// Get all users current user has chat histories with
app.get('/api/chat/conversations', authenticateToken, (req, res) => {
  const userId = req.user.id;

  try {
    // Return users that messaged us, or we messaged, with last message
    const stmt = db.prepare(`
      SELECT DISTINCT u.id, u.username, u.profile_pic,
             (SELECT content FROM messages 
              WHERE (sender_id = u.id AND receiver_id = ?) 
                 OR (sender_id = ? AND receiver_id = u.id)
              ORDER BY created_at DESC LIMIT 1) as last_message,
             (SELECT created_at FROM messages 
              WHERE (sender_id = u.id AND receiver_id = ?) 
                 OR (sender_id = ? AND receiver_id = u.id)
              ORDER BY created_at DESC LIMIT 1) as last_message_time,
             (SELECT COUNT(*) FROM messages 
              WHERE sender_id = u.id AND receiver_id = ? AND is_read = 0) as unread_count
      FROM users u
      WHERE u.id != ? AND u.is_banned = 0 AND u.id IN (
        SELECT sender_id FROM messages WHERE receiver_id = ?
        UNION
        SELECT receiver_id FROM messages WHERE sender_id = ?
      )
      ORDER BY last_message_time DESC
    `);
    const conversations = stmt.all(userId, userId, userId, userId, userId, userId, userId, userId);
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Chat history between current user and user2
app.get('/api/chat/history/:userId', authenticateToken, (req, res) => {
  const me = req.user.id;
  const other = parseInt(req.params.userId);

  try {
    // Mark messages from other to me as read
    const readStmt = db.prepare(`
      UPDATE messages 
      SET is_read = 1 
      WHERE sender_id = ? AND receiver_id = ?
    `);
    readStmt.run(other, me);

    // Fetch message logs
    const historyStmt = db.prepare(`
      SELECT m.*, u.username as sender_name 
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `);
    const history = historyStmt.all(me, other, other, me);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. NOTIFICATIONS FETCH

app.get('/api/notifications', authenticateToken, (req, res) => {
  const userId = req.user.id;

  try {
    // Get notifications
    const stmt = db.prepare(`
      SELECT n.*, u.username as sender_username, u.profile_pic as sender_avatar
      FROM notifications n
      JOIN users u ON n.sender_id = u.id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC
      LIMIT 30
    `);
    const list = stmt.all(userId);

    // Mark as read
    const readStmt = db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?');
    readStmt.run(userId);

    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get unread notification counts
app.get('/api/notifications/unread-count', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const stmt = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0');
  const result = stmt.get(userId);
  res.json({ count: result ? result.count : 0 });
});

// 7. ADMIN ENDPOINTS

// Admin Dashboard stats
app.get('/api/admin/stats', authenticateToken, (req, res) => {
  if (req.user.isAdmin !== 1) return res.status(403).json({ error: 'Admin access required' });

  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalPosts = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;
    const totalComments = db.prepare('SELECT COUNT(*) as count FROM comments').get().count;
    const totalReports = db.prepare('SELECT COUNT(*) as count FROM reports').get().count;

    // Get list of active reports
    const reportsQuery = db.prepare(`
      SELECT r.*, u.username as reporter_username,
        CASE 
          WHEN r.target_type = 'post' THEN (SELECT SUBSTR(content, 1, 40) FROM posts WHERE id = r.target_id)
          WHEN r.target_type = 'comment' THEN (SELECT SUBSTR(content, 1, 40) FROM comments WHERE id = r.target_id)
          WHEN r.target_type = 'user' THEN (SELECT username FROM users WHERE id = r.target_id)
        END as target_preview
      FROM reports r
      JOIN users u ON r.reporter_id = u.id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC
    `);
    const reports = reportsQuery.all();

    res.json({
      stats: {
        users: totalUsers,
        posts: totalPosts,
        comments: totalComments,
        reports: totalReports
      },
      reports
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ban/Unban user (Admin function)
app.post('/api/admin/users/:id/ban', authenticateToken, (req, res) => {
  if (req.user.isAdmin !== 1) return res.status(403).json({ error: 'Admin access required' });
  const targetId = parseInt(req.params.id);
  const { ban } = req.body; // boolean

  try {
    const checkUser = db.prepare('SELECT is_admin FROM users WHERE id = ?');
    const user = checkUser.get(targetId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_admin === 1) return res.status(400).json({ error: 'Cannot ban another administrator' });

    const banValue = ban ? 1 : 0;
    const stmt = db.prepare('UPDATE users SET is_banned = ? WHERE id = ?');
    stmt.run(banValue, targetId);

    // If banned, kick user socket connection if active
    if (ban) {
      const socketId = onlineUsers.get(parseInt(targetId));
      if (socketId) {
        io.to(socketId).emit('banned_disconnect', { message: 'You have been banned by the administrator.' });
        const socketObj = io.sockets.sockets.get(socketId);
        if (socketObj) socketObj.disconnect(true);
      }
    }

    res.json({ message: `User status updated. Banned: ${ban}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin Delete Post
app.delete('/api/admin/posts/:id', authenticateToken, (req, res) => {
  if (req.user.isAdmin !== 1) return res.status(403).json({ error: 'Admin access required' });
  const postId = parseInt(req.params.id);

  try {
    const stmt = db.prepare('DELETE FROM posts WHERE id = ?');
    stmt.run(postId);
    res.json({ message: 'Post removed by administrator.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resolve Report (Admin function)
app.post('/api/admin/reports/:id/resolve', authenticateToken, (req, res) => {
  if (req.user.isAdmin !== 1) return res.status(403).json({ error: 'Admin access required' });
  const reportId = parseInt(req.params.id);

  try {
    const stmt = db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?");
    stmt.run(reportId);
    res.json({ message: 'Report marked as resolved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI Tag Suggester Route
app.post('/api/posts/ai-suggest-tags', authenticateToken, (req, res) => {
  const { content } = req.body;
  const tags = suggestTags(content);
  res.json({ tags });
});

// Trending Hashtags Route
app.get('/api/posts/trending-tags', authenticateToken, (req, res) => {
  const trending = getTrendingHashtags(db);
  res.json(trending);
});

// Upload Media Endpoint (For posts and stories)
app.post('/api/posts/upload', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file provided' });
  const fileUrl = `/uploads/${req.file.filename}`;
  const isVideo = /mp4|webm|ogg|mov|avi/.test(path.extname(req.file.originalname).toLowerCase());
  res.json({ url: fileUrl, type: isVideo ? 'video' : 'image' });
});

// Upload Story Endpoint
app.post('/api/stories', authenticateToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No media file provided' });
  const userId = req.user.id;
  const fileUrl = `/uploads/${req.file.filename}`;
  const isVideo = /mp4|webm|ogg|mov|avi/.test(path.extname(req.file.originalname).toLowerCase());

  try {
    const stmt = db.prepare(`
      INSERT INTO stories (user_id, media_url, media_type)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(userId, fileUrl, isVideo ? 'video' : 'image');
    
    res.status(201).json({ 
      id: result.lastInsertRowid,
      user_id: userId,
      media_url: fileUrl,
      media_type: isVideo ? 'video' : 'image'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Active Stories Grouped by User (within last 24h)
app.get('/api/stories/active', authenticateToken, (req, res) => {
  try {
    const stmt = db.prepare(`
      SELECT s.*, u.username, u.profile_pic
      FROM stories s
      JOIN users u ON s.user_id = u.id
      WHERE datetime(s.created_at) >= datetime('now', '-24 hours') AND u.is_banned = 0
      ORDER BY s.created_at ASC
    `);
    const stories = stmt.all();
    
    // Group by user
    const grouped = {};
    stories.forEach(s => {
      if (!grouped[s.user_id]) {
        grouped[s.user_id] = {
          user_id: s.user_id,
          username: s.username,
          profile_pic: s.profile_pic,
          stories: []
        };
      }
      grouped[s.user_id].stories.push({
        id: s.id,
        media_url: s.media_url,
        media_type: s.media_type,
        view_count: s.view_count,
        created_at: s.created_at
      });
    });

    res.json(Object.values(grouped));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// View a story (Increment count uniquely)
app.post('/api/stories/:id/view', authenticateToken, (req, res) => {
  const storyId = parseInt(req.params.id);
  const viewerId = req.user.id;

  try {
    // Attempt to insert view log
    const viewStmt = db.prepare(`
      INSERT OR IGNORE INTO story_views (story_id, viewer_id)
      VALUES (?, ?)
    `);
    const result = viewStmt.run(storyId, viewerId);

    if (result.changes > 0) {
      // Increment view count in stories
      const updateStmt = db.prepare('UPDATE stories SET view_count = view_count + 1 WHERE id = ?');
      updateStmt.run(storyId);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Highlight Collection
app.post('/api/highlights', authenticateToken, (req, res) => {
  const { title, coverUrl } = req.body;
  const userId = req.user.id;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const stmt = db.prepare(`
      INSERT INTO highlights (user_id, title, cover_url)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(userId, title, coverUrl || null);
    
    res.status(201).json({
      id: result.lastInsertRowid,
      user_id: userId,
      title,
      cover_url: coverUrl || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add Story to Highlight
app.post('/api/highlights/:id/stories', authenticateToken, (req, res) => {
  const highlightId = parseInt(req.params.id);
  const storyId = parseInt(req.body.storyId);
  const userId = req.user.id;

  try {
    // Verify ownership of highlight
    const checkStmt = db.prepare('SELECT id FROM highlights WHERE id = ? AND user_id = ?');
    const highlight = checkStmt.get(highlightId, userId);
    if (!highlight) return res.status(403).json({ error: 'Unauthorized or highlight does not exist' });

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO highlight_stories (highlight_id, story_id)
      VALUES (?, ?)
    `);
    stmt.run(highlightId, storyId);

    // Update highlight cover to this story media url
    const storyStmt = db.prepare('SELECT media_url FROM stories WHERE id = ?');
    const story = storyStmt.get(storyId);
    if (story) {
      const updateCover = db.prepare('UPDATE highlights SET cover_url = ? WHERE id = ?');
      updateCover.run(story.media_url, highlightId);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Highlights & Stories for a User Profile
app.get('/api/users/:username/highlights', authenticateToken, (req, res) => {
  const username = req.params.username;

  try {
    const userStmt = db.prepare('SELECT id FROM users WHERE username = ?');
    const user = userStmt.get(username);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const highlightsQuery = db.prepare(`
      SELECT h.* 
      FROM highlights h
      WHERE h.user_id = ?
      ORDER BY h.created_at DESC
    `);
    const highlights = highlightsQuery.all(user.id);

    // Get stories mapping
    const populated = highlights.map(h => {
      const storiesQuery = db.prepare(`
        SELECT s.*
        FROM highlight_stories hs
        JOIN stories s ON hs.story_id = s.id
        WHERE hs.highlight_id = ?
        ORDER BY s.created_at ASC
      `);
      const stories = storiesQuery.all(h.id);
      return { ...h, stories };
    });

    res.json(populated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fallback: serve frontend index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ----------------------------------------------------
// SOCKET.IO REAL-TIME CHAT & NOTIFICATIONS
// ----------------------------------------------------

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication error: Token missing'));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('Authentication error: Token invalid'));
    
    // Check if user exists in db
    const userStmt = db.prepare('SELECT id, is_banned FROM users WHERE id = ?');
    const dbUser = userStmt.get(decoded.id);
    if (!dbUser || dbUser.is_banned === 1) {
      return next(new Error('Authentication error: User invalid or banned'));
    }
    
    socket.user = decoded;
    next();
  });
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  console.log(`User connected: ${socket.user.username} (Socket: ${socket.id})`);

  // Send online users status updates (broadcast to everyone)
  io.emit('user_status_change', { userId, status: 'online' });

  // Handle direct message
  socket.on('send_message', (data, callback) => {
    const { receiverId, content } = data;
    if (!receiverId || !content) {
      if (callback) callback({ error: 'Recipient and content are required' });
      return;
    }

    try {
      // Save message
      const stmt = db.prepare(`
        INSERT INTO messages (sender_id, receiver_id, content)
        VALUES (?, ?, ?)
      `);
      const result = stmt.run(userId, receiverId, content);
      const msgId = result.lastInsertRowid;

      const getMsg = db.prepare(`
        SELECT m.*, u.username as sender_name 
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ?
      `);
      const savedMsg = getMsg.get(msgId);

      // Notify recipient room
      const receiverSocketId = onlineUsers.get(parseInt(receiverId));
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('incoming_message', savedMsg);
      }
      
      // Emit back to sender
      socket.emit('incoming_message', savedMsg);

      // Create notification
      createNotification(parseInt(receiverId), userId, 'message', msgId);

      if (callback) callback({ success: true, message: savedMsg });
    } catch (err) {
      if (callback) callback({ error: err.message });
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    console.log(`User disconnected: ${socket.user.username}`);
    // Broadcast offline status
    io.emit('user_status_change', { userId, status: 'offline' });
  });
});

// Run server
server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🔥 Mini Social Media App running on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
