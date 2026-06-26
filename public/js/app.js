// Global App State
window.authToken = localStorage.getItem('token') || null;
window.currentUser = JSON.parse(localStorage.getItem('user')) || null;
window.activePanel = 'feed-panel';
window.currentChattingUserId = null;
window.pendingVerificationEmail = null;

// Modal States
let currentReportType = null;
let currentReportId = null;
let currentEditPostId = null;
let current2FASecret = null;

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  // Theme initialization
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  // Authenticate user check
  if (window.authToken && window.currentUser) {
    setupAppView();
  } else {
    setupAuthView();
  }

  // Setup Event Listeners
  setupEventListeners();
});

// ----------------------------------------------------
// ROUTING & PANEL TOGGLES
// ----------------------------------------------------

function setupAuthView() {
  document.getElementById('auth-container').style.display = 'flex';
  document.getElementById('app-container').style.display = 'none';
  showAuthCard('login-card');
  disconnectSocket();
}

function setupAppView() {
  document.getElementById('auth-container').style.display = 'none';
  document.getElementById('app-container').style.display = 'flex';
  
  // Update user visual widgets
  updateUserWidgets();
  
  // Connect real-time socket
  initSocket(window.authToken);
  
  // Set active routing panel
  switchPanel('feed-panel');
  
  // Refresh side widgets
  loadSuggestions();
  loadTrendingTags();
  updateUnreadBadgeCount();
}

function showAuthCard(cardId) {
  const cards = ['login-card', 'register-card', 'verify-card', 'forgot-card', 'reset-card', 'twofa-card'];
  cards.forEach(id => {
    document.getElementById(id).style.display = id === cardId ? 'block' : 'none';
  });

  if (cardId === 'verify-card' && window.pendingVerificationEmail) {
    document.getElementById('verify-email').value = window.pendingVerificationEmail;
  } else if (cardId === 'reset-card' && window.pendingVerificationEmail) {
    document.getElementById('reset-email').value = window.pendingVerificationEmail;
  }
}

function switchPanel(panelId) {
  window.activePanel = panelId;
  
  // Hide all panels
  const panels = document.querySelectorAll('.app-panel');
  panels.forEach(p => p.style.display = 'none');
  
  // Show target panel
  const target = document.getElementById(panelId);
  if (target) {
    target.style.display = 'block';
  }
  
  // Update sidebar active classes
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    if (item.getAttribute('data-target') === panelId) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });

  // Reset chat targets
  if (panelId !== 'chat-panel') {
    window.currentChattingUserId = null;
  }

  // Update Title text
  let titleText = 'Home Feed';
  if (panelId === 'explore-panel') titleText = 'Explore AI';
  else if (panelId === 'chat-panel') titleText = 'Direct Messages';
  else if (panelId === 'notifications-panel') titleText = 'Notifications';
  else if (panelId === 'profile-panel') titleText = 'User Profile';
  else if (panelId === 'admin-panel') titleText = 'Admin Dashboard';
  
  document.getElementById('panel-title-text').innerText = titleText;

  // Execute panel loaded hooks
  if (panelId === 'feed-panel') {
    loadFeed();
    loadStories();
  }
  else if (panelId === 'explore-panel') loadExplore();
  else if (panelId === 'chat-panel') loadConversations();
  else if (panelId === 'notifications-panel') loadNotificationsList();
  else if (panelId === 'profile-panel') loadProfile(window.currentUser.username);
  else if (panelId === 'admin-panel') loadAdminPanel();
}

function updateUserWidgets() {
  if (!window.currentUser) return;
  
  // Fill sidebar widget
  document.getElementById('sidebar-user-name').innerText = window.currentUser.username;
  document.getElementById('sidebar-user-handle').innerText = `@${window.currentUser.username}`;
  document.getElementById('sidebar-user-avatar').src = window.currentUser.profile_pic || '/uploads/default-avatar.png';
  
  // Fill right mini widget
  document.getElementById('right-user-name').innerText = window.currentUser.username;
  document.getElementById('right-user-handle').innerText = `@${window.currentUser.username}`;
  document.getElementById('right-user-avatar').src = window.currentUser.profile_pic || '/uploads/default-avatar.png';
  
  // Set main avatar in create post card
  const mainUserAvatars = document.querySelectorAll('.main-user-avatar');
  mainUserAvatars.forEach(avatar => {
    avatar.src = window.currentUser.profile_pic || '/uploads/default-avatar.png';
  });

  // Admin link display toggle
  const adminLink = document.getElementById('nav-admin');
  if (window.currentUser.isAdmin === 1) {
    adminLink.style.display = 'flex';
  } else {
    adminLink.style.display = 'none';
  }
}

// ----------------------------------------------------
// API REQUESTS INTERFACES
// ----------------------------------------------------

async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (window.authToken) {
    headers['Authorization'] = `Bearer ${window.authToken}`;
  }

  const config = {
    method,
    headers
  };

  if (body) {
    config.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(endpoint, config);
    
    // Automatically log out if session token is invalid or user was deleted
    // Bypassing auth routes so that errors (like 403 unverified) can be handled correctly
    const isAuthRoute = endpoint.includes('/api/auth/');
    if ((response.status === 401 || response.status === 403) && !isAuthRoute) {
      performLogout();
      throw new Error('Session expired. Please log in again.');
    }
    
    const data = await response.json();
    if (!response.ok) {
      const err = new Error(data.error || 'Something went wrong');
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error.message);
    throw error;
  }
}

// ----------------------------------------------------
// AUTHENTICATION LOGIC
// ----------------------------------------------------

async function handleLogin(e) {
  e.preventDefault();
  const usernameOrEmail = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const data = await apiRequest('/api/auth/login', 'POST', { usernameOrEmail, password });
    
    if (data.require2FA) {
      // Prompt 2FA card
      window.pending2FAUserId = data.userId;
      showAuthCard('twofa-card');
      showToast('🛡️ Security Challenge', 'Please enter your 2FA verification code.', 'info');
    } else {
      // Success direct log in
      loginSuccess(data);
    }
  } catch (err) {
    if (err.data && err.data.requiresVerification) {
      window.pendingVerificationEmail = err.data.email;
      showAuthCard('verify-card');
      showToast('✉️ Verification Required', err.message || 'Please verify your email.', 'warning');
    } else {
      showToast('❌ Login Failed', err.message, 'error');
    }
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const tags = document.getElementById('reg-tags').value;

  try {
    const data = await apiRequest('/api/auth/register', 'POST', { username, email, password, tags });
    window.pendingVerificationEmail = email;
    showAuthCard('verify-card');
    showToast('✉️ OTP Sent', 'Check the server console output for your verification code!', 'success');
  } catch (err) {
    showToast('❌ Registration Failed', err.message, 'error');
  }
}

async function handleVerifyEmail(e) {
  e.preventDefault();
  const email = document.getElementById('verify-email').value;
  const code = document.getElementById('verify-code').value;

  try {
    await apiRequest('/api/auth/verify-email', 'POST', { 
      email, 
      code 
    });
    showToast('✅ Account Verified', 'You can now log in using your password.', 'success');
    showAuthCard('login-card');
  } catch (err) {
    showToast('❌ Verification Failed', err.message, 'error');
  }
}

async function handleVerify2FA(e) {
  e.preventDefault();
  const code = document.getElementById('twofa-code').value;

  try {
    const data = await apiRequest('/api/auth/verify-2fa', 'POST', { 
      userId: window.pending2FAUserId, 
      code 
    });
    loginSuccess(data);
  } catch (err) {
    showToast('❌ 2FA Authentication Failed', err.message, 'error');
  }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value;

  try {
    await apiRequest('/api/auth/forgot-password', 'POST', { email });
    window.pendingVerificationEmail = email;
    showAuthCard('reset-card');
    showToast('✉️ recovery Link Sent', 'Check the server console output for your recovery code!', 'success');
  } catch (err) {
    showToast('❌ Recovery Failed', err.message, 'error');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const email = document.getElementById('reset-email').value;
  const code = document.getElementById('reset-code').value;
  const newPassword = document.getElementById('reset-password').value;

  try {
    await apiRequest('/api/auth/reset-password', 'POST', { 
      email,
      code,
      newPassword
    });
    showToast('🔑 Password Updated', 'Your credentials were changed. Please log in.', 'success');
    showAuthCard('login-card');
  } catch (err) {
    showToast('❌ Password Reset Failed', err.message, 'error');
  }
}

function loginSuccess(data) {
  window.authToken = data.token;
  window.currentUser = data.user;
  
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  
  showToast('👋 Hello!', `Welcome back, ${data.user.username}!`, 'success');
  setupAppView();
}

function performLogout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.authToken = null;
  window.currentUser = null;
  
  showToast('ℹ️ System Log Out', 'You have been successfully logged out.', 'info');
  setupAuthView();
}

