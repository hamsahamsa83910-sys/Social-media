const dotenv = require('dotenv');
dotenv.config();

// Custom lexicon for sentiment analysis
const positiveWords = new Set([
  'love', 'great', 'awesome', 'amazing', 'beautiful', 'cool', 'wonderful', 'excellent',
  'fantastic', 'good', 'happy', 'nice', 'sweet', 'perfect', 'lovely', 'brilliant',
  'smart', 'fun', 'kind', 'glad', 'proud', 'super', 'best', 'creative', 'friendly',
  'helpful', 'genius', 'masterpiece', 'agree', 'yes', 'true', 'wow', 'incredible'
]);

const negativeWords = new Set([
  'hate', 'bad', 'terrible', 'worst', 'stupid', 'dumb', 'ugly', 'useless', 'boring',
  'annoying', 'disgusting', 'fake', 'rubbish', 'trash', 'idiot', 'loser', 'jerk',
  'moron', 'rude', 'mean', 'angry', 'sad', 'wrong', 'liar', 'cheat', 'scam', 'poor',
  'awful', 'horrible', 'hate', 'dislike', 'suck', 'sucks', 'fail', 'failure'
]);

const intensifiers = new Set(['very', 'extremely', 'really', 'so', 'super', 'totally', 'highly']);
const negations = new Set(['not', 'no', 'never', 'dont', 'doesnt', 'didnt', 'wont', 'cant', 'cannot', 'neither', 'nor']);

// Profanity list for toxicity check
const toxicWords = new Set([
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'slut', 'whore', 'dick', 'pussy',
  'idiot', 'retard', 'faggot', 'nigger', 'kike', 'motherfuck', 'motherfucker', 'dumbass',
  'dipshit', 'jackass', 'cocksucker', 'wanker', 'prick'
]);

/**
 * AI Sentiment Analysis (Lexicon-based)
 * Evaluates the tone of a string of text.
 */
function analyzeSentiment(text) {
  if (!text || typeof text !== 'string') {
    return { sentiment: 'neutral', score: 0 };
  }

  // Tokenize and clean text
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  let score = 0;
  let negated = false;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (negations.has(word)) {
      negated = !negated;
      continue;
    }

    let wordScore = 0;
    if (positiveWords.has(word)) {
      wordScore = 1;
    } else if (negativeWords.has(word)) {
      wordScore = -1;
    }

    if (wordScore !== 0) {
      // Check for preceding intensifier
      if (i > 0 && intensifiers.has(words[i - 1])) {
        wordScore *= 2;
      }
      // Apply negation
      if (negated) {
        wordScore *= -1;
        negated = false; // Reset negation
      }
      score += wordScore;
    }
  }

  let sentiment = 'neutral';
  if (score > 0.5) sentiment = 'positive';
  else if (score < -0.5) sentiment = 'negative';

  return {
    sentiment,
    score: parseFloat((score / Math.max(words.length, 1)).toFixed(2))
  };
}

/**
 * Toxic Comment Detection
 * Warns users if their post contains toxic/offensive text.
 */
function checkToxicity(text) {
  if (!text || typeof text !== 'string') {
    return { isToxic: false, matches: [] };
  }

  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const matches = [];
  for (const word of words) {
    if (toxicWords.has(word)) {
      matches.push(word);
    }
  }

  return {
    isToxic: matches.length > 0,
    matches: [...new Set(matches)]
  };
}

/**
 * AI Caption Generator
 * Integrates Gemini API if GEMINI_API_KEY is defined in environment variables,
 * otherwise falls back to a clever template-based generator.
 */
