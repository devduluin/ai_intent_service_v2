// ============================================================
// Typing Indicator - AI Thinking Animation
// ============================================================
// Shows animated dots while AI is processing
// ============================================================

/**
 * Typing Indicator Class
 * Manages the "AI is thinking" animation
 */
export class TypingIndicator {
  
  constructor(containerSelector = '.messages-container') {
    this.container = document.querySelector(containerSelector);
    this.element = null;
    this.isVisible = false;
  }
  
  /**
   * Show typing indicator
   */
  show() {
    if (this.isVisible) {
      return;
    }
    
    // Create typing indicator element
    this.element = document.createElement('div');
    this.element.className = 'message message-ai typing-indicator';
    this.element.id = 'typingIndicator';
    
    this.element.innerHTML = `
      <div class="message-content">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
      <div class="message-meta">
        <span class="message-time">AI sedang mengetik...</span>
      </div>
    `;
    
    // Add to container
    if (this.container) {
      this.container.appendChild(this.element);
      this.scrollToBottom();
    }
    
    this.isVisible = true;
  }
  
  /**
   * Hide typing indicator
   */
  hide() {
    if (!this.isVisible || !this.element) {
      return;
    }
    
    // Remove from container
    if (this.container && this.element.parentNode === this.container) {
      this.container.removeChild(this.element);
    }
    
    this.element = null;
    this.isVisible = false;
  }
  
  /**
   * Scroll to bottom when indicator shown
   */
  scrollToBottom() {
    if (this.container) {
      this.container.scrollTo({
        top: this.container.scrollHeight,
        behavior: 'smooth'
      });
    }
  }
  
  /**
   * Update typing status text
   * @param {string} text - Status text
   */
  updateStatus(text) {
    const statusElement = this.element?.querySelector('.message-time');
    if (statusElement) {
      statusElement.textContent = text;
    }
  }
}

// Singleton instance
export const typingIndicator = new TypingIndicator();

export default typingIndicator;