// ----------------------------------------------------
// POSTS & COMMENTS DRAWERS
// ----------------------------------------------------

async function loadFeed() {
  const listDiv = document.getElementById('feed-posts-list');
  listDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Reading feed...</p>';

  try {
    const posts = await apiRequest('/api/posts/feed');
    renderPostsList(posts, listDiv);
  } catch (err) {
    listDiv.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 40px 0;">Error fetching feed: ${err.message}</p>`;
  }
}

async function loadExplore(tagFilter = 'all') {
  const listDiv = document.getElementById('explore-posts-list');
  listDiv.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Exploring recommendations...</p>';

  try {
    let posts = await apiRequest('/api/posts/explore');
    
    // Client-side category filtering helper
    if (tagFilter !== 'all') {
      posts = posts.filter(post => {
        const postTags = post.tags ? post.tags.split(',').map(t => t.trim().toLowerCase()) : [];
        return postTags.includes(tagFilter);
      });
    }

    renderPostsList(posts, listDiv);
  } catch (err) {
    listDiv.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 40px 0;">Error fetching explore: ${err.message}</p>`;
  }
}

function renderPostsList(posts, container) {
  if (posts.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">No posts found. Add tags or follow users to populate your screen!</p>';
    return;
  }

  container.innerHTML = '';
  posts.forEach(post => {
    const card = document.createElement('article');
    card.className = 'post-card glass-panel';
    card.id = `post-${post.id}`;

    // Tag elements
    let tagsHtml = '';
    if (post.tags) {
      tagsHtml = `<div class="post-tags-container">` + 
        post.tags.split(',').map(t => `<span class="post-tag">#${t.trim()}</span>`).join(' ') + 
        `</div>`;
    }

    // Image elements
    let imgHtml = '';
    if (post.image_url) {
      const isVideo = /mp4|webm|ogg|mov|avi/.test(post.image_url.toLowerCase());
      if (isVideo) {
        imgHtml = `
          <div class="post-image-container">
            <video class="post-image" src="${post.image_url}" controls style="width: 100%; border-radius: var(--radius-sm); max-height: 400px; background: #000;"></video>
          </div>
        `;
      } else {
        imgHtml = `
          <div class="post-image-container">
            <img class="post-image" src="${post.image_url}" alt="Post attachment">
          </div>
        `;
      }
    }

    // Owner controls
    let contextControlsHtml = '';
    if (post.user_id === window.currentUser.id || window.currentUser.isAdmin === 1) {
      contextControlsHtml = `
        <div style="display: flex; gap: 8px;">
          <button class="post-more-btn" onclick="triggerEditPost(${post.id})"><i class="fa-regular fa-pen-to-square"></i></button>
          <button class="post-more-btn" onclick="triggerDeletePost(${post.id})"><i class="fa-regular fa-trash-can" style="color: var(--danger);"></i></button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="post-header">
        <div class="post-author-info" onclick="viewUserProfile('${post.username}')">
          <img class="post-author-avatar" src="${post.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
          <div>
            <div class="post-author-name">${post.username}</div>
            <div class="post-time">${new Date(post.created_at).toLocaleString()}</div>
          </div>
        </div>
        ${contextControlsHtml}
      </div>
      
      <div class="post-content">${escapeHTML(post.content)}</div>
      
      ${imgHtml}
      ${tagsHtml}
      
      <div class="post-actions">
        <button class="post-action-btn like-btn ${post.is_liked ? 'liked' : ''}" onclick="toggleLikePost(${post.id}, this)">
          <i class="${post.is_liked ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
          <span class="like-count">${post.likes_count}</span> Likes
        </button>
        <button class="post-action-btn comment-btn" onclick="toggleCommentsDrawer(${post.id})">
          <i class="fa-regular fa-comment"></i>
          <span class="comment-count">${post.comments_count}</span> Comments
        </button>
        <button class="post-action-btn report-btn" onclick="triggerReport('post', ${post.id})">
          <i class="fa-regular fa-flag"></i> Report
        </button>
      </div>

      <!-- Comments Area (Initially Hidden) -->
      <div class="post-comments-section" id="post-comments-${post.id}" style="display: none;">
        
        <!-- Toxicity warning helper label -->
        <div class="toxicity-warning-popup" id="comment-tox-warn-${post.id}" style="display: none;">
          <i class="fa-solid fa-triangle-exclamation"></i> Warning: Toxic vocabulary detected. 
          <div style="margin-top: 4px; display: flex; gap: 8px;">
            <button class="btn btn-danger" id="comment-tox-force-${post.id}" style="padding: 4px 8px; font-size: 0.75rem;">Post Anyway</button>
            <button class="btn btn-secondary" id="comment-tox-cancel-${post.id}" style="padding: 4px 8px; font-size: 0.75rem;">Edit</button>
          </div>
        </div>

        <div class="comment-input-row">
          <input class="comment-input" type="text" id="comment-input-field-${post.id}" placeholder="Write a comment...">
          <button class="btn btn-primary" onclick="submitComment(${post.id})" style="padding: 10px 14px;"><i class="fa-solid fa-paper-plane"></i></button>
        </div>
        
        <div class="comment-list" id="comment-list-${post.id}">
          <!-- Comments go here -->
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Like toggle
async function toggleLikePost(postId, btn) {
  try {
    const data = await apiRequest(`/api/posts/${postId}/like`, 'POST');
    const countSpan = btn.querySelector('.like-count');
    const icon = btn.querySelector('i');
    
    let currentVal = parseInt(countSpan.innerText);
    if (data.liked) {
      btn.classList.add('liked');
      icon.className = 'fa-solid fa-heart';
      countSpan.innerText = currentVal + 1;
    } else {
      btn.classList.remove('liked');
      icon.className = 'fa-regular fa-heart';
      countSpan.innerText = currentVal - 1;
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// Edit post modals trigger
function triggerEditPost(postId) {
  currentEditPostId = postId;
  
  // Grab details from DOM post card
  const postCard = document.getElementById(`post-${postId}`);
  const textContent = postCard.querySelector('.post-content').innerText;
  const imageElement = postCard.querySelector('.post-image');
  const tagElements = postCard.querySelectorAll('.post-tag');
  
  document.getElementById('edit-post-content').value = textContent;
  document.getElementById('edit-post-image').value = imageElement ? imageElement.src : '';
  
  const tagsList = [];
  tagElements.forEach(t => tagsList.push(t.innerText.replace('#', '')));
  document.getElementById('edit-post-tags').value = tagsList.join(', ');

  openModal('modal-edit-post');
}

// Save post action
async function savePostEdit() {
  const content = document.getElementById('edit-post-content').value;
  const imageUrl = document.getElementById('edit-post-image').value;
  const tags = document.getElementById('edit-post-tags').value;

  try {
    await apiRequest(`/api/posts/${currentEditPostId}`, 'PUT', { content, imageUrl, tags });
    closeAllModals();
    showToast('Success', 'Post edited successfully', 'success');
    
    // Refresh current view
    if (window.activePanel === 'feed-panel') loadFeed();
    else if (window.activePanel === 'explore-panel') loadExplore();
    else if (window.activePanel === 'profile-panel') loadProfile(window.currentUser.username);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// Delete post action
async function triggerDeletePost(postId) {
  if (!confirm('Are you sure you want to delete this post?')) return;
  try {
    await apiRequest(`/api/posts/${postId}`, 'DELETE');
    showToast('Success', 'Post deleted', 'success');
    
    // Remove element directly or reload
    const el = document.getElementById(`post-${postId}`);
    if (el) el.remove();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// ----------------------------------------------------
// COMMENTS PANEL TOGGLES & ACTIONS
// ----------------------------------------------------

async function toggleCommentsDrawer(postId) {
  const drawer = document.getElementById(`post-comments-${postId}`);
  if (drawer.style.display === 'flex') {
    drawer.style.display = 'none';
    return;
  }

  drawer.style.display = 'flex';
  loadComments(postId);
}

async function loadComments(postId) {
  const listHolder = document.getElementById(`comment-list-${postId}`);
  listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Reading comments...</p>';

  try {
    const comments = await apiRequest(`/api/posts/${postId}/comments`);
    listHolder.innerHTML = '';
    
    if (comments.length === 0) {
      listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px 0;">No comments. Write the first one!</p>';
      return;
    }

    comments.forEach(c => {
      const commentDiv = document.createElement('div');
      commentDiv.className = 'comment-item';

      let deleteBtnHtml = '';
      if (c.user_id === window.currentUser.id || window.currentUser.isAdmin === 1) {
        deleteBtnHtml = `<button class="comment-delete-btn" onclick="deleteComment(${c.id}, ${postId})"><i class="fa-regular fa-trash-can"></i></button>`;
      }

      // Sentiment color selection
      let emoji = '😐';
      if (c.sentiment === 'positive') emoji = '😊';
      else if (c.sentiment === 'negative') emoji = '😠';

      commentDiv.innerHTML = `
        <img class="comment-avatar" src="${c.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
        <div class="comment-body">
          <div class="comment-author">${c.username}</div>
          <div class="comment-text">${escapeHTML(c.content)}</div>
          <div class="comment-footer">
            <span class="comment-time">${new Date(c.created_at).toLocaleString()}</span>
            <span class="comment-sentiment-badge ${c.sentiment}">${emoji} ${c.sentiment}</span>
          </div>
        </div>
        ${deleteBtnHtml}
      `;

      listHolder.appendChild(commentDiv);
    });
  } catch (err) {
    listHolder.innerHTML = `<p style="text-align: center; color: var(--danger); font-size: 0.8rem;">Error: ${err.message}</p>`;
  }
}

// Submitting comments
async function submitComment(postId, bypassToxicity = false) {
  const input = document.getElementById(`comment-input-field-${postId}`);
  const content = input.value.trim();

  if (!content) return;

  try {
    const response = await apiRequest('/api/comments', 'POST', {
      postId,
      content,
      bypassToxicity
    });

    // Check toxicity warning response
    if (response.warn) {
      const warnBox = document.getElementById(`comment-tox-warn-${postId}`);
      warnBox.style.display = 'block';

      // Setup actions
      document.getElementById(`comment-tox-force-${postId}`).onclick = () => {
        warnBox.style.display = 'none';
        submitComment(postId, true); // retry with bypass flag
      };

      document.getElementById(`comment-tox-cancel-${postId}`).onclick = () => {
        warnBox.style.display = 'none';
        input.focus();
      };
      return;
    }

    // Clear and reload
    input.value = '';
    loadComments(postId);
    
    // Update count in post card
    const postCard = document.getElementById(`post-${postId}`);
    const countSpan = postCard.querySelector('.comment-count');
    countSpan.innerText = parseInt(countSpan.innerText) + 1;

    showToast('Success', 'Comment posted!', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function deleteComment(commentId, postId) {
  if (!confirm('Delete comment?')) return;
  try {
    await apiRequest(`/api/comments/${commentId}`, 'DELETE');
    loadComments(postId);
    
    const postCard = document.getElementById(`post-${postId}`);
    const countSpan = postCard.querySelector('.comment-count');
    countSpan.innerText = Math.max(0, parseInt(countSpan.innerText) - 1);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// ----------------------------------------------------
// USER PROFILE METHODS
// ----------------------------------------------------

async function viewUserProfile(username) {
  switchPanel('profile-panel');
  loadProfile(username);
}

async function loadProfile(username) {
  // Check if target profile is another user
  const isSelf = username === window.currentUser.username;
  
  // Set UI elements
  document.getElementById('cover-upload-trigger').style.display = isSelf ? 'flex' : 'none';
  document.getElementById('avatar-upload-trigger').style.display = isSelf ? 'flex' : 'none';
  document.getElementById('profile-edit-trigger').style.display = isSelf ? 'flex' : 'none';

  const followBtn = document.getElementById('profile-follow-btn');
  const reportBtn = document.getElementById('profile-report-btn');

  followBtn.style.display = isSelf ? 'none' : 'block';
  reportBtn.style.display = isSelf ? 'none' : 'block';

  try {
    const data = await apiRequest(`/api/users/profile/${username}`);
    const user = data.profile;

    document.getElementById('profile-display-username').innerText = user.username;
    document.getElementById('profile-display-handle').innerText = `@${user.username}`;
    document.getElementById('profile-avatar-display').src = user.profile_pic || '/uploads/default-avatar.png';
    document.getElementById('profile-cover-display').src = user.cover_pic || '/uploads/default-cover.png';
    
    document.getElementById('profile-stat-posts').innerText = data.posts.length;
    
    const followersEl = document.getElementById('profile-stat-followers');
    followersEl.innerText = user.followers_count;
    followersEl.parentElement.onclick = () => showFollowList('followers', user.id);
    followersEl.parentElement.style.cursor = 'pointer';
    
    const followingEl = document.getElementById('profile-stat-following');
    followingEl.innerText = user.following_count;
    followingEl.parentElement.onclick = () => showFollowList('following', user.id);
    followingEl.parentElement.style.cursor = 'pointer';
    
    document.getElementById('profile-bio-display').innerText = user.bio || 'No bio written yet.';

    // Tags
    const tagsHolder = document.getElementById('profile-tags-display');
    tagsHolder.innerHTML = '';
    if (user.interest_tags) {
      user.interest_tags.split(',').forEach(tag => {
        const span = document.createElement('span');
        span.className = 'post-tag';
        span.innerText = `#${tag.trim()}`;
        tagsHolder.appendChild(span);
      });
    }

    // Follow/Unfollow status button toggle
    if (!isSelf) {
      followBtn.innerText = user.is_following === 1 ? 'Unfollow' : 'Follow';
      followBtn.className = user.is_following === 1 ? 'btn btn-secondary' : 'btn btn-primary';
      
      // Save ID on click
      followBtn.onclick = () => toggleFollowUser(user.id, user.username);
      reportBtn.onclick = () => triggerReport('user', user.id);
    }

    // Render profile posts
    const listHolder = document.getElementById('profile-posts-list');
    renderPostsList(data.posts, listHolder);

    // Fetch and render highlights
    const highlightsHolder = document.getElementById('profile-highlights-holder');
    if (highlightsHolder) {
      highlightsHolder.innerHTML = '';
      
      // Add "New Highlight" button if it's our own profile
      if (isSelf) {
        const addHl = document.createElement('div');
        addHl.className = 'story-bubble';
        addHl.id = 'new-highlight-bubble';
        addHl.innerHTML = `
          <div class="story-avatar-holder viewed" style="border: 2px dashed var(--primary); background: transparent;">
            <i class="fa-solid fa-plus" style="color: var(--primary); font-size: 1.2rem;"></i>
          </div>
          <div class="story-bubble-username">New</div>
        `;
        addHl.onclick = openNewHighlightModal;
        highlightsHolder.appendChild(addHl);
      }
      
      try {
        const highlights = await apiRequest(`/api/users/${username}/highlights`);
        highlights.forEach(h => {
          if (h.stories.length === 0) return;
          const bubble = document.createElement('div');
          bubble.className = 'highlight-bubble';
          bubble.onclick = () => {
            openStoryViewer([{
              user_id: user.id,
              username: `${user.username} (${h.title})`,
              profile_pic: user.profile_pic,
              stories: h.stories
            }]);
          };
          
          const coverUrl = h.cover_url || (h.stories[0] ? h.stories[0].media_url : '/uploads/default-avatar.png');
          
          bubble.innerHTML = `
            <div class="highlight-avatar-holder">
              <img src="${coverUrl}" alt="${h.title}">
            </div>
            <span class="highlight-bubble-title">${h.title}</span>
          `;
          highlightsHolder.appendChild(bubble);
        });
      } catch (err) {
        console.error('Error loading highlights:', err);
      }
    }

    // Profile message button setup
    const msgBtn = document.getElementById('profile-message-btn');
    if (msgBtn) {
      msgBtn.style.display = isSelf ? 'none' : 'block';
      msgBtn.onclick = () => {
        switchPanel('chat-panel');
        openDirectMessage(user.id, user.username);
      };
    }

  } catch (err) {
    showToast('Error loading profile', err.message, 'error');
  }
}