async function generateCaption(tagsString, promptContext = '') {
  const tags = tagsString
    ? tagsString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : [];

  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      // Direct call to Google Gemini API
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Generate a catchy, short, and highly engaging social media caption based on these tags: ${tags.join(', ')}. Context: ${promptContext || 'General post'}. Include emojis and relevant hashtags. Keep it under 200 characters.`
            }]
          }]
        })
      });

      const data = await response.json();
      if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts[0]) {
        return data.candidates[0].content.parts[0].text.trim();
      }
    } catch (error) {
      console.error('Gemini API error, falling back to local generator:', error.message);
    }
  }

  // Local fallback caption generator
  const templates = {
    tech: [
      "Stepping into the future, one line of code at a time. 💻✨ {context}",
      "Tech is not just what we build, it's how we think. 🚀 {context}",
      "Building things that make life smarter. What are you coding today? 🛠️🧠 {context}",
      "Another day, another bug solved. Coffee in hand, code in mind. ☕💻 {context}"
    ],
    travel: [
      "Wanderlust status: Active. 🌍✈️ Exploring the unexplored! {context}",
      "Collect moments, not things. Today's adventure was magical. 🗺️🌄 {context}",
      "Finding paradise wherever I go. Where should I travel next? 🏝️🎒 {context}",
      "Lost in the beauty of the world. Pure serenity. 🌸✨ {context}"
    ],
    food: [
      "Good food = Good mood. Honestly, this tasted heavenly! 🍔🍕😋 {context}",
      "Cooking is love made visible. Homemade with passion. 🍲🍰🍳 {context}",
      "Calories don't count on weekends. Treat yourself! 🍩🍦✨ {context}",
      "Exploring local flavors. Food is the ultimate connection. 🍜🌶️ {context}"
    ],
    fitness: [
      "No excuses. Sweat now, shine later! 💪🔥 {context}",
      "Pushing limits and hitting goals. Consistency is the secret. 🏋️‍♂️📈 {context}",
      "Mindset is everything. Stronger than yesterday. 🧠✨ {context}",
      "Active body, peaceful mind. Wellness is a lifestyle. 🧘‍♂️🌿 {context}"
    ],
    general: [
      "Chasing dreams and making them reality. Have an amazing day! ✨🚀 {context}",
      "Gratitude changes everything. Finding joy in the little things. 🌸💛 {context}",
      "Life is a canvas, make it colorful. 🎨🌈 {context}",
      "Surround yourself with positive energy. Good vibes only! ✌️😎 {context}"
    ]
  };

  // Determine category based on tags
  let category = 'general';
  for (const tag of tags) {
    if (['tech', 'programming', 'code', 'coding', 'gadget', 'software', 'developer'].includes(tag)) {
      category = 'tech';
      break;
    } else if (['travel', 'adventure', 'trip', 'nature', 'explore', 'vacation'].includes(tag)) {
      category = 'travel';
      break;
    } else if (['food', 'cooking', 'chef', 'restaurant', 'delicious', 'eat', 'baking'].includes(tag)) {
      category = 'food';
      break;
    } else if (['fitness', 'workout', 'gym', 'health', 'running', 'sports', 'active'].includes(tag)) {
      category = 'fitness';
      break;
    }
  }

  const categoryTemplates = templates[category];
  const template = categoryTemplates[Math.floor(Math.random() * categoryTemplates.length)];
  
  let contextInsert = promptContext ? `(${promptContext})` : '';
  let caption = template.replace('{context}', contextInsert);

  // Append hashtags
  const hashtags = tags.map(tag => `#${tag.replace(/\s+/g, '')}`).slice(0, 3).join(' ');
  if (hashtags) {
    caption += ' ' + hashtags;
  }

  return caption;
}

/**
 * AI Content Recommendation
 * Recommends posts matching user interests.
 */
function getRecommendedPosts(userId, posts, userInterests) {
  if (!userInterests) return posts;

  const interests = userInterests.split(',').map(i => i.trim().toLowerCase()).filter(Boolean);

  return posts.map(post => {
    let score = 0;
    const postTags = post.tags ? post.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];

    // Calculate tag matches (Jaccard-like boost)
    for (const tag of postTags) {
      if (interests.includes(tag)) {
        score += 3; // strong interest match
      }
    }

    // Boost score based on engagement (likes and comments)
    score += (post.likes_count || 0) * 0.5;
    score += (post.comments_count || 0) * 0.3;

    // Recency boost: newer posts get slightly higher score
    const ageInHours = (Date.now() - new Date(post.created_at).getTime()) / (1000 * 60 * 60);
    score += Math.max(0, 10 - ageInHours * 0.2); // decay score over time

    return { ...post, recommendation_score: score };
  }).sort((a, b) => b.recommendation_score - a.recommendation_score);
}

/**
 * Smart Friend Suggestions
 * Recommends users to follow based on mutual followers and mutual interests.
 */
