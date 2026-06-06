// ============================================================
// Storage Manager - LocalStorage Wrapper
// ============================================================
// Handles all LocalStorage operations for chat messages
// ============================================================

import { CONFIG, getMessagesStorageKey } from './config.js';

/**
 * Storage Manager Class
 * Manages chat messages in LocalStorage
 */
export class StorageManager {
  
  /**
   * Get messages from storage
   * @returns {Array} Array of message objects
   */
  getMessages() {
    try {
      const key = getMessagesStorageKey();
      const messagesJson = localStorage.getItem(key);
      
      if (!messagesJson) {
        return [];
      }
      
      const messages = JSON.parse(messagesJson);
      
      // Ensure we only keep MAX_CHAT_HISTORY messages
      if (messages.length > CONFIG.MAX_CHAT_HISTORY) {
        return messages.slice(-CONFIG.MAX_CHAT_HISTORY);
      }
      
      return messages;
    } catch (error) {
      console.error('[StorageManager] Error getting messages:', error);
      return [];
    }
  }
  
  /**
   * Save messages to storage
   * @param {Array} messages - Array of message objects
   * @returns {boolean} Success status
   */
  saveMessages(messages) {
    try {
      const key = getMessagesStorageKey();
      
      // Ensure we only keep MAX_CHAT_HISTORY messages
      const messagesToSave = messages.slice(-CONFIG.MAX_CHAT_HISTORY);
      
      localStorage.setItem(key, JSON.stringify(messagesToSave));
      return true;
    } catch (error) {
      console.error('[StorageManager] Error saving messages:', error);
      
      // Handle storage full error
      if (error.name === 'QuotaExceededError') {
        // Clear old messages to make space
        this.clearMessages();
        console.warn('[StorageManager] Storage full, cleared old messages');
      }
      
      return false;
    }
  }
  
  /**
   * Add a single message to storage
   * @param {Object} message - Message object
   * @returns {boolean} Success status
   */
  addMessage(message) {
    try {
      const messages = this.getMessages();
      messages.push(message);
      return this.saveMessages(messages);
    } catch (error) {
      console.error('[StorageManager] Error adding message:', error);
      return false;
    }
  }
  
  /**
   * Clear all messages from storage
   * @returns {boolean} Success status
   */
  clearMessages() {
    try {
      const key = getMessagesStorageKey();
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error('[StorageManager] Error clearing messages:', error);
      return false;
    }
  }
  
  /**
   * Delete a specific message by index
   * @param {number} index - Message index
   * @returns {boolean} Success status
   */
  deleteMessage(index) {
    try {
      const messages = this.getMessages();
      
      if (index < 0 || index >= messages.length) {
        return false;
      }
      
      messages.splice(index, 1);
      return this.saveMessages(messages);
    } catch (error) {
      console.error('[StorageManager] Error deleting message:', error);
      return false;
    }
  }
  
  /**
   * Get last N messages
   * @param {number} count - Number of messages
   * @returns {Array} Array of message objects
   */
  getLastMessages(count = CONFIG.MAX_CHAT_HISTORY) {
    const messages = this.getMessages();
    return messages.slice(-count);
  }
  
  /**
   * Get message count
   * @returns {number} Number of messages
   */
  getMessageCount() {
    return this.getMessages().length;
  }
  
  /**
   * Check if storage has messages
   * @returns {boolean} True if has messages
   */
  hasMessages() {
    return this.getMessageCount() > 0;
  }
  
  /**
   * Export messages as JSON
   * @returns {string} JSON string
   */
  exportMessages() {
    const messages = this.getMessages();
    return JSON.stringify(messages, null, 2);
  }
  
  /**
   * Import messages from JSON
   * @param {string} jsonString - JSON string
   * @returns {boolean} Success status
   */
  importMessages(jsonString) {
    try {
      const messages = JSON.parse(jsonString);
      
      if (!Array.isArray(messages)) {
        throw new Error('Invalid format: expected array');
      }
      
      return this.saveMessages(messages);
    } catch (error) {
      console.error('[StorageManager] Error importing messages:', error);
      return false;
    }
  }
  
  /**
   * Get storage usage info
   * @returns {Object} Storage usage info
   */
  getStorageInfo() {
    const messages = this.getMessages();
    const messagesSize = new Blob([JSON.stringify(messages)]).size;
    
    return {
      messageCount: messages.length,
      messagesSize: messagesSize,
      messagesSizeFormatted: this.formatBytes(messagesSize),
      maxMessages: CONFIG.MAX_CHAT_HISTORY
    };
  }
  
  /**
   * Format bytes to human readable
   * @param {number} bytes - Bytes
   * @returns {string} Formatted string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

// Singleton instance
export const storageManager = new StorageManager();

export default storageManager;