async function toggleFollowUser(targetUserId, username) {
  try {
    const data = await apiRequest(`/api/users/follow/${targetUserId}`, 'POST');
    showToast('Follow status updated', data.following ? `You are now following @${username}` : `You unfollowed @${username}`, 'success');
    
    // Reload suggestions and profile
    loadSuggestions();
    loadProfile(username);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function showFollowList(type, userId) {
  const modalTitle = document.getElementById('follow-list-title');
  const listHolder = document.getElementById('follow-list-holder');
  
  modalTitle.innerText = type === 'followers' ? 'Followers' : 'Following';
  listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Loading list...</p>';
  
  openModal('modal-follow-list');
  
  try {
    const list = await apiRequest(`/api/users/${userId}/${type}`);
    listHolder.innerHTML = '';
    
    if (list.length === 0) {
      listHolder.innerHTML = `<p style="text-align: center; color: var(--text-muted); padding: 20px 0;">No ${type} found.</p>`;
      return;
    }
    
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'suggestion-item';
      row.style.width = '100%';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      
      row.innerHTML = `
        <div class="suggestion-user-info" onclick="closeAllModals(); viewUserProfile('${item.username}')">
          <img class="suggestion-user-avatar" src="${item.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
          <div class="suggestion-user-details">
            <span class="suggestion-username">${item.username}</span>
            <span class="suggestion-meta" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.bio || 'No bio.'}</span>
          </div>
        </div>
      `;
      listHolder.appendChild(row);
    });
  } catch (err) {
    listHolder.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 20px 0;">Error: ${err.message}</p>`;
  }
}

