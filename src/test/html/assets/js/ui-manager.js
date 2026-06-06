// ============================================================
// UI Manager - DOM Manipulation
// ============================================================
// Handles all UI updates and DOM operations
// ============================================================

import { CONFIG } from './config.js';
import { MessageType, messageHandler } from './message-handler.js';

/**
 * UI Manager Class
 * Manages all DOM operations and UI updates
 */
export class UIManager {
  
  constructor() {
    this.messagesContainer = null;
    this.messageInput = null;
    this.sendButton = null;
    this.loader = null;
    this.clearButton = null;
    this.charCount = null;
    
    this.isInitialized = false;
  }
  
  /**
   * Initialize UI elements
   */
  initialize() {
    this.messagesContainer = document.getElementById('messages');
    this.messageInput = document.getElementById('messageInput');
    this.sendButton = document.getElementById('sendBtn');
    this.loader = document.getElementById('loader');
    this.clearButton = document.getElementById('clearChat');
    this.charCount = document.getElementById('charCount');
    
    if (!this.messagesContainer || !this.messageInput) {
      console.error('[UIManager] Required elements not found');
      return false;
    }
    
    this.isInitialized = true;
    console.log('[UIManager] Initialized');
    return true;
  }
  
  /**
   * Render a single message
   * @param {Object} message - Message object
   * @param {number} index - Message index
   * @returns {HTMLElement} Message element
   */
  renderMessage(message, index) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${message.type}`;
    messageDiv.dataset.messageId = message.id;
    messageDiv.dataset.index = index;
    
    // Message content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    if (message.type === MessageType.LOADING) {
      contentDiv.innerHTML = `
        <div class="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      `;
    } else {
      contentDiv.innerHTML = messageHandler.formatMessage(message);
    }
    
    messageDiv.appendChild(contentDiv);
    
    // Message metadata
    const metaDiv = document.createElement('div');
    metaDiv.className = 'message-meta';
    
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'message-time';
    timestampSpan.textContent = this.formatTimestamp(message.timestamp);
    metaDiv.appendChild(timestampSpan);
    
    // Action buttons (for AI messages)
    if (message.type === MessageType.AI && CONFIG.ENABLE_COPY_MESSAGE) {
      const copyButton = document.createElement('button');
      copyButton.className = 'message-action-btn';
      copyButton.textContent = '📋';
      copyButton.title = 'Copy';
      copyButton.onclick = () => this.copyMessage(message.text);
      metaDiv.appendChild(copyButton);
    }
    
    // Delete button
    if (CONFIG.ENABLE_DELETE_MESSAGE) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'message-action-btn';
      deleteButton.textContent = '🗑️';
      deleteButton.title = 'Delete';
      deleteButton.onclick = () => this.deleteMessage(index);
      metaDiv.appendChild(deleteButton);
    }
    
    messageDiv.appendChild(metaDiv);
    
    return messageDiv;
  }
  
  /**
   * Format message with markdown parsing
   * @param {string} text - Message text
   * @returns {string} Formatted HTML
   */
  formatMessageWithMarkdown(text) {
    if (!text) return '';
    
    let html = text;
    let inCodeBlock = false;
    const lines = html.split('\n');
    const processedLines = [];
    let codeBlockContent = '';
    let codeBlockLang = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Handle code blocks (``` ... ```)
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.trim().substring(3).trim() || 'javascript';
          codeBlockContent = '';
        } else {
          inCodeBlock = false;
          // Close code block
          const highlightedCode = this.highlightCode(codeBlockContent, codeBlockLang);
          processedLines.push(
            `<pre class="code-block"><code class="language-${codeBlockLang}">${highlightedCode}</code></pre>`
          );
          codeBlockContent = '';
        }
        continue;
      }
      
      if (inCodeBlock) {
        codeBlockContent += line + '\n';
      } else {
        // Process regular lines
        let processedLine = line;
        
        // Headers (###, ##, #)
        processedLine = processedLine.replace(/^### (.*?)$/gm, '<h3>$1</h3>');
        processedLine = processedLine.replace(/^## (.*?)$/gm, '<h2>$1</h2>');
        processedLine = processedLine.replace(/^# (.*?)$/gm, '<h1>$1</h1>');
        
        // Bold
        processedLine = processedLine.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        processedLine = processedLine.replace(/__(.+?)__/g, '<strong>$1</strong>');
        
        // Italic
        processedLine = processedLine.replace(/\*(.*?)\*/g, '<em>$1</em>');
        processedLine = processedLine.replace(/_(.+?)_/g, '<em>$1</em>');
        
        // Inline code
        processedLine = processedLine.replace(/`(.*?)`/g, '<code class="inline-code">$1</code>');
        
        // Links
        processedLine = processedLine.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        
        // Blockquote
        if (processedLine.trim().startsWith('>')) {
          processedLine = processedLine.replace(/^> ?(.*?)$/gm, '<blockquote>$1</blockquote>');
        }
        
        // List items (- or *)
        if (processedLine.trim().startsWith('- ') || processedLine.trim().startsWith('* ')) {
          processedLine = processedLine.replace(/^[\-\*] (.*?)$/gm, '<li>$1</li>');
        }
        
        if (processedLine.trim()) {
          // Wrap lists in <ul>
          if (processedLine.includes('<li>')) {
            processedLine = `<ul>${processedLine}</ul>`;
          } else if (!processedLine.includes('<h') && !processedLine.includes('<blockquote>')) {
            // Wrap regular text in <p> if not already a tag
            processedLine = `<p>${processedLine}</p>`;
          }
        }
        
        processedLines.push(processedLine);
      }
    }
    
    // Handle unclosed code block
    if (inCodeBlock && codeBlockContent) {
      const highlightedCode = this.highlightCode(codeBlockContent, codeBlockLang);
      processedLines.push(
        `<pre class="code-block"><code class="language-${codeBlockLang}">${highlightedCode}</code></pre>`
      );
    }
    
    html = processedLines.join('\n');
    html = html.replace(/<\/ul>\n<ul>/g, '\n');
    
    return html;
  }

  /**
   * Highlight code syntax
   * @param {string} code - Code content
   * @param {string} lang - Language
   * @returns {string} Highlighted HTML
   */
  highlightCode(code, lang = 'javascript') {
    code = code.trim();
    
    if (lang === 'javascript' || lang === 'js') {
      code = code.replace(/\b(function|const|let|var|return|if|else|for|while|import|export|class|async|await|new)\b/g, '<span class="keyword">$1</span>');
      code = code.replace(/'([^']*)'/g, '<span class="string">\'$1\'</span>');
      code = code.replace(/"([^"]*)"/g, '<span class="string">"$1"</span>');
      code = code.replace(/`([^`]*)`/g, '<span class="string">`$1`</span>');
      code = code.replace(/\/\/(.*?)$/gm, '<span class="comment">//$1</span>');
      code = code.replace(/\b(\d+)\b/g, '<span class="number">$1</span>');
    }
    
    return code;
  }
  
  /**
   * Format message text (convert markdown to HTML)
   * @param {string} text - Message text
   * @returns {string} Formatted HTML
   */
  formatMessageText(text) {
    if (!text) return '';
    
    // Bold
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Code
    text = text.replace(/`(.*?)`/g, '<code>$1</code>');
    
    // Links
    text = text.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Line breaks
    text = text.replace(/\n/g, '<br>');
    
    return text;
  }
  
  /**
   * Format timestamp
   * @param {number} timestamp - Unix timestamp
   * @returns {string} Formatted time
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    
    return date.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  /**
   * Render all messages
   * @param {Array} messages - Array of messages
   */
  renderMessages(messages) {
    if (!this.isInitialized) {
      console.error('[UIManager] Not initialized');
      return;
    }
    
    this.messagesContainer.innerHTML = '';
    
    messages.forEach((message, index) => {
      const messageElement = this.renderMessage(message, index);
      this.messagesContainer.appendChild(messageElement);
    });
    
    this.scrollToBottom();
  }
  
  /**
   * Add a single message to the UI
   * @param {Object} message - Message object
   */
  addMessage(message) {
    console.log('[UIManager] addMessage called', {
      type: message.type,
      contentPreview: message.content?.substring(0, 30),
      isInitialized: this.isInitialized,
      containerChildren: this.messagesContainer?.children?.length || 0
    });

    if (!this.isInitialized) {
      console.error('[UIManager] Not initialized');
      return;
    }
    
    const index = this.messagesContainer.children.length;
    console.log('[UIManager] Creating message element at index:', index);
    
    const messageElement = this.renderMessage(message, index);
    
    console.log('[UIManager] Message element created, appending to DOM');
    this.messagesContainer.appendChild(messageElement);
    
    console.log('[UIManager] Message appended to DOM, scrolling to bottom');
    this.scrollToBottom();
    
    console.log('[UIManager] Message added and rendered successfully', {
      totalChildren: this.messagesContainer.children.length
    });
  }
  
  /**
   * Remove a message from the UI
   * @param {number} index - Message index
   */
  removeMessage(index) {
    if (!this.isInitialized) {
      console.error('[UIManager] Not initialized');
      return;
    }
    
    const messageElement = this.messagesContainer.children[index];
    if (messageElement) {
      messageElement.remove();
    }
  }
  
  /**
   * Clear all messages from UI
   */
  clearMessages() {
    if (!this.isInitialized) {
      console.error('[UIManager] Not initialized');
      return;
    }
    
    this.messagesContainer.innerHTML = '';
  }
  
  /**
   * Show loading indicator
   */
  showLoading() {
    if (this.loader) {
      this.loader.classList.remove('hidden');
    }
    
    this.messageInput.disabled = true;
    this.sendButton.disabled = true;
  }
  
  /**
   * Hide loading indicator
   */
  hideLoading() {
    if (this.loader) {
      this.loader.classList.add('hidden');
    }
    
    this.messageInput.disabled = false;
    this.sendButton.disabled = false;
    this.messageInput.focus();
  }
  
  /**
   * Scroll to bottom of chat
   */
  scrollToBottom() {
    if (!this.messagesContainer) return;
    
    this.messagesContainer.scrollTo({
      top: this.messagesContainer.scrollHeight,
      behavior: 'smooth'
    });
  }
  
  /**
   * Update character count
   * @param {number} count - Current character count
   */
  updateCharCount(count) {
    if (this.charCount) {
      this.charCount.textContent = count;
      
      // Warn if approaching limit
      if (count > CONFIG.INPUT_MAX_LENGTH * 0.9) {
        this.charCount.classList.add('warning');
      } else {
        this.charCount.classList.remove('warning');
      }
    }
  }
  
  /**
   * Clear input field
   */
  clearInput() {
    if (this.messageInput) {
      this.messageInput.value = '';
      this.updateCharCount(0);
    }
  }
  
  /**
   * Get input value
   * @returns {string} Input text
   */
  getInputValue() {
    return this.messageInput ? this.messageInput.value.trim() : '';
  }
  
  /**
   * Set input value
   * @param {string} value - Text to set
   */
  setInputValue(value) {
    if (this.messageInput) {
      this.messageInput.value = value;
      this.updateCharCount(value.length);
    }
  }
  
  /**
   * Focus input field
   */
  focusInput() {
    if (this.messageInput) {
      this.messageInput.focus();
    }
  }
  
  /**
   * Enable input field
   */
  enableInput() {
    if (this.messageInput) {
      this.messageInput.disabled = false;
    }
    if (this.sendButton) {
      this.sendButton.disabled = false;
    }
  }
  
  /**
   * Disable input field
   */
  disableInput() {
    if (this.messageInput) {
      this.messageInput.disabled = true;
    }
    if (this.sendButton) {
      this.sendButton.disabled = true;
    }
  }
  
  /**
   * Copy message to clipboard
   * @param {string} text - Text to copy
   */
  async copyMessage(text) {
    try {
      // Remove HTML tags for clipboard
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = text;
      const plainText = tempDiv.textContent || tempDiv.innerText || '';
      
      await navigator.clipboard.writeText(plainText);
      
      // Show feedback
      this.showToast('Copied to clipboard!');
    } catch (error) {
      console.error('[UIManager] Error copying:', error);
      this.showToast('Failed to copy', 'error');
    }
  }
  
  /**
   * Show toast notification
   * @param {string} message - Toast message
   * @param {string} type - Toast type (success, error, info)
   */
  showToast(message, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // Add to document
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
  
  /**
   * Delete message
   * @param {number} index - Message index
   */
  deleteMessage(index) {
    // This will be handled by the app
    if (window.chatApp && window.chatApp.deleteMessage) {
      window.chatApp.deleteMessage(index);
    }
  }
  
  /**
   * Get element by ID
   * @param {string} id - Element ID
   * @returns {HTMLElement|null} Element
   */
  getElement(id) {
    return document.getElementById(id);
  }
  
  /**
   * Add event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   */
  on(event, handler) {
    if (event === 'send' && this.sendButton) {
      this.sendButton.addEventListener('click', handler);
    }
    
    if (event === 'enter' && this.messageInput) {
      this.messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          handler(e);
        }
      });
    }
    
    if (event === 'input' && this.messageInput) {
      this.messageInput.addEventListener('input', handler);
    }
    
    if (event === 'clear' && this.clearButton) {
      this.clearButton.addEventListener('click', handler);
    }
  }
}

// Singleton instance
export const uiManager = new UIManager();

export default uiManager;
