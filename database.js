const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

// Database path
const dbPath = path.join(__dirname, 'social.db');
const db = new DatabaseSync(dbPath);

console.log(`Database connected successfully at: ${dbPath}`);

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');

// Create tables
function initDb() {
  // 1. Users Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      bio TEXT,
      profile_pic TEXT DEFAULT '/uploads/default-avatar.png',
      cover_pic TEXT DEFAULT '/uploads/default-cover.png',
      interest_tags TEXT, -- Comma-separated list (e.g. "tech,gaming,food")
      is_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      reset_token TEXT,
      reset_token_expiry INTEGER,
      two_factor_secret TEXT,
      two_factor_enabled INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Posts Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      image_url TEXT,
      tags TEXT, -- Comma-separated tags
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. Comments Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      sentiment TEXT, -- "positive", "neutral", "negative"
      sentiment_score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. Likes Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
  `);

  // 5. Followers Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS followers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      follower_id INTEGER NOT NULL,
      followed_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(follower_id, followed_id),
      FOREIGN KEY(follower_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(followed_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 6. Messages Table (Chat)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id INTEGER NOT NULL,
      receiver_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 7. Notifications Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL, -- Target user
      sender_id INTEGER NOT NULL, -- Actor triggering the notification
      type TEXT NOT NULL, -- "like", "comment", "follow", "message"
      reference_id INTEGER, -- post_id or comment_id, etc.
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 8. Reports Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL,
      target_type TEXT NOT NULL, -- "post", "comment", "user"
      target_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      status TEXT DEFAULT "pending", -- "pending", "resolved"
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reporter_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 9. Stories Table (expires after 24h by query logic)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_url TEXT NOT NULL,
      media_type TEXT NOT NULL, -- "image" or "video"
      view_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 10. Story Views Table (unique views tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS story_views (
      story_id INTEGER NOT NULL,
      viewer_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(story_id, viewer_id),
      FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY(viewer_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 11. Highlights Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS highlights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      cover_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 12. Highlight Stories Mapping Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS highlight_stories (
      highlight_id INTEGER NOT NULL,
      story_id INTEGER NOT NULL,
      PRIMARY KEY(highlight_id, story_id),
      FOREIGN KEY(highlight_id) REFERENCES highlights(id) ON DELETE CASCADE,
      FOREIGN KEY(story_id) REFERENCES stories(id) ON DELETE CASCADE
    );
  `);

  // Create default admin user if not exists
  const checkAdmin = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
  const adminExists = checkAdmin.get();

  if (!adminExists) {
    const adminUsername = 'admin';
    const adminEmail = 'admin@social.com';
    const adminPassword = 'adminpassword123';
    const hash = bcrypt.hashSync(adminPassword, 10);
    
    const createAdmin = db.prepare(`
      INSERT INTO users (username, email, password_hash, is_verified, is_admin, interest_tags, bio)
      VALUES (?, ?, ?, 1, 1, 'tech,news,management', 'System Administrator')
    `);
    
    createAdmin.run(adminUsername, adminEmail, hash);
    console.log('Default Admin Account Created:');
    console.log('Username: admin');
    console.log('Password: adminpassword123');
  }
}

initDb();

module.exports = db;