// Handle Bio/Tags saving
async function saveProfileEdits() {
  const bio = document.getElementById('edit-bio').value;
  const tags = document.getElementById('edit-tags').value;

  try {
    await apiRequest('/api/users/profile/edit', 'POST', { bio, tags });
    
    // Update local profile data
    window.currentUser.bio = bio;
    window.currentUser.interest_tags = tags;
    localStorage.setItem('user', JSON.stringify(window.currentUser));
    
    closeAllModals();
    showToast('Success', 'Profile updated successfully!', 'success');
    loadProfile(window.currentUser.username);
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// Setup photo upload modals trigger
function triggerUploadPhoto(type) {
  document.getElementById('file-upload-type').value = type;
  document.getElementById('file-upload-title').innerText = type === 'avatar' ? 'Upload Profile Photo' : 'Upload Cover Banner';
  openModal('modal-file-upload');
}

// Upload picture via Fetch multipart data
async function handlePhotoUploadSubmit(e) {
  e.preventDefault();
  const fileInput = document.getElementById('file-upload-input');
  const type = document.getElementById('file-upload-type').value;

  if (fileInput.files.length === 0) return;

  const formData = new FormData();
  formData.append('image', fileInput.files[0]);
  formData.append('type', type);

  try {
    const response = await fetch('/api/users/profile/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.authToken}`
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Upload failed');

    // Update Local values
    if (type === 'avatar') {
      window.currentUser.profile_pic = data.fileUrl;
    } else {
      window.currentUser.cover_pic = data.fileUrl;
    }
    localStorage.setItem('user', JSON.stringify(window.currentUser));
    
    // Close modal & reload UI
    closeAllModals();
    updateUserWidgets();
    loadProfile(window.currentUser.username);
    showToast('Success', 'Photo updated successfully', 'success');

  } catch (err) {
    showToast('Upload Error', err.message, 'error');
  }
}

// ----------------------------------------------------
// CHAT / DM INTERFACES
// ----------------------------------------------------

async function loadConversations() {
  const listHolder = document.getElementById('conversations-holder');
  listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Reading chats...</p>';

  try {
    const list = await apiRequest('/api/chat/conversations');
    listHolder.innerHTML = '';

    if (list.length === 0) {
      listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px 0;">No chats started yet.</p>';
      return;
    }

    list.forEach(c => {
      const item = document.createElement('div');
      item.className = `conversation-item ${window.currentChattingUserId === c.id ? 'active' : ''}`;
      item.onclick = () => openDirectMessage(c.id, c.username);

      const statusDotClass = c.unread_count > 0 ? 'online' : '';
      const unreadBadge = c.unread_count > 0 ? `<span class="conversation-unread-badge">${c.unread_count}</span>` : '';

      item.innerHTML = `
        <div style="position: relative;">
          <img class="conversation-avatar" src="${c.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
          <div class="conversation-avatar-status status-dot-${c.id} ${statusDotClass}"></div>
        </div>
        <div class="conversation-info">
          <div class="conversation-name-row">
            <span class="conversation-name">${c.username}</span>
            <span class="conversation-time">${c.last_message_time ? new Date(c.last_message_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="conversation-last-msg">${escapeHTML(c.last_message || 'Start chatting...')}</span>
            ${unreadBadge}
          </div>
        </div>
      `;

      listHolder.appendChild(item);
    });

  } catch (err) {
    listHolder.innerHTML = `<p style="text-align: center; color: var(--danger); font-size: 0.8rem;">Error: ${err.message}</p>`;
  }
}

async function openDirectMessage(userId, username) {
  window.currentChattingUserId = parseInt(userId);

  // Setup head labels
  document.getElementById('chat-window-placeholder').style.display = 'none';
  document.getElementById('chat-window-active').style.display = 'flex';
  
  document.getElementById('chat-header-name').innerText = username;
  document.getElementById('chat-header-avatar').src = '/uploads/default-avatar.png'; // default fallback initially

  // Pull conversation log history
  const listHolder = document.getElementById('chat-messages-holder');
  listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Reading messages...</p>';

  try {
    const list = await apiRequest(`/api/chat/history/${userId}`);
    listHolder.innerHTML = '';

    // Search and pull avatar detail from side conversations index if matched
    const convoList = await apiRequest('/api/chat/conversations');
    const matchedUser = convoList.find(u => u.id === parseInt(userId));
    if (matchedUser) {
      document.getElementById('chat-header-avatar').src = matchedUser.profile_pic || '/uploads/default-avatar.png';
    }

    if (list.length === 0) {
      listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">No messages yet. Say hello!</p>';
    } else {
      list.forEach(m => appendChatMessage(m));
    }
    
    scrollChatToBottom();
    // Re-highlight left items
    loadConversations();
    updateUnreadBadgeCount();

  } catch (err) {
    listHolder.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 40px 0;">Error loading messages: ${err.message}</p>`;
  }
}

function appendChatMessage(msg) {
  const container = document.getElementById('chat-messages-holder');
  
  // Remove placeholder on first message
  if (container.querySelector('p') && container.children.length === 1) {
    container.innerHTML = '';
  }

  const isMe = msg.sender_id === window.currentUser.id;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMe ? 'outgoing' : 'incoming'}`;
  
  bubble.innerHTML = `
    <span>${escapeHTML(msg.content)}</span>
    <span class="message-bubble-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
  `;

  container.appendChild(bubble);
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages-holder');
  container.scrollTop = container.scrollHeight;
}

function sendDirectMessage() {
  const input = document.getElementById('chat-message-input');
  const text = input.value.trim();
  if (!text || !window.currentChattingUserId) return;

  sendSocketMessage(window.currentChattingUserId, text, (res) => {
    if (res.success) {
      input.value = '';
      input.focus();
    } else {
      showToast('Error sending message', res.error, 'error');
    }
  });
}

// ----------------------------------------------------
// NOTIFICATIONS DISPLAY
// ----------------------------------------------------

async function loadNotificationsList() {
  const listHolder = document.getElementById('notifications-holder');
  listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Reading notifications...</p>';

  try {
    const list = await apiRequest('/api/notifications');
    listHolder.innerHTML = '';

    if (list.length === 0) {
      listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;">No notifications yet.</p>';
      return;
    }

    list.forEach(n => {
      const item = document.createElement('div');
      item.className = `notification-item ${n.is_read === 0 ? 'unread' : ''}`;
      
      // Determine targets
      let bodyText = '';
      let badgeClass = 'like';
      let icon = 'fa-heart';
      let panelTarget = 'feed-panel';
      
      if (n.type === 'like') {
        bodyText = 'liked your post.';
        badgeClass = 'like';
        icon = 'fa-heart';
      } else if (n.type === 'comment') {
        bodyText = 'commented on your post.';
        badgeClass = 'comment';
        icon = 'fa-comment';
      } else if (n.type === 'follow') {
        bodyText = 'started following you.';
        badgeClass = 'follow';
        icon = 'fa-user-plus';
        panelTarget = 'profile-panel';
      } else if (n.type === 'message') {
        bodyText = 'sent you a private message.';
        badgeClass = 'message';
        icon = 'fa-envelope';
        panelTarget = 'chat-panel';
      } else if (n.type === 'report') {
        bodyText = 'reported your post.';
        badgeClass = 'report';
        icon = 'fa-triangle-exclamation';
        panelTarget = 'feed-panel';
      }

      item.onclick = () => {
        switchPanel(panelTarget);
        if (n.type === 'message') {
          openDirectMessage(n.sender_id, n.sender_username);
        } else if (n.type === 'follow') {
          viewUserProfile(n.sender_username);
        }
      };

      item.innerHTML = `
        <div style="position: relative;">
          <img class="notification-avatar" src="${n.sender_avatar || '/uploads/default-avatar.png'}" alt="Avatar">
          <div class="conversation-avatar-status notification-badge-icon ${badgeClass}" style="bottom: -5px; right: -5px;"><i class="fa-solid ${icon}"></i></div>
        </div>
        <div class="notification-content">
          <span class="notification-actor">${n.sender_username}</span> ${bodyText}
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">${new Date(n.created_at).toLocaleString()}</div>
        </div>
      `;

      listHolder.appendChild(item);
    });

    // Reset unread count indicators
    updateUnreadBadgeCount();

  } catch (err) {
    listHolder.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 40px 0;">Error loading notifications: ${err.message}</p>`;
  }
}

async function updateUnreadBadgeCount() {
  if (!window.authToken) return;
  try {
    const data = await apiRequest('/api/notifications/unread-count');
    const badge = document.getElementById('notif-badge');
    if (data.count > 0) {
      badge.style.display = 'block';
      badge.innerText = data.count;
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Error fetching unread counts:', err);
  }
}

// ----------------------------------------------------
// SMART RECOMMENDATIONS & SUGGESTIONS SIDE WIDGET
// ----------------------------------------------------

async function loadSuggestions() {
  const listHolder = document.getElementById('suggestions-holder');
  listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 20px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Suggesting...</p>';

  try {
    const list = await apiRequest('/api/users/suggestions');
    listHolder.innerHTML = '';

    if (list.length === 0) {
      listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 10px 0;">No suggested friends right now.</p>';
      return;
    }

    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'suggestion-item';

      let detailLabel = '';
      if (item.interest_matches > 0) {
        detailLabel = `<span style="font-size: 0.72rem; color: var(--accent);"><i class="fa-solid fa-wand-magic-sparkles"></i> Matches: ${item.matching_interests}</span>`;
      } else {
        detailLabel = item.mutual_count > 0 ? `${item.mutual_count} mutual friends` : 'Recommended for you';
      }

      row.innerHTML = `
        <div class="suggestion-user-info" onclick="viewUserProfile('${item.username}')">
          <img class="suggestion-user-avatar" src="${item.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
          <div class="suggestion-user-details">
            <span class="suggestion-username">${item.username}</span>
            <span class="suggestion-meta">${detailLabel}</span>
          </div>
        </div>
        <button class="suggestion-follow-btn" onclick="toggleFollowUser(${item.id}, '${item.username}')">Follow</button>
      `;

      listHolder.appendChild(row);
    });

  } catch (err) {
    listHolder.innerHTML = `<p style="text-align: center; color: var(--danger); font-size: 0.75rem;">Error suggestions: ${err.message}</p>`;
  }
}

