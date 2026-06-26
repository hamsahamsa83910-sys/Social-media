const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'social.db');
const db = new DatabaseSync(dbPath);

console.log('Populating database with premium mock data...');

// Helper to encrypt passwords
const hash = bcrypt.hashSync('password123', 10);

try {
  // Clear existing data (except admin)
  db.exec('DELETE FROM reports;');
  db.exec('DELETE FROM notifications;');
  db.exec('DELETE FROM messages;');
  db.exec('DELETE FROM followers;');
  db.exec('DELETE FROM likes;');
  db.exec('DELETE FROM comments;');
  db.exec('DELETE FROM posts;');
  db.exec("DELETE FROM users WHERE username != 'admin';");

  // Reset autoincrement keys
  db.exec("DELETE FROM sqlite_sequence WHERE name='users';");
  db.exec("DELETE FROM sqlite_sequence WHERE name='posts';");
  db.exec("DELETE FROM sqlite_sequence WHERE name='comments';");
  db.exec("DELETE FROM sqlite_sequence WHERE name='followers';");

  // 1. Create Mock Users
  const insertUser = db.prepare(`
    INSERT INTO users (username, email, password_hash, bio, profile_pic, cover_pic, interest_tags, is_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  // Alice - Tech Enthusiast
  const aliceResult = insertUser.run(
    'coder_alice',
    'alice@example.com',
    hash,
    'Software Engineer. Love JavaScript, building cool apps, and drinking coffee. ☕💻',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150',
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600',
    'tech,programming,gaming'
  );
  const aliceId = aliceResult.lastInsertRowid;

  // Bob - Travel Blogger
  const bobResult = insertUser.run(
    'travel_bob',
    'bob@example.com',
    hash,
    'Exploring the world one city at a time. Wanderlust traveler and photographer. ✈️🌍📸',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150',
    'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=600',
    'travel,nature,adventure'
  );
  const bobId = bobResult.lastInsertRowid;

  // Charlie - Foodie / Chef
  const charlieResult = insertUser.run(
    'chef_charlie',
    'charlie@example.com',
    hash,
    'Culinary explorer. Making delicious recipes and sharing local flavors. 🍕🍔🍣',
    'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150',
    'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600',
    'food,cooking,eating'
  );
  const charlieId = charlieResult.lastInsertRowid;

  // David - Fitness Coach
  const davidResult = insertUser.run(
    'fit_david',
    'david@example.com',
    hash,
    'Gym coach. Daily motivation, workout routines, and clean eating. 💪🏋️‍♂️🔥',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600',
    'fitness,workout,health'
  );
  const davidId = davidResult.lastInsertRowid;

  console.log('Mock users created successfully!');

  // 2. Create Follow Relationships (Creates Mutual Friend Graph)
  const insertFollow = db.prepare('INSERT INTO followers (follower_id, followed_id) VALUES (?, ?)');
  
  // Alice follows Bob & Charlie
  insertFollow.run(aliceId, bobId);
  insertFollow.run(aliceId, charlieId);
  
  // Bob follows Alice & David
  insertFollow.run(bobId, aliceId);
  insertFollow.run(bobId, davidId);
  
  // Charlie follows Alice & Bob
  insertFollow.run(charlieId, aliceId);
  insertFollow.run(charlieId, bobId);
  
  // David follows Alice & Charlie
  insertFollow.run(davidId, aliceId);
  insertFollow.run(davidId, charlieId);

  console.log('Follow relationships mapped successfully!');

  // 3. Create Posts
  const insertPost = db.prepare(`
    INSERT INTO posts (user_id, content, image_url, tags)
    VALUES (?, ?, ?, ?)
  `);

  // Post 1: Alice Coding
  const p1 = insertPost.run(
    aliceId,
    'Finally finished building this beautiful glassmorphic social media app! Check out the details. Coding in Node.js v24 feels amazing. 🚀🔥',
    'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=500',
    'tech,programming,code'
  ).lastInsertRowid;

  // Post 2: Bob Travel
  const p2 = insertPost.run(
    bobId,
    'Woke up early to catch this breathtaking sunrise over the mountains. The world is beautiful. 🌄🚶‍♂️🎒',
    'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=500',
    'travel,nature,adventure'
  ).lastInsertRowid;

  // Post 3: Charlie Pizza
  const p3 = insertPost.run(
    charlieId,
    'Making homemade wood-fired sourdough pizza tonight. Crispy, airy, and topped with fresh mozzarella and basil. 🍕🇮🇹😋',
    'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500',
    'food,cooking,delicious'
  ).lastInsertRowid;

  // Post 4: David Gym
  const p4 = insertPost.run(
    davidId,
    'Leg day is done! Consistency beats motivation every single time. Get up and hit your goals today! 💪🏋️‍♂️',
    'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=500',
    'fitness,workout,health'
  ).lastInsertRowid;

  // Post 5: Alice Tech News
  const p5 = insertPost.run(
    aliceId,
    'AI is moving so fast. Gemini 1.5 Flash generates captions and recommendations instantly. Are you leveraging LLMs in your current developer workflow? 🧠🤖',
    'https://images.unsplash.com/photo-1677442136019-21780efad99a?w=500',
    'tech,ai,future'
  ).lastInsertRowid;

  console.log('Mock posts created successfully!');

  // 4. Create Comments with Sentiment
  const insertComment = db.prepare(`
    INSERT INTO comments (post_id, user_id, content, sentiment, sentiment_score)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Comments on Alice's post
  insertComment.run(p1, bobId, 'This app design looks absolutely stunning Bob! Great work Alice!', 'positive', 0.85);
  insertComment.run(p1, charlieId, 'Wow! The glassmorphism blur and animations are super smooth.', 'positive', 0.9);
  insertComment.run(p1, davidId, 'I don’t know anything about code, but this looks neat.', 'neutral', 0.0);

  // Comments on Bob's travel post
  insertComment.run(p2, aliceId, 'This view is incredible! Where is this located? 🌍', 'positive', 0.8);
  insertComment.run(p2, davidId, 'Great place to go for a run. Looks very serene!', 'positive', 0.7);

  // Comments on Charlie's food post
  insertComment.run(p3, aliceId, 'OMG that looks so delicious! I want a slice right now! 🤤🍕', 'positive', 0.95);
  insertComment.run(p3, bobId, 'That pizza is bad for my travel diet, but I hate to miss it. Looks awesome!', 'positive', 0.4); // mixed but positive accent
  insertComment.run(p3, davidId, 'I avoid carbs, but honestly, this looks so beautiful.', 'positive', 0.6);

  // 5. Add some Likes
  const insertLike = db.prepare('INSERT INTO likes (user_id, post_id) VALUES (?, ?)');
  
  insertLike.run(bobId, p1);
  insertLike.run(charlieId, p1);
  insertLike.run(davidId, p1);
  
  insertLike.run(aliceId, p2);
  insertLike.run(davidId, p2);
  
  insertLike.run(aliceId, p3);
  insertLike.run(bobId, p3);

  console.log('Database successfully populated with clean mock data! 🌱');
  console.log('======================================================');
  console.log('Go to Explore AI or Home Feed to see the content.');
  console.log('Follow suggestions will also show Bob, Alice, Charlie, etc.');
  console.log('======================================================');

} catch (err) {
  console.error('Failed to seed database:', err.message);
}