function getFriendSuggestions(userId, db) {
  // 1. Get current user interest tags
  const userQuery = db.prepare('SELECT interest_tags FROM users WHERE id = ?');
  const user = userQuery.get(userId);
  if (!user) return [];

  const myInterests = user.interest_tags
    ? user.interest_tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    : [];

  // 2. Get list of users the current user already follows
  const followingQuery = db.prepare('SELECT followed_id FROM followers WHERE follower_id = ?');
  const followingIds = followingQuery.all(userId).map(f => f.followed_id);

  // 3. Find candidates (all active, unbanned users, excluding self and already followed users)
  // We prepare dynamic placeholders for the ignored list
  const ignoreList = [userId, ...followingIds];
  const placeholders = ignoreList.map(() => '?').join(',');
  const candidatesQuery = db.prepare(`
    SELECT id, username, profile_pic, bio, interest_tags 
    FROM users 
    WHERE id NOT IN (${placeholders}) AND is_banned = 0 AND is_verified = 1
    LIMIT 20
  `);
  
  const candidates = candidatesQuery.all(...ignoreList);

  const suggestions = candidates.map(candidate => {
    let score = 0;
    
    // (a) Interest tags overlap
    const candInterests = candidate.interest_tags
      ? candidate.interest_tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
      : [];
      
    let matchingTagsCount = 0;
    const matchingInterestsList = [];
    for (const interest of candInterests) {
      if (myInterests.includes(interest)) {
        matchingTagsCount++;
        matchingInterestsList.push(interest);
      }
    }
    score += matchingTagsCount * 2; // Interest matching score weight: 2

    // (b) Mutual followers count
    // Find people followed by me who also follow the candidate
    const mutualsQuery = db.prepare(`
      SELECT COUNT(*) as count 
      FROM followers f1
      JOIN followers f2 ON f1.followed_id = f2.follower_id
      WHERE f1.follower_id = ? AND f2.followed_id = ?
    `);
    const mutuals = mutualsQuery.get(userId, candidate.id);
    const mutualCount = mutuals ? mutuals.count : 0;
    score += mutualCount * 3; // Mutual followers weight: 3

    return {
      id: candidate.id,
      username: candidate.username,
      profile_pic: candidate.profile_pic,
      bio: candidate.bio,
      mutual_count: mutualCount,
      interest_matches: matchingTagsCount,
      matching_interests: matchingInterestsList.join(', '),
      score: score
    };
  });

  // Filter out suggestions with zero overlap/interaction unless we need fillers, 
  // and sort by score descending
  return suggestions
    .filter(s => s.score > 0 || Math.random() > 0.5) // give some randomized potential recommendations
    .sort((a, b) => b.score - a.score)
    .slice(0, 5); // return top 5
}

/**
 * AI Tag Suggester
 * Extracts smart interest tags from post text content.
 */
function suggestTags(text) {
  if (!text || typeof text !== 'string') return '';
  
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  const matched = new Set();
  
  const rules = {
    tech: ['code', 'coding', 'react', 'node', 'javascript', 'python', 'java', 'programming', 'developer', 'software', 'api', 'tech', 'gadget', 'database', 'ai', 'gpt', 'llm', 'gemini'],
    travel: ['travel', 'nature', 'explorer', 'wanderlust', 'trip', 'flight', 'mountain', 'beach', 'sunset', 'sunrise', 'adventure', 'vacation', 'explore'],
    food: ['food', 'recipe', 'cooking', 'delicious', 'chef', 'pizza', 'dinner', 'sourdough', 'eating', 'lunch', 'eat', 'bake', 'cake'],
    fitness: ['gym', 'fitness', 'workout', 'run', 'cardio', 'exercise', 'health', 'coach', 'weights', 'training', 'healthy']
  };

  // Scan words matching rules
  for (const word of words) {
    for (const [tag, keywords] of Object.entries(rules)) {
      if (keywords.includes(word)) {
        matched.add(tag);
      }
    }
  }

  // Fallback to top nouns/adjectives > 4 chars if no rules matched
  if (matched.size === 0) {
    const candidateWords = words.filter(w => w.length > 4 && !['about', 'there', 'their', 'would', 'could', 'should', 'which', 'where', 'these', 'those'].includes(w));
    candidateWords.slice(0, 3).forEach(w => matched.add(w));
  }

  return Array.from(matched).join(', ');
}

/**
 * Trending AI Hashtags
 * Scans all posts and extracts popular tags.
 */
function getTrendingHashtags(db) {
  try {
    const postsQuery = db.prepare('SELECT tags FROM posts WHERE tags IS NOT NULL AND tags != ""');
    const allPostTags = postsQuery.all();
    
    const freq = {};
    allPostTags.forEach(p => {
      const tags = p.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      tags.forEach(t => {
        freq[t] = (freq[t] || 0) + 1;
      });
    });

    return Object.entries(freq)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // top 5 trending tags
  } catch (err) {
    console.error('Error fetching trending tags:', err);
    return [];
  }
}

module.exports = {
  analyzeSentiment,
  checkToxicity,
  generateCaption,
  getRecommendedPosts,
  getFriendSuggestions,
  suggestTags,
  getTrendingHashtags
};