// ----------------------------------------------------
// AI CAPTION GENERATOR HELPERS
// ----------------------------------------------------

async function handleAICaptionGenerate() {
  const tags = document.getElementById('post-tags-input').value;
  const contentSeed = document.getElementById('post-content-input').value;
  const banner = document.getElementById('ai-caption-banner');
  const textHolder = document.getElementById('ai-caption-text');

  if (!tags) {
    showToast('⚠️ No tags provided', 'Key in some comma-separated interest tags to generate matching captions!', 'warning');
    return;
  }

  banner.style.display = 'flex';
  textHolder.innerText = '🤖 AI is drafting your caption...';

  try {
    const data = await apiRequest('/api/posts/suggest-caption', 'POST', {
      tags,
      context: contentSeed
    });

    textHolder.innerText = data.caption;

    // Apply button
    document.getElementById('ai-caption-apply').onclick = () => {
      document.getElementById('post-content-input').value = data.caption;
      banner.style.display = 'none';
    };

  } catch (err) {
    textHolder.innerText = '❌ Failed to generate caption. ' + err.message;
  }
}

// ----------------------------------------------------
// SECURITY: TWO-FACTOR AUTH (2FA) & REPORTING
// ----------------------------------------------------

function triggerReport(type, id) {
  currentReportType = type;
  currentReportId = id;
  openModal('modal-report-reason');
}

async function submitReport() {
  const select = document.getElementById('report-reason-select');
  const reason = select.value;

  try {
    let endpoint = `/api/posts/${currentReportId}/report`;
    if (currentReportType === 'user') {
      endpoint = `/api/users/${currentReportId}/report`;
    }

    await apiRequest(endpoint, 'POST', { reason });
    closeAllModals();
    showToast('Report Submitted', 'Content has been queued for moderation.', 'success');
  } catch (err) {
    showToast('Report Error', err.message, 'error');
  }
}

async function trigger2FASetupModal() {
  const toggleBtn = document.getElementById('modal-2fa-toggle-btn');
  const isEnabled = toggleBtn.innerText.includes('Disable');

  if (isEnabled) {
    // Show disable view
    document.getElementById('qr-setup-view').style.display = 'none';
    document.getElementById('qr-disable-view').style.display = 'block';
    
    document.getElementById('confirm-2fa-btn').innerText = 'Confirm and Disable';
    document.getElementById('confirm-2fa-btn').className = 'btn btn-danger';
  } else {
    // Generate QR details
    try {
      const data = await apiRequest('/api/auth/toggle-2fa', 'POST', { enable: true });
      document.getElementById('qr-setup-view').style.display = 'block';
      document.getElementById('qr-disable-view').style.display = 'none';
      
      document.getElementById('qr-code-img').src = data.qrCode;
      document.getElementById('qr-secret-text').innerText = data.secret;
      current2FASecret = data.secret;

      document.getElementById('confirm-2fa-btn').innerText = 'Verify and Enable';
      document.getElementById('confirm-2fa-btn').className = 'btn btn-primary';
    } catch (err) {
      showToast('Error', err.message, 'error');
      return;
    }
  }

  openModal('modal-2fa-setup');
}

async function confirm2FAToggle() {
  const toggleBtn = document.getElementById('modal-2fa-toggle-btn');
  const isEnabled = toggleBtn.innerText.includes('Disable');

  if (isEnabled) {
    // Try disabling 2FA
    const code = document.getElementById('disable-2fa-code').value;
    if (!code) return;
    
    try {
      await apiRequest('/api/auth/toggle-2fa', 'POST', { enable: false, code });
      closeAllModals();
      showToast('2FA Disabled', 'Two-Factor verification has been removed.', 'success');
      toggleBtn.innerText = 'Setup 2FA';
      toggleBtn.className = 'btn btn-secondary';
    } catch (err) {
      showToast('Error', err.message, 'error');
    }
  } else {
    // Verify and enable
    const code = document.getElementById('verify-2fa-setup-code').value;
    if (!code) return;

    try {
      await apiRequest('/api/auth/toggle-2fa', 'POST', { 
        enable: true, 
        code, 
        secret: current2FASecret 
      });
      closeAllModals();
      showToast('2FA Active 🛡️', 'Your account is now secured with Two-Factor Authentication!', 'success');
      toggleBtn.innerText = 'Disable 2FA';
      toggleBtn.className = 'btn btn-danger';
    } catch (err) {
      showToast('Verification Failed', err.message, 'error');
    }
  }
}

// Check 2FA visual settings state on profile edit load
function sync2FAUIState() {
  const toggleBtn = document.getElementById('modal-2fa-toggle-btn');
  
  // API request user settings
  apiRequest('/api/auth/toggle-2fa', 'POST', { enable: false, testSync: true })
    .then(() => {
      // If endpoint doesn't fail, we might check, or we can check via user widgets
    })
    .catch(err => {
      // Simple sync check: if isEnabled, set visual text accordingly. Let's pull full profile sync:
      const profileSync = dbUserSyncCheck();
    });
}

// ----------------------------------------------------
// ADMIN DASHBOARD PANELS
// ----------------------------------------------------

async function loadAdminPanel() {
  const statsHolder = document.getElementById('admin-reports-holder');
  statsHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px 0;"><i class="fa-solid fa-spinner fa-spin"></i> Reading statistics...</p>';

  try {
    const data = await apiRequest('/api/admin/stats');
    
    // Set counters
    document.getElementById('admin-stats-users').innerText = data.stats.users;
    document.getElementById('admin-stats-posts').innerText = data.stats.posts;
    document.getElementById('admin-stats-comments').innerText = data.stats.comments;
    document.getElementById('admin-stats-reports').innerText = data.stats.reports;

    // Render SVG visualizer
    drawAdminChart(data.stats);

    // Render reports
    statsHolder.innerHTML = '';
    if (data.reports.length === 0) {
      statsHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 20px 0;">No active reports found. System is clean!</p>';
      return;
    }

    data.reports.forEach(r => {
      const row = document.createElement('div');
      row.className = 'report-card-item';

      let actionButtons = '';
      if (r.target_type === 'post') {
        actionButtons = `
          <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.8rem;" onclick="adminResolveContent('delete_post', ${r.target_id}, ${r.id})">Delete Post</button>
        `;
      } else if (r.target_type === 'user') {
        actionButtons = `
          <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.8rem;" onclick="adminResolveContent('ban_user', ${r.target_id}, ${r.id})">Ban User</button>
        `;
      }

      row.innerHTML = `
        <div class="report-item-info">
          <div class="report-item-header">Reported ${r.target_type.toUpperCase()} ID: ${r.target_id}</div>
          <div class="report-item-reason">Reason: <strong>${escapeHTML(r.reason)}</strong></div>
          <div class="report-item-preview">Preview: "${escapeHTML(r.target_preview || 'No preview')}"</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">Filed by: @${r.reporter_username} | ${new Date(r.created_at).toLocaleString()}</div>
        </div>
        <div class="report-item-actions">
          ${actionButtons}
          <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.8rem;" onclick="adminResolveContent('dismiss', null, ${r.id})">Dismiss</button>
        </div>
      `;

      statsHolder.appendChild(row);
    });

  } catch (err) {
    statsHolder.innerHTML = `<p style="text-align: center; color: var(--danger); padding: 40px 0;">Access Denied: ${err.message}</p>`;
  }
}

