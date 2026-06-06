// ============================================================
// WebSocket Client - Real-time Communication
// ============================================================
// Handles WebSocket connection with automatic reconnection
// and HTTP fallback
// ============================================================

import { CONFIG } from './config.js';
import { apiClient } from './api-client.js';

/**
 * WebSocket Message Types
 */
export const WS_MESSAGE_TYPE = {
  // Connection
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  
  // Chat
  SESSION_INIT: 'session_init',
  CHAT: 'chat',
  RESPONSE: 'response',
  TYPING: 'typing',
  
  // Keep-alive
  PING: 'ping',
  PONG: 'pong',
  
  // Control
  ERROR: 'error',
  RECONNECT: 'reconnect'
};

/**
 * Connection Status
 */
export const CONNECTION_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting'
};

/**
 * WebSocket Client Class
 * Manages WebSocket connection with auto-reconnect
 */
export class WSClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl || this.getDefaultWsUrl();
    this.ws = null;
    this.status = CONNECTION_STATUS.DISCONNECTED;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = CONFIG.WS_MAX_RECONNECT_ATTEMPTS || 5;
    this.reconnectDelay = CONFIG.WS_RECONNECT_DELAY || 3000;
    this.messageQueue = [];
    this.callbacks = {
      onOpen: null,
      onClose: null,
      onMessage: null,
      onError: null,
      onStatusChange: null
    };
    this.lastPingTime = 0;
    this.pingInterval = null;
  }

  /**
   * Get default WebSocket URL from config
   */
  getDefaultWsUrl() {
    const httpUrl = CONFIG.API_BASE_URL || window.location.origin;
    const wsUrl = httpUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsUrl}${CONFIG.WS_ENDPOINT || '/api/v1/chat-ws'}`;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (this.status === CONNECTION_STATUS.CONNECTED) {
      console.log('[WSClient] Already connected');
      return;
    }

    console.log('[WSClient] Connecting to:', this.wsUrl);
    this.setStatus(CONNECTION_STATUS.CONNECTING);

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => this.handleOpen();
      this.ws.onclose = (event) => this.handleClose(event);
      this.ws.onerror = (error) => this.handleError(error);
      this.ws.onmessage = (event) => this.handleMessage(event);

    } catch (error) {
      console.error('[WSClient] Connection failed:', error);
      this.handleConnectionFailed(error);
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    console.log('[WSClient] Disconnecting');
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus(CONNECTION_STATUS.DISCONNECTED);
    this.reconnectAttempts = 0;
  }

  /**
   * Handle connection open
   */
  handleOpen() {
    console.log('[WSClient] Connected');
    this.setStatus(CONNECTION_STATUS.CONNECTED);
    this.reconnectAttempts = 0;
    
    // Start ping interval
    this.startPingInterval();

    // Bind this fresh socket to the current user/app so server-side UI state can be replayed.
    this.sendSessionInit();
    
    // Deliver queued messages
    this.deliverQueuedMessages();
    
    // Call callback
    if (this.callbacks.onOpen) {
      this.callbacks.onOpen();
    }
  }

  /**
   * Handle connection close
   */
  handleClose(event) {
    console.log('[WSClient] Disconnected', {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean
    });

    const wasConnected = this.status === CONNECTION_STATUS.CONNECTED;
    this.setStatus(CONNECTION_STATUS.DISCONNECTED);
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Auto-reconnect if not manually disconnected
    if (wasConnected && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
    
    // Call callback
    if (this.callbacks.onClose) {
      this.callbacks.onClose(event);
    }
  }

  /**
   * Handle connection error
   */
  handleError(error) {
    console.error('[WSClient] Error:', error);
    
    // Call callback
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  /**
   * Handle incoming message
   */
  handleMessage(event) {
    try {
      const message = JSON.parse(event.data);
      console.log('[WSClient] Message received:', {
        type: message.type,
        intent: message.intent,
        isAutomationReminder: message.intent === 'automation_reminder',
        responsePreview: message.response?.substring(0, 30),
        timestamp: new Date().toISOString()
      });

      // Handle ping - respond with pong
      if (message.type === WS_MESSAGE_TYPE.PING) {
        this.sendPong();
        return;
      }

      // Handle pong (keep-alive acknowledgment)
      if (message.type === WS_MESSAGE_TYPE.PONG) {
        console.debug('[WSClient] Server pong received (keep-alive)');
        return;
      }

      // Call callback for other message types
      if (this.callbacks.onMessage) {
        console.log('[WSClient] About to call onMessage callback for:', message.type);
        this.callbacks.onMessage(message);
        console.log('[WSClient] onMessage callback completed');
      } else {
        console.warn('[WSClient] No onMessage callback registered');
      }

    } catch (error) {
      console.error('[WSClient] Error parsing message:', error);
    }
  }

  /**
   * Handle connection failure
   */
  handleConnectionFailed(error) {
    this.setStatus(CONNECTION_STATUS.DISCONNECTED);
    
    // Try HTTP fallback
    console.log('[WSClient] WebSocket failed, will use HTTP fallback');
    
    // Call callback
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  /**
   * Schedule reconnection
   */
  scheduleReconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`[WSClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.setStatus(CONNECTION_STATUS.RECONNECTING);

    setTimeout(() => {
      if (this.status !== CONNECTION_STATUS.DISCONNECTED) {
        this.connect();
      }
    }, delay);
  }

  /**
   * Send message through WebSocket
   */
  send(message) {
    if (this.status !== CONNECTION_STATUS.CONNECTED || !this.ws) {
      console.log('[WSClient] Queueing message (not connected)');
      this.messageQueue.push(message);
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WSClient] Send failed:', error);
      this.messageQueue.push(message);
      return false;
    }
  }

  /**
   * Send chat message
   */
  sendChatMessage(message, chatHistory = []) {
    const payload = {
      user_id: this.getUserId(),
      app_name: this.getAppName(),
      text: message,
      chat_history: chatHistory,
      language: 'id',
      attributes: {
        name: "John Doe",
        params: {
          company_id: "79483b71-25c2-11f0-8c42-d28e58827589",  // ✅ Example param
        }
      }  // ✅ Add attributes
    };
    
    console.log('[WSClient] Sending chat message:', payload);  // ✅ Log payload
    
    return this.send({
      type: WS_MESSAGE_TYPE.CHAT,
      payload: payload,
      timestamp: Date.now()
    });
  }

  /**
   * Send session identity immediately after reconnect.
   */
  sendSessionInit() {
    return this.send({
      type: WS_MESSAGE_TYPE.SESSION_INIT,
      payload: {
        user_id: this.getUserId(),
        app_name: this.getAppName()
      },
      timestamp: Date.now()
    });
  }

  /**
   * Send typing indicator
   */
  sendTypingIndicator(isTyping = true) {
    return this.send({
      type: WS_MESSAGE_TYPE.TYPING,
      payload: {
        isTyping
      },
      timestamp: Date.now()
    });
  }

  /**
   * Send ping
   */
  sendPing() {
    this.lastPingTime = Date.now();
    return this.send({
      type: WS_MESSAGE_TYPE.PING,
      timestamp: Date.now()
    });
  }

  /**
   * Send pong
   */
  sendPong() {
    return this.send({
      type: WS_MESSAGE_TYPE.PONG,
      timestamp: Date.now()
    });
  }

  /**
   * Start ping interval
   */
  startPingInterval() {
    if (this.pingInterval) {
      return;
    }

    this.pingInterval = setInterval(() => {
      if (this.status === CONNECTION_STATUS.CONNECTED) {
        this.sendPing();
      }
    }, CONFIG.WS_PING_INTERVAL || 30000); // 30 seconds
  }

  /**
   * Deliver queued messages
   */
  deliverQueuedMessages() {
    if (this.messageQueue.length === 0) {
      return;
    }

    console.log(`[WSClient] Delivering ${this.messageQueue.length} queued messages`);

    // Send with small delay to avoid flooding
    const sendNext = () => {
      if (this.messageQueue.length === 0 || this.status !== CONNECTION_STATUS.CONNECTED) {
        return;
      }

      const message = this.messageQueue.shift();
      if (message && this.send(message)) {
        setTimeout(sendNext, 100); // 100ms delay between messages
      }
    };

    sendNext();
  }

  /**
   * Set connection status
   */
  setStatus(status) {
    const oldStatus = this.status;
    this.status = status;
    
    console.log(`[WSClient] Status: ${oldStatus} → ${status}`);
    
    // Call callback
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(status, oldStatus);
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.status === CONNECTION_STATUS.CONNECTED;
  }

  /**
   * Set callbacks
   */
  onOpen(callback) {
    this.callbacks.onOpen = callback;
  }

  onClose(callback) {
    this.callbacks.onClose = callback;
  }

  onMessage(callback) {
    this.callbacks.onMessage = callback;
  }

  onError(callback) {
    this.callbacks.onError = callback;
  }

  onStatusChange(callback) {
    this.callbacks.onStatusChange = callback;
  }

  /**
   * Get user ID from storage
   */
  getUserId() {
    return localStorage.getItem(CONFIG.STORAGE_KEY_PREFIX + CONFIG.STORAGE_USER_ID_KEY) || 
           CONFIG.DEFAULT_USER_ID;
  }

  /**
   * Get app name from storage
   */
  getAppName() {
    return localStorage.getItem(CONFIG.STORAGE_KEY_PREFIX + CONFIG.STORAGE_APP_NAME_KEY) || 
           CONFIG.APP_NAME;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      status: this.status,
      reconnectAttempts: this.reconnectAttempts,
      queuedMessages: this.messageQueue.length,
      lastPingTime: this.lastPingTime,
      url: this.wsUrl
    };
  }
}

// Singleton instance
export const wsClient = new WSClient();

export default wsClient;
