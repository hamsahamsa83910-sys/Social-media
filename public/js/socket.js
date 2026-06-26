// Global socket reference
let socket = null;

/**
 * Initializes and connects Socket.IO client using JWT token
 */
function initSocket(token) {
  if (socket) {
    socket.disconnect();
  }

  // Connect to the socket server
  socket = io({
    auth: {
      token: token
    }
  });

  socket.on('connect', () => {
    console.log('Connected to real-time WebSocket server');
  });

  // Handle incoming direct message
  socket.on('incoming_message', (message) => {
    // 1. Check if the chat view is open and we are talking to the sender/receiver
    const activeUserId = window.currentChattingUserId;
    const currentUserId = window.currentUser?.id;

    const isMessageFromActiveChat = 
      (message.sender_id === activeUserId && message.receiver_id === currentUserId) ||
      (message.sender_id === currentUserId && message.receiver_id === activeUserId);

    if (window.activePanel === 'chat-panel' && isMessageFromActiveChat) {
      // Append directly to screen chat log
      appendChatMessage(message);
      // Automatically scroll chat window to bottom
      scrollChatToBottom();
      
      // If we received the message, trigger read API
      if (message.receiver_id === currentUserId) {
        fetch(`/api/chat/history/${activeUserId}`, {
          headers: { 'Authorization': `Bearer ${window.authToken}` }
        }).catch(err => console.error('Error marking message read:', err));
      }
    } else {
      // Throw notification toast if message is from someone else
      if (message.sender_id !== currentUserId) {
        showToast(
          `✉️ New message from @${message.sender_name}`,
          message.content.length > 50 ? message.content.substring(0, 50) + '...' : message.content,
          'info',
          () => {
            // Click callback: Open chat with sender
            switchPanel('chat-panel');
            openDirectMessage(message.sender_id, message.sender_name);
          }
        );
        // Request count update
        updateUnreadBadgeCount();
      }
    }
  });

  // Handle incoming notification (likes, comments, follows)
  socket.on('new_notification', (notification) => {
    let title = '';
    let body = '';
    let iconClass = '';
    let panelTarget = 'notifications-panel';

    if (notification.type === 'like') {
      title = `❤️ @${notification.sender_username} liked your post`;
      iconClass = 'like';
    } else if (notification.type === 'comment') {
      title = `💬 @${notification.sender_username} commented on your post`;
      iconClass = 'comment';
    } else if (notification.type === 'follow') {
      title = `👤 @${notification.sender_username} followed you`;
      iconClass = 'follow';
    } else if (notification.type === 'message') {
      title = `✉️ @${notification.sender_username} messaged you`;
      iconClass = 'message';
      panelTarget = 'chat-panel';
    } else if (notification.type === 'report') {
      title = `⚠️ Your post was reported by a user`;
      iconClass = 'report';
      panelTarget = 'feed-panel';
    }

    showToast(title, body, 'info', () => {
      switchPanel(panelTarget);
      if (notification.type === 'message') {
        openDirectMessage(notification.sender_id, notification.sender_username);
      }
    });

    // Update unread notifications indicator badge
    updateUnreadBadgeCount();
    
    // If notification panel is active, reload it
    if (window.activePanel === 'notifications-panel') {
      loadNotificationsList();
    }
  });

  // Real-time online/offline updates
  socket.on('user_status_change', (data) => {
    const statusDot = document.querySelector(`.status-dot-${data.userId}`);
    if (statusDot) {
      if (data.status === 'online') {
        statusDot.classList.add('online');
      } else {
        statusDot.classList.remove('online');
      }
    }
    
    // If active chat user changed status
    if (window.currentChattingUserId === data.userId) {
      const headerStatus = document.getElementById('chat-header-status');
      if (headerStatus) {
        headerStatus.innerText = data.status === 'online' ? 'Online' : 'Offline';
        headerStatus.style.color = data.status === 'online' ? 'var(--success)' : 'var(--text-muted)';
      }
    }
  });

  // Handle administrator ban kick-out
  socket.on('banned_disconnect', (data) => {
    alert(data.message || 'You have been banned by the administrator.');
    performLogout();
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected from server');
  });
}

/**
 * Disconnects active Socket.IO connection
 */
function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Emits message sending over sockets
 */
function sendSocketMessage(receiverId, content, callback) {
  if (socket && socket.connected) {
    socket.emit('send_message', { receiverId, content }, (response) => {
      if (callback) callback(response);
    });
  } else {
    showToast('⚠️ Error', 'Connection offline. Failed to send message.', 'error');
  }
}