// Draw dynamic SVG charts
function drawAdminChart(stats) {
  const svg = document.getElementById('admin-chart');
  
  // Wipe existing bars
  const bars = svg.querySelectorAll('.admin-chart-bar, .chart-element');
  bars.forEach(b => b.remove());

  const categories = [
    { label: 'Users', val: stats.users },
    { label: 'Posts', val: stats.posts },
    { label: 'Comments', val: stats.comments },
    { label: 'Reports', val: stats.reports }
  ];

  const maxVal = Math.max(...categories.map(c => c.val), 5); // Scale limit fallback: 5
  const startX = 60;
  const spacing = 80;
  const graphHeight = 150;
  const bottomY = 170;

  categories.forEach((cat, index) => {
    const x = startX + index * spacing;
    const barHeight = (cat.val / maxVal) * 130;
    const y = bottomY - barHeight;

    // SVG elements creation
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', '40');
    rect.setAttribute('height', barHeight);
    rect.setAttribute('rx', '4');
    rect.className.baseVal = 'admin-chart-bar chart-element';

    // Label quantity
    const textVal = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textVal.setAttribute('x', x + 20);
    textVal.setAttribute('y', y - 8);
    textVal.setAttribute('text-anchor', 'middle');
    textVal.setAttribute('fill', 'var(--text-primary)');
    textVal.setAttribute('font-size', '11');
    textVal.setAttribute('font-weight', 'bold');
    textVal.textContent = cat.val;
    textVal.className.baseVal = 'chart-element';

    // Label name
    const textLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    textLabel.setAttribute('x', x + 20);
    textLabel.setAttribute('y', bottomY + 18);
    textLabel.setAttribute('text-anchor', 'middle');
    textLabel.setAttribute('fill', 'var(--text-muted)');
    textLabel.setAttribute('font-size', '11');
    textLabel.textContent = cat.label;
    textLabel.className.baseVal = 'chart-element';

    svg.appendChild(rect);
    svg.appendChild(textVal);
    svg.appendChild(textLabel);
  });
}

// Moderation action resolves
async function adminResolveContent(action, targetId, reportId) {
  try {
    if (action === 'delete_post') {
      if (!confirm('Admin: Delete this post?')) return;
      await apiRequest(`/api/admin/posts/${targetId}`, 'DELETE');
      showToast('Admin Success', 'Post deleted.', 'success');
    } else if (action === 'ban_user') {
      if (!confirm('Admin: Ban this user?')) return;
      await apiRequest(`/api/admin/users/${targetId}/ban`, 'POST', { ban: true });
      showToast('Admin Success', 'User account banned.', 'success');
    }

    // Resolve report queue item
    await apiRequest(`/api/admin/reports/${reportId}/resolve`, 'POST');
    
    // Refresh admin panel
    loadAdminPanel();
  } catch (err) {
    showToast('Admin Moderation Error', err.message, 'error');
  }
}

// ----------------------------------------------------
// UI UTILITIES & FORM SUBMITS BINDINGS
// ----------------------------------------------------

