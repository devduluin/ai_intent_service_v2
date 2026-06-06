// ============================================================
// Chat App - Main Application Logic
// ============================================================
// Initializes and coordinates all chat components
// ============================================================

import { CONFIG, getUserId, getAppName } from './config.js';
import { storageManager } from './storage-manager.js';
import { messageHandler, MessageType } from './message-handler.js';
import { uiManager } from './ui-manager.js';
import { apiClient } from './api-client.js';
import { typingIndicator } from './typing-indicator.js';
import { wsClient, CONNECTION_STATUS } from './ws-client.js';

/**
 * Chat Application Class
 * Main coordinator for all chat functionality
 */
class ChatApp {
  
  constructor() {
    this.isInitialized = false;
    this.messages = [];
    this.isLoading = false;
  }
  
  /**
   * Initialize the chat application
   */
  async initialize() {
    console.log('[ChatApp] Initializing...');
    
    // Initialize UI
    if (!uiManager.initialize()) {
      console.error('[ChatApp] Failed to initialize UI');
      return false;
    }
    
    // Load messages from storage
    this.messages = storageManager.getMessages();
    
    // Render existing messages
    uiManager.renderMessages(this.messages);
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Show welcome message if no history
    if (this.messages.length === 0) {
      this.addSystemMessage('Halo! Saya AI Assistant. Ada yang bisa saya bantu?');
    }
    
    this.isInitialized = true;
    console.log('[ChatApp] Initialized successfully');
    
    // Make app globally accessible for UI callbacks
    window.chatApp = this;
    
    return true;
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearChat');
    
    if (!messageInput) {
      console.error('[ChatApp] Message input element not found');
      return;
    }
    
    // Send button click
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.handleSend());
    }
    
    // Keyboard shortcuts
    messageInput.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + Enter to send
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.handleSend();
      }
      // Shift + Enter for new line (default behavior)
      else if (e.shiftKey && e.key === 'Enter') {
        // Allow default behavior (new line)
        return;
      }
      // Enter alone to send (alternative)
      else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
    
    // Input change (character count and auto-resize)
    messageInput.addEventListener('input', (e) => {
      const value = e.target.value;
      
      // Update character count
      const charCountEl = document.getElementById('charCount');
      if (charCountEl) {
        charCountEl.textContent = value.length;
        
        // Add warning class when approaching limit
        if (value.length > 1800) {
          e.target.parentElement.parentElement.classList.add('near-limit');
        } else {
          e.target.parentElement.parentElement.classList.remove('near-limit');
        }
      }
      
      // Auto-resize textarea
      e.target.style.height = 'auto';
      const newHeight = Math.min(e.target.scrollHeight, 200);
      e.target.style.height = newHeight + 'px';
      
      // Update send button state
      if (sendBtn) {
        sendBtn.disabled = !value.trim();
      }
    });
    
    // Clear chat button
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.handleClearChat());
    }
    
    // Suggestion buttons
    const suggestionBtns = document.querySelectorAll('.suggestion-btn');
    suggestionBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const prompt = e.currentTarget.dataset.prompt;
        if (prompt) {
          messageInput.value = prompt;
          messageInput.focus();
          messageInput.dispatchEvent(new Event('input', { bubbles: true }));
          // Scroll to input
          document.querySelector('.input-area').scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
    
    // Focus input on load
    messageInput.focus();
    
    // Initial send button state
    if (sendBtn) {
      sendBtn.disabled = !messageInput.value.trim();
    }
  }
  
  /**
   * Handle send message action
   */
  async handleSend() {
    if (this.isLoading) {
      console.log('[ChatApp] Already loading, ignoring send');
      return;
    }
    
    const messageText = uiManager.getInputValue();
    
    if (!messageText) {
      console.log('[ChatApp] Empty message, ignoring');
      return;
    }
    
    console.log('[ChatApp] Sending message:', messageText);
    
    // Create user message
    const userMessage = messageHandler.createUserMessage(messageText);
    this.addMessage(userMessage);
    
    // Clear input
    uiManager.clearInput();
    
    // Show typing indicator
    this.setLoading(true);
    typingIndicator.show();
    
    // Send via WebSocket or HTTP fallback
    try {
      const chatHistory = messageHandler.buildChatHistory(this.messages.slice(0, -1));
      const startTime = Date.now();
      
      // Try WebSocket first if enabled and connected
      if (CONFIG.ENABLE_WEBSOCKET && wsClient.isConnected()) {
        console.log('[ChatApp] Sending via WebSocket');
        
        const sent = wsClient.sendChatMessage(messageText, chatHistory);
        
        if (sent) {
          // Wait for response (will be handled by handleWSResponse)
          this.waitForWSResponse(startTime);
          return;
        }
        
        // Fallback to HTTP if send failed
        console.log('[ChatApp] WebSocket send failed, using HTTP fallback');
      }
      
      // HTTP fallback
      console.log('[ChatApp] Sending via HTTP');
      const response = await apiClient.sendWithRetry(() => 
        apiClient.sendChatMessage(messageText, chatHistory)
      );
      const responseTime = Date.now() - startTime;
      
      // Hide typing indicator
      typingIndicator.hide();
      this.setLoading(false);
      
      // Create AI message with enhanced metadata
      const aiMessage = messageHandler.createAiMessage(
        response.response || response.message || 'Maaf, saya tidak mengerti.',
        {
          intent: response.intent || 'unknown',
          confidence: response.confidence || 0,
          responseTime: response.metadata?.totalTime || responseTime,
          via: 'http'
        }
      );
      
      this.addMessage(aiMessage);
      
    } catch (error) {
      console.error('[ChatApp] Error:', error);
      
      // Hide typing indicator
      typingIndicator.hide();
      this.setLoading(false);
      
      // Show error message with better context
      let errorMessage = CONFIG.ERROR_MESSAGE;
      
      if (error.message?.includes('timeout')) {
        errorMessage = CONFIG.TIMEOUT_MESSAGE;
      } else if (error.message?.includes('Failed to fetch')) {
        errorMessage = 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      const errorMessageObj = messageHandler.createErrorMessage(
        errorMessage,
        error
      );
      this.addMessage(errorMessageObj);
    }
  }
  
  /**
   * Wait for WebSocket response
   */
  waitForWSResponse(startTime) {
    const timeout = setTimeout(() => {
      typingIndicator.hide();
      this.setLoading(false);
      
      const errorMessageObj = messageHandler.createErrorMessage(
        'Request timeout. Using HTTP fallback.',
        new Error('WebSocket timeout')
      );
      this.addMessage(errorMessageObj);
      
      // Retry with HTTP
      this.handleSend();
    }, CONFIG.API_TIMEOUT);
    
    // Store timeout ID for cleanup
    this.wsResponseTimeout = timeout;
  }
  
  /**
   * Handle WebSocket response
   */
  handleWSResponse(message) {
    console.log('[ChatApp] handleWSResponse called', {
      type: message.type,
      success: message.success,
      intent: message.intent,
      isAutomationReminder: message.intent === 'automation_reminder',
      responsePreview: message.response?.substring(0, 30)
    });

    if (this.wsResponseTimeout) {
      clearTimeout(this.wsResponseTimeout);
      this.wsResponseTimeout = null;
    }
    
    // Hide typing indicator
    typingIndicator.hide();
    this.setLoading(false);
    
    if (message.success) {
      // Create AI message
      const aiMessage = messageHandler.createAiMessage(
        message.response || 'Maaf, saya tidak mengerti.',
        {
          intent: message.intent || 'unknown',
          confidence: message.confidence || 0,
          responseTime: message.metadata?.responseTime || 0,
          via: 'websocket',
          isAutomationReminder: message.intent === 'automation_reminder'
        }
      );
      
      console.log('[ChatApp] Created AI message', {
        intent: aiMessage.intent,
        contentPreview: aiMessage.content?.substring(0, 30)
      });
      
      this.addMessage(aiMessage);
    } else {
      // Show error
      const errorMessageObj = messageHandler.createErrorMessage(
        message.error || 'Failed to process message',
        message
      );
      this.addMessage(errorMessageObj);
    }
  }
  
  /**
   * Add a message to the chat
   * @param {Object} message - Message object
   */
  addMessage(message) {
    if (!messageHandler.isValidMessage(message)) {
      console.error('[ChatApp] Invalid message:', message);
      return;
    }
    
    console.log('[ChatApp] addMessage called', {
      type: message.type,
      content: message.content?.substring(0, 30),
      isAutomationReminder: message.isAutomationReminder,
      totalMessagesBeforeAdd: this.messages.length
    });
    
    this.messages.push(message);
    
    console.log('[ChatApp] Message pushed to array', {
      totalMessagesAfterAdd: this.messages.length,
      lastMessage: this.messages[this.messages.length - 1]?.content?.substring(0, 30)
    });
    
    // Save to storage
    storageManager.saveMessages(this.messages);
    
    // Render in UI
    console.log('[ChatApp] About to call uiManager.addMessage for rendering');
    uiManager.addMessage(message);
    
    console.log('[ChatApp] Message added and rendered:', message.type, message.content?.substring(0, 50));
  }
  
  /**
   * Add a system message
   * @param {string} text - Message text
   */
  addSystemMessage(text) {
    const message = messageHandler.createSystemMessage(text);
    this.addMessage(message);
  }
  
  /**
   * Delete a message
   * @param {number} index - Message index
   */
  deleteMessage(index) {
    if (index < 0 || index >= this.messages.length) {
      return;
    }
    
    const message = this.messages[index];
    console.log('[ChatApp] Deleting message:', message);
    
    this.messages.splice(index, 1);
    
    // Save to storage
    storageManager.saveMessages(this.messages);
    
    // Remove from UI
    uiManager.removeMessage(index);
    
    // Re-render all messages to update indices
    uiManager.renderMessages(this.messages);
  }
  
  /**
   * Clear all chat messages
   */
  handleClearChat() {
    if (!confirm('Yakin ingin menghapus semua chat?')) {
      return;
    }
    
    console.log('[ChatApp] Clearing chat');
    
    // Clear storage
    storageManager.clearMessages();
    
    // Clear messages array
    this.messages = [];
    
    // Clear UI
    uiManager.clearMessages();
    
    // Show welcome message
    this.addSystemMessage('Chat telah dihapus. Ada yang bisa saya bantu?');
  }
  
  /**
   * Set loading state
   * @param {boolean} loading - Is loading
   */
  setLoading(loading) {
    this.isLoading = loading;
    
    if (loading) {
      uiManager.showLoading();
    } else {
      uiManager.hideLoading();
    }
    
    console.log('[ChatApp] Loading state:', loading);
  }
  
  /**
   * Get current message count
   * @returns {number} Message count
   */
  getMessageCount() {
    return this.messages.length;
  }
  
  /**
   * Get chat statistics
   * @returns {Object} Chat stats
   */
  getStats() {
    const userMessages = this.messages.filter(m => m.type === MessageType.USER).length;
    const aiMessages = this.messages.filter(m => m.type === MessageType.AI).length;
    const storageInfo = storageManager.getStorageInfo();
    
    return {
      totalMessages: this.messages.length,
      userMessages,
      aiMessages,
      systemMessages: this.messages.filter(m => m.type === MessageType.SYSTEM).length,
      errorMessages: this.messages.filter(m => m.type === MessageType.ERROR).length,
      storage: storageInfo,
      userId: getUserId(),
      appName: getAppName()
    };
  }
  
  /**
   * Export chat history
   * @returns {string} Chat history as JSON
   */
  exportChat() {
    return storageManager.exportMessages();
  }
  
  /**
   * Import chat history
   * @param {string} jsonString - Chat history JSON
   */
  importChat(jsonString) {
    const success = storageManager.importMessages(jsonString);
    
    if (success) {
      this.messages = storageManager.getMessages();
      uiManager.renderMessages(this.messages);
      console.log('[ChatApp] Chat imported successfully');
    } else {
      console.error('[ChatApp] Failed to import chat');
      uiManager.showToast('Failed to import chat', 'error');
    }
  }
  
  /**
   * Scroll to bottom of chat
   */
  scrollToBottom() {
    uiManager.scrollToBottom();
  }
  
  /**
   * Focus input field
   */
  focusInput() {
    uiManager.focusInput();
  }

  /**
   * ✅ Handle God Mode change events from WebSocket
   * @param {Object} message - Mode change notification
   */
  handleModeChange(message) {
    console.log('[ChatApp] Mode change event:', message);
    
    if (message.mode === 'god-mode') {
      const godModeName = message.godModeName || message.modeName;
      // ✅ Inject God Mode separator after last message
      this.injectGodModeSeparator(godModeName);
      console.log('[ChatApp] Entered God Mode:', godModeName);
    } else if (message.mode === 'chat-mode') {
      // ✅ Remove God Mode separator
      this.removeGodModeSeparator();
      console.log('[ChatApp] Exited to Chat Mode');
    }
  }

  /**
   * Inject God Mode separator into message stream
   * @param {string|null} godModeName - Name of the god mode
   */
  injectGodModeSeparator(godModeName) {
    const messagesContainer = document.getElementById('messages');
    const template = document.getElementById('godModeSeparatorTemplate');
    
    if (!messagesContainer || !template) {
      console.warn('[ChatApp] Cannot inject God Mode separator - elements not found');
      return;
    }

    // Clone template
    const clone = template.content.cloneNode(true);
    const separator = clone.querySelector('.god-mode-separator');
    const modeText = separator.querySelector('.god-mode-text');
    const exitBtn = separator.querySelector('.god-mode-exit-btn');
    
    // Set mode text
    if (godModeName) {
      modeText.textContent = `Entry ${godModeName.replace('_', ' ').toUpperCase()} Mode`;
    }
    
    // Setup exit button
    exitBtn.addEventListener('click', () => {
      console.log('[ChatApp] Exit God Mode button clicked');
      apiClient.sendChatMessage({
        user_id: getUserId(),
        app_name: getAppName(),
        text: 'exit',
        language: 'id'
      }).then(response => {
        console.log('[ChatApp] Exit God Mode command sent');
      }).catch(error => {
        console.error('[ChatApp] Failed to exit God Mode:', error);
      });
    });
    
    // Append to messages container
    messagesContainer.appendChild(clone);
    
    // Scroll to bottom
    this.scrollToBottom();
  }

  /**
   * Remove God Mode separator from message stream
   */
  removeGodModeSeparator() {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    
    const separator = messagesContainer.querySelector('.god-mode-separator');
    if (separator) {
      separator.remove();
    }
  }
}

// Create and initialize app
const chatApp = new ChatApp();

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => chatApp.initialize());
} else {
  chatApp.initialize();
}

export default chatApp;