function setupEventListeners() {
  // Navigation sidebar item clicks
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.onclick = () => {
      const panelId = item.getAttribute('data-target');
      switchPanel(panelId);
    };
  });

  // Login view switches
  document.getElementById('go-register').onclick = () => showAuthCard('register-card');
  document.getElementById('go-login').onclick = () => showAuthCard('login-card');
  document.getElementById('go-forgot').onclick = () => showAuthCard('forgot-card');
  
  document.getElementById('forgot-back-login').onclick = () => showAuthCard('login-card');
  document.getElementById('verify-back-login').onclick = () => showAuthCard('login-card');
  document.getElementById('reset-back-login').onclick = () => showAuthCard('login-card');
  document.getElementById('twofa-back-login').onclick = () => performLogout();

  // Auth Forms submits
  document.getElementById('login-form').onsubmit = handleLogin;
  document.getElementById('register-form').onsubmit = handleRegister;
  document.getElementById('verify-form').onsubmit = handleVerifyEmail;
  document.getElementById('twofa-form').onsubmit = handleVerify2FA;
  document.getElementById('forgot-form').onsubmit = handleForgotPassword;
  document.getElementById('reset-form').onsubmit = handleResetPassword;

  // Logout button
  document.getElementById('logout-btn').onclick = performLogout;

  // Theme switch button toggle
  document.getElementById('theme-btn').onclick = () => {
    const activeTheme = document.documentElement.getAttribute('data-theme');
    const targetTheme = activeTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', targetTheme);
    localStorage.setItem('theme', targetTheme);
    updateThemeIcon(targetTheme);
  };

  // Add post inputs image triggers
  document.getElementById('post-image-trigger').onclick = () => {
    openModal('modal-image-link');
  };
  document.getElementById('save-image-link-btn').onclick = () => {
    const link = document.getElementById('post-image-url-input').value;
    if (link) {
      document.getElementById('post-image-preview').src = link;
      document.getElementById('post-image-preview-container').style.display = 'block';
    }
    closeModal('modal-image-link');
  };
  document.getElementById('post-image-preview-remove').onclick = () => {
    document.getElementById('post-image-url-input').value = '';
    document.getElementById('post-image-preview').src = '';
    document.getElementById('post-image-preview-container').style.display = 'none';
  };

  // Upload post media trigger
  document.getElementById('post-upload-trigger').onclick = () => {
    document.getElementById('post-file-input').click();
  };
  document.getElementById('post-file-input').onchange = async (e) => {
    if (e.target.files.length === 0) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    showToast('⌛ Uploading Media', 'Uploading post attachment...', 'info');
    try {
      const response = await fetch('/api/posts/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.authToken}`
        },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed');
      
      document.getElementById('post-image-url-input').value = data.url;
      document.getElementById('post-image-preview').src = data.url;
      document.getElementById('post-image-preview-container').style.display = 'block';
      showToast('✅ Upload Complete', 'Media attached to post!', 'success');
    } catch (err) {
      showToast('❌ Upload Failed', err.message, 'error');
    }
  };

  // AI Suggest Tags trigger
  document.getElementById('post-ai-tag-trigger').onclick = async () => {
    const content = document.getElementById('post-content-input').value;
    if (!content.trim()) {
      showToast('⚠️ Content empty', 'Type some content first so the AI can suggest tags!', 'warning');
      return;
    }
    showToast('🤖 AI Suggesting tags...', '', 'info');
    try {
      const data = await apiRequest('/api/posts/ai-suggest-tags', 'POST', { content });
      document.getElementById('post-tags-input').value = data.tags;
      showToast('✅ Tags Suggested', `AI extracted tags: ${data.tags}`, 'success');
    } catch (err) {
      showToast('❌ Tag Suggester Error', err.message, 'error');
    }
  };

  // Stories player modal hooks
  document.getElementById('story-prev-zone').onclick = prevStory;
  document.getElementById('story-next-zone').onclick = nextStory;
  document.getElementById('story-close-btn').onclick = closeStoryViewer;

  // Highlights modal saves
  document.getElementById('save-highlight-btn').onclick = saveNewHighlight;

  // Search followed users to chat
  document.getElementById('chat-user-search').oninput = async (e) => {
    const query = e.target.value.trim().toLowerCase();
    const listHolder = document.getElementById('conversations-holder');
    if (!query) {
      loadConversations();
      return;
    }
    try {
      const following = await apiRequest(`/api/users/${window.currentUser.id}/following`);
      const filtered = following.filter(u => u.username.toLowerCase().includes(query));
      listHolder.innerHTML = '';
      if (filtered.length === 0) {
        listHolder.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px 0;">No matching friends found.</p>';
        return;
      }
      filtered.forEach(u => {
        const item = document.createElement('div');
        item.className = 'conversation-item';
        item.onclick = () => {
          document.getElementById('chat-user-search').value = '';
          openDirectMessage(u.id, u.username);
        };
        item.innerHTML = `
          <img class="conversation-avatar" src="${u.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
          <div class="conversation-info">
            <span class="conversation-name">${u.username}</span>
            <span class="conversation-last-msg">${escapeHTML(u.bio || 'Click to message')}</span>
          </div>
        `;
        listHolder.appendChild(item);
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Submit Post
  document.getElementById('submit-post-btn').onclick = async () => {
    const content = document.getElementById('post-content-input').value;
    const imageUrl = document.getElementById('post-image-url-input').value;
    const tags = document.getElementById('post-tags-input').value;

    if (!content.trim()) return;

    try {
      await apiRequest('/api/posts', 'POST', { content, imageUrl, tags });
      // Reset inputs
      document.getElementById('post-content-input').value = '';
      document.getElementById('post-image-url-input').value = '';
      document.getElementById('post-tags-input').value = '';
      document.getElementById('post-image-preview-container').style.display = 'none';
      document.getElementById('ai-caption-banner').style.display = 'none';
      
      showToast('Success', 'Post published!', 'success');
      loadFeed();
    } catch (err) {
      showToast('Error publishing post', err.message, 'error');
    }
  };

  // AI Caption trigger buttons
  document.getElementById('post-ai-caption-trigger').onclick = handleAICaptionGenerate;
  document.getElementById('ai-caption-retry').onclick = handleAICaptionGenerate;

  // Edit Profile modal load
  document.getElementById('profile-edit-trigger').onclick = () => {
    document.getElementById('edit-bio').value = window.currentUser.bio || '';
    document.getElementById('edit-tags').value = window.currentUser.interest_tags || '';
    
    // Sync status button 2FA
    const toggleBtn = document.getElementById('modal-2fa-toggle-btn');
    const isEnabled = window.currentUser.two_factor_enabled === 1;
    toggleBtn.innerText = isEnabled ? 'Disable 2FA' : 'Setup 2FA';
    toggleBtn.className = isEnabled ? 'btn btn-danger' : 'btn btn-secondary';

    openModal('modal-edit-profile');
  };
  
  // Save profile changes
  document.getElementById('save-profile-btn').onclick = saveProfileEdits;
  document.getElementById('modal-2fa-toggle-btn').onclick = trigger2FASetupModal;
  document.getElementById('confirm-2fa-btn').onclick = confirm2FAToggle;

  // File Upload modal triggers
  document.getElementById('avatar-upload-trigger').onclick = () => triggerUploadPhoto('avatar');
  document.getElementById('cover-upload-trigger').onclick = () => triggerUploadPhoto('cover');
  document.getElementById('submit-upload-btn').onclick = handlePhotoUploadSubmit;

  // Save Edit Post modal
  document.getElementById('save-post-btn').onclick = savePostEdit;

  // Send Chat Message on button or Enter
  document.getElementById('chat-send-btn').onclick = sendDirectMessage;
  document.getElementById('chat-message-input').onkeydown = (e) => {
    if (e.key === 'Enter') sendDirectMessage();
  };

  // User widget clicks sidebar -> routes to profile view
  document.getElementById('user-widget-click').onclick = () => viewUserProfile(window.currentUser.username);
  document.getElementById('right-go-profile-btn').onclick = () => viewUserProfile(window.currentUser.username);

  // Explore Tag Chip filtering
  const chips = document.querySelectorAll('.tag-chip');
  chips.forEach(c => {
    c.onclick = () => {
      chips.forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      loadExplore(c.getAttribute('data-tag'));
    };
  });

  // Modal Report Content submission
  document.getElementById('submit-report-btn').onclick = submitReport;

  // Generic close triggers
  const closeTriggers = document.querySelectorAll('.close-modal-trigger');
  closeTriggers.forEach(btn => {
    btn.onclick = closeAllModals;
  });
}

// Modal open/close actions
function openModal(modalId) {
  document.getElementById('global-modal').style.display = 'flex';
  
  // Hide all modals content cards
  const cards = document.querySelectorAll('.modal-card');
  cards.forEach(c => c.style.display = 'none');
  
  // Show target card
  document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
  document.getElementById(modalId).style.display = 'none';
  document.getElementById('global-modal').style.display = 'none';
}

function closeAllModals() {
  document.getElementById('global-modal').style.display = 'none';
  const cards = document.querySelectorAll('.modal-card');
  cards.forEach(c => c.style.display = 'none');
}

function updateThemeIcon(theme) {
  const btn = document.getElementById('theme-btn');
  if (theme === 'dark') {
    btn.innerHTML = '<i class="fa-solid fa-sun"></i>';
  } else {
    btn.innerHTML = '<i class="fa-solid fa-moon"></i>';
  }
}

// Toast notification helper
function showToast(title, body = '', type = 'info', clickCallback = null) {
  const container = document.getElementById('toast-holder');
  const toast = document.createElement('div');
  toast.className = `toast-banner ${type}`;
  
  toast.innerHTML = `
    <div style="flex: 1;">
      <div style="font-weight: bold; font-size: 0.9rem;">${title}</div>
      ${body ? `<div style="font-size: 0.78rem; margin-top: 2px; opacity: 0.9;">${body}</div>` : ''}
    </div>
  `;

  if (clickCallback) {
    toast.onclick = clickCallback;
  } else {
    toast.onclick = () => toast.remove();
  }

  container.appendChild(toast);

  // Automatically fade out after 4.5 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease';
    setTimeout(() => toast.remove(), 500);
  }, 4500);
}

// Simple HTML escaping to prevent XSS
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ----------------------------------------------------
// STORIES & HIGHLIGHTS FEATURE CONTROLLER
// ----------------------------------------------------
let activeStoriesList = [];
let activeGroupIndex = 0;
let activeStoryIndex = 0;
let storyProgressTimer = null;
const STORY_IMAGE_DURATION = 5000;

async function loadStories() {
  const holder = document.getElementById('stories-row-holder');
  if (!holder) return;
  holder.innerHTML = '';

  // 1. Render Current User "Add Story" bubble
  const addBubble = document.createElement('div');
  addBubble.className = 'story-bubble';
  addBubble.id = 'add-story-bubble';
  addBubble.innerHTML = `
    <div class="story-avatar-holder viewed">
      <img src="${window.currentUser.profile_pic || '/uploads/default-avatar.png'}" alt="Avatar">
    </div>
    <div class="story-bubble-add-btn"><i class="fa-solid fa-plus"></i></div>
    <div class="story-bubble-username">Your Story</div>
  `;
  addBubble.onclick = () => {
    let input = document.getElementById('story-file-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'story-file-input';
      input.style.display = 'none';
      input.accept = 'image/*,video/*';
      document.body.appendChild(input);
      input.onchange = handleStoryUpload;
    }
    input.click();
  };
  holder.appendChild(addBubble);

  // 2. Load active stories from other users
  try {
    const list = await apiRequest('/api/stories/active');
    const others = list.filter(g => g.user_id !== window.currentUser.id);
    
    others.forEach((group, index) => {
      const bubble = document.createElement('div');
      bubble.className = 'story-bubble';
      bubble.onclick = () => openStoryViewer(others, index);
      
      bubble.innerHTML = `
        <div class="story-avatar-holder">
          <img src="${group.profile_pic || '/uploads/default-avatar.png'}" alt="${group.username}">
        </div>
        <div class="story-bubble-username">${group.username}</div>
      `;
      holder.appendChild(bubble);
    });
  } catch (err) {
    console.error('Error loading stories:', err);
  }
}

async function handleStoryUpload(e) {
  if (e.target.files.length === 0) return;
  const file = e.target.files[0];
  const formData = new FormData();
  formData.append('file', file);
  
  showToast('⌛ Uploading Story', 'Publishing your story...', 'info');
  try {
    const response = await fetch('/api/stories', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${window.authToken}`
      },
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Story upload failed');
    
    showToast('✅ Story Published', 'Your story is live for 24 hours!', 'success');
    loadStories();
  } catch (err) {
    showToast('❌ Story Upload Failed', err.message, 'error');
  }
}

function openStoryViewer(groups, index = 0) {
  activeStoriesList = groups;
  activeGroupIndex = index;
  activeStoryIndex = 0;
  
  document.getElementById('story-viewer-modal').style.display = 'flex';
  showStory();
}

function showStory() {
  clearStoryTimer();
  
  if (activeGroupIndex >= activeStoriesList.length || activeGroupIndex < 0) {
    closeStoryViewer();
    return;
  }
  
  const group = activeStoriesList[activeGroupIndex];
  if (activeStoryIndex >= group.stories.length) {
    activeGroupIndex++;
    activeStoryIndex = 0;
    showStory();
    return;
  }
  if (activeStoryIndex < 0) {
    activeGroupIndex--;
    if (activeGroupIndex >= 0) {
      activeStoryIndex = activeStoriesList[activeGroupIndex].stories.length - 1;
      showStory();
    } else {
      closeStoryViewer();
    }
    return;
  }
  
  const story = group.stories[activeStoryIndex];
  
  document.getElementById('story-user-avatar').src = group.profile_pic || '/uploads/default-avatar.png';
  document.getElementById('story-user-name').innerText = group.username;
  document.getElementById('story-time-stamp').innerText = formatRelativeTime(story.created_at);
  document.getElementById('story-views-num').innerText = story.view_count || 0;
  
  const isSelf = group.user_id === window.currentUser.id;
  const pinBtn = document.getElementById('story-highlight-btn');
  if (isSelf) {
    pinBtn.style.display = 'flex';
    pinBtn.onclick = () => openHighlightSelector(story.id);
  } else {
    pinBtn.style.display = 'none';
  }
  
  apiRequest(`/api/stories/${story.id}/view`, 'POST').catch(err => console.error(err));
  
  const progContainer = document.getElementById('story-progress-container');
  progContainer.innerHTML = '';
  group.stories.forEach((s, idx) => {
    const segment = document.createElement('div');
    segment.className = 'story-progress-segment';
    if (idx < activeStoryIndex) {
      segment.classList.add('completed');
    }
    const fill = document.createElement('div');
    fill.className = 'story-progress-fill';
    segment.appendChild(fill);
    progContainer.appendChild(segment);
  });
  
  const imgDisp = document.getElementById('story-img-display');
  const vidDisp = document.getElementById('story-video-display');
  
  if (story.media_type === 'video') {
    imgDisp.style.display = 'none';
    vidDisp.style.display = 'block';
    vidDisp.src = story.media_url;
    vidDisp.load();
    vidDisp.oncanplay = () => {
      vidDisp.play();
      startProgress(vidDisp.duration * 1000 || 5000);
    };
    vidDisp.onended = () => nextStory();
    vidDisp.onerror = () => nextStory();
  } else {
    vidDisp.style.display = 'none';
    imgDisp.style.display = 'block';
    imgDisp.src = story.media_url;
    startProgress(STORY_IMAGE_DURATION);
  }
}

function startProgress(duration) {
  const activeSegment = document.querySelectorAll('.story-progress-segment')[activeStoryIndex];
  if (!activeSegment) return;
  const fill = activeSegment.querySelector('.story-progress-fill');
  if (!fill) return;
  
  const startTime = Date.now();
  storyProgressTimer = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct = Math.min(100, (elapsed / duration) * 100);
    fill.style.width = `${pct}%`;
    if (pct >= 100) {
      clearInterval(storyProgressTimer);
      nextStory();
    }
  }, 50);
}

function clearStoryTimer() {
  if (storyProgressTimer) {
    clearInterval(storyProgressTimer);
    storyProgressTimer = null;
  }
  const vidDisp = document.getElementById('story-video-display');
  if (vidDisp) {
    vidDisp.pause();
    vidDisp.src = '';
  }
}

function nextStory() {
  activeStoryIndex++;
  showStory();
}

function prevStory() {
  activeStoryIndex--;
  showStory();
}

function closeStoryViewer() {
  clearStoryTimer();
  document.getElementById('story-viewer-modal').style.display = 'none';
}

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

// Highlights Management
async function openNewHighlightModal() {
  document.getElementById('highlight-title-input').value = '';
  const selector = document.getElementById('highlight-stories-selector');
  selector.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted); padding: 10px;">Reading stories...</p>';
  
  openModal('modal-create-highlight');
  
  try {
    const activeGroups = await apiRequest('/api/stories/active');
    const myGroup = activeGroups.find(g => g.user_id === window.currentUser.id);
    selector.innerHTML = '';
    
    if (!myGroup || myGroup.stories.length === 0) {
      selector.innerHTML = '<p style="font-size: 0.8rem; color: var(--text-muted); padding: 10px;">No active stories in the last 24h to select from.</p>';
      return;
    }
    
    myGroup.stories.forEach(story => {
      const thumb = document.createElement('div');
      thumb.className = 'highlight-selector-thumb';
      thumb.dataset.id = story.id;
      
      let mediaHtml = '';
      if (story.media_type === 'video') {
        mediaHtml = `<video src="${story.media_url}"></video>`;
      } else {
        mediaHtml = `<img src="${story.media_url}">`;
      }
      
      thumb.innerHTML = `
        ${mediaHtml}
        <div class="highlight-selector-check"><i class="fa-solid fa-check"></i></div>
      `;
      
      thumb.onclick = () => {
        thumb.classList.toggle('selected');
      };
      
      selector.appendChild(thumb);
    });
  } catch (err) {
    selector.innerHTML = `<p style="font-size: 0.8rem; color: var(--danger); padding: 10px;">Error: ${err.message}</p>`;
  }
}

async function saveNewHighlight() {
  const title = document.getElementById('highlight-title-input').value.trim();
  if (!title) {
    showToast('⚠️ Title required', 'Please type a title for your highlight collection.', 'warning');
    return;
  }
  
  const selectedThumbs = document.querySelectorAll('#highlight-stories-selector .highlight-selector-thumb.selected');
  const storyIds = Array.from(selectedThumbs).map(t => parseInt(t.dataset.id));
  
  if (storyIds.length === 0) {
    showToast('⚠️ No stories selected', 'Please select at least one story to create a highlight.', 'warning');
    return;
  }
  
  try {
    const highlight = await apiRequest('/api/highlights', 'POST', { title });
    for (const storyId of storyIds) {
      await apiRequest(`/api/highlights/${highlight.id}/stories`, 'POST', { storyId });
    }
    closeAllModals();
    showToast('✨ Highlight Created', `"${title}" has been saved to your profile!`, 'success');
    loadProfile(window.currentUser.username);
  } catch (err) {
    showToast('❌ Highlight Error', err.message, 'error');
  }
}

async function openHighlightSelector(storyId) {
  clearStoryTimer();
  try {
    const highlights = await apiRequest(`/api/users/${window.currentUser.username}/highlights`);
    if (highlights.length === 0) {
      const title = prompt("Enter a title for a new story Highlight:");
      if (title && title.trim()) {
        const hl = await apiRequest('/api/highlights', 'POST', { title: title.trim() });
        await apiRequest(`/api/highlights/${hl.id}/stories`, 'POST', { storyId });
        showToast('✨ Story Pinned', `Added to new highlight "${title}"`, 'success');
      }
      showStory();
      return;
    }
    
    let msg = "Select highlight index to add to, or type a new highlight name:\n";
    highlights.forEach((h, idx) => {
      msg += `${idx + 1}. ${h.title}\n`;
    });
    msg += `type "new" to create a new collection`;
    
    const choice = prompt(msg);
    if (!choice) {
      showStory();
      return;
    }
    
    if (choice.trim().toLowerCase() === 'new') {
      const title = prompt("Enter a title for a new story Highlight:");
      if (title && title.trim()) {
        const hl = await apiRequest('/api/highlights', 'POST', { title: title.trim() });
        await apiRequest(`/api/highlights/${hl.id}/stories`, 'POST', { storyId });
        showToast('✨ Story Pinned', `Added to new highlight "${title}"`, 'success');
      }
    } else {
      const idx = parseInt(choice) - 1;
      if (idx >= 0 && idx < highlights.length) {
        const hl = highlights[idx];
        await apiRequest(`/api/highlights/${hl.id}/stories`, 'POST', { storyId });
        showToast('✨ Story Pinned', `Added to highlight "${hl.title}"`, 'success');
      } else {
        showToast('⚠️ Invalid option', 'Story not pinned.', 'warning');
      }
    }
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
  showStory();
}

// AI Hashtags explore tags loader
async function loadTrendingTags() {
  const holder = document.getElementById('trending-tags-holder');
  if (!holder) return;
  
  try {
    const tags = await apiRequest('/api/posts/trending-tags');
    holder.innerHTML = '';
    
    if (tags.length === 0) {
      holder.innerHTML = '<span style="font-size: 0.8rem; color: var(--text-muted);">No tags yet.</span>';
      return;
    }
    
    tags.forEach(tag => {
      const chip = document.createElement('div');
      chip.className = 'tag-chip';
      chip.style.fontSize = '0.75rem';
      chip.style.padding = '4px 10px';
      chip.innerText = `#${tag.name} (${tag.count})`;
      chip.onclick = () => {
        switchPanel('explore-panel');
        const exploreChips = document.querySelectorAll('#explore-tags-container .tag-chip');
        exploreChips.forEach(x => {
          if (x.getAttribute('data-tag') === tag.name) {
            x.classList.add('active');
          } else {
            x.classList.remove('active');
          }
        });
        loadExplore(tag.name);
      };
      holder.appendChild(chip);
    });
  } catch (err) {
    console.error('Error loading trending tags:', err);
  }
}
