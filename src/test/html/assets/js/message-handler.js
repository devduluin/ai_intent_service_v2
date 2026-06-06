// ============================================================
// Message Handler - Message Processing
// ============================================================
// Handles message creation, formatting, and processing
// ============================================================

import { CONFIG } from './config.js';

/**
 * Message types
 */
export const MessageType = {
  USER: 'user',
  AI: 'ai',
  SYSTEM: 'system',
  ERROR: 'error'
};

/**
 * Message Handler Class
 * Manages message creation and processing
 */
export class MessageHandler {
  
  /**
   * Create a user message
   * @param {string} text - Message text
   * @returns {Object} Message object
   */
  createUserMessage(text) {
    return {
      id: this.generateMessageId(),
      type: MessageType.USER,
      text: text.trim(),
      timestamp: Date.now(),
      status: 'sent'
    };
  }
  
  /**
   * Create an AI response message
   * @param {string} text - Message text
   * @param {Object} metadata - Additional metadata (intent, confidence, etc.)
   * @returns {Object} Message object
   */
  createAiMessage(text, metadata = {}) {
    return {
      id: this.generateMessageId(),
      type: MessageType.AI,
      text: text.trim(),
      timestamp: Date.now(),
      status: 'received',
      metadata: {
        intent: metadata.intent || 'unknown',
        confidence: metadata.confidence || 0,
        responseTime: metadata.responseTime || 0
      }
    };
  }
  
  /**
   * Create a system message
   * @param {string} text - Message text
   * @returns {Object} Message object
   */
  createSystemMessage(text) {
    return {
      id: this.generateMessageId(),
      type: MessageType.SYSTEM,
      text: text,
      timestamp: Date.now(),
      status: 'system'
    };
  }
  
  /**
   * Create an error message
   * @param {string} text - Error message
   * @param {Object} error - Original error object
   * @returns {Object} Message object
   */
  createErrorMessage(text, error = null) {
    return {
      id: this.generateMessageId(),
      type: MessageType.ERROR,
      text: text,
      timestamp: Date.now(),
      status: 'error',
      error: error ? {
        message: error.message,
        name: error.name
      } : null
    };
  }
  
  /**
   * Create a loading message
   * @returns {Object} Message object
   */
  createLoadingMessage() {
    return {
      id: this.generateMessageId(),
      type: MessageType.SYSTEM,
      text: CONFIG.LOADING_MESSAGE,
      timestamp: Date.now(),
      status: 'loading'
    };
  }
  
  /**
   * Format message for display with proper markdown parsing
   * @param {Object} message - Message object
   * @returns {string} Formatted HTML
   */
  formatMessage(message) {
    if (!message || !message.text) {
      return '';
    }
    
    let text = message.text;
    
    // Convert markdown syntax to HTML (order matters!)
    text = this.parseMarkdown(text);
    
    return text;
  }

  /**
   * Parse markdown to HTML
   * Handles: headers, bold, italic, code blocks, inline code, tables, lists, blockquotes, links
   * @param {string} text - Markdown text
   * @returns {string} HTML text
   */
  parseMarkdown(text) {
    let html = this.escapeHtml(text);
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
        const tableEndIndex = this.findMarkdownTableEnd(lines, i);

        if (tableEndIndex !== -1) {
          processedLines.push(this.renderMarkdownTable(lines.slice(i, tableEndIndex + 1)));
          i = tableEndIndex;
          continue;
        }

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
    
    // Clean up multiple <ul> tags
    html = html.replace(/<\/ul>\n<ul>/g, '\n');
    
    return html;
  }

  /**
   * Escape raw HTML before applying the small markdown parser.
   * @param {string} text - Raw message text
   * @returns {string} Escaped text
   */
  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Find the end of a markdown table that starts at the current line.
   * Tolerates blank lines between table rows, which often appears in AI output.
   * @param {string[]} lines - Message lines
   * @param {number} startIndex - Candidate table header index
   * @returns {number} Last table line index, or -1 when no table starts here
   */
  findMarkdownTableEnd(lines, startIndex) {
    if (!this.isMarkdownTableRow(lines[startIndex])) {
      return -1;
    }

    const separatorIndex = this.findNextNonEmptyLine(lines, startIndex + 1);
    if (separatorIndex === -1 || !this.isMarkdownTableSeparator(lines[separatorIndex])) {
      return -1;
    }

    let endIndex = separatorIndex;
    for (let i = separatorIndex + 1; i < lines.length; i++) {
      const line = lines[i];

      if (!line.trim()) {
        const nextIndex = this.findNextNonEmptyLine(lines, i + 1);
        if (nextIndex !== -1 && this.isMarkdownTableRow(lines[nextIndex])) {
          continue;
        }
        break;
      }

      if (!this.isMarkdownTableRow(line)) {
        break;
      }

      endIndex = i;
    }

    return endIndex;
  }

  /**
   * Find next non-empty line index.
   * @param {string[]} lines - Message lines
   * @param {number} startIndex - Search start index
   * @returns {number} Line index, or -1
   */
  findNextNonEmptyLine(lines, startIndex) {
    for (let i = startIndex; i < lines.length; i++) {
      if (lines[i].trim()) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Detect a markdown table row.
   * @param {string} line - Candidate line
   * @returns {boolean} True if line looks like a table row
   */
  isMarkdownTableRow(line) {
    const trimmed = line.trim();
    return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 4;
  }

  /**
   * Detect a markdown table separator row.
   * @param {string} line - Candidate line
   * @returns {boolean} True if line is a table separator
   */
  isMarkdownTableSeparator(line) {
    if (!this.isMarkdownTableRow(line)) {
      return false;
    }

    return this.parseMarkdownTableCells(line).every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
  }

  /**
   * Parse cells from a markdown table row.
   * @param {string} line - Table row line
   * @returns {string[]} Cells
   */
  parseMarkdownTableCells(line) {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
  }

  /**
   * Render markdown table lines to HTML.
   * @param {string[]} lines - Table block lines
   * @returns {string} Table HTML
   */
  renderMarkdownTable(lines) {
    const tableRows = lines.filter((line) => this.isMarkdownTableRow(line));
    const headerCells = this.parseMarkdownTableCells(tableRows[0]);
    const separatorCells = this.parseMarkdownTableCells(tableRows[1]);
    const bodyRows = tableRows.slice(2);
    const alignments = separatorCells.map((cell) => this.getMarkdownTableAlignment(cell));

    const headerHtml = headerCells
      .map((cell, index) => `<th${this.renderAlignmentAttribute(alignments[index])}>${this.parseInlineMarkdown(cell)}</th>`)
      .join('');

    const bodyHtml = bodyRows
      .map((row) => {
        const cells = this.parseMarkdownTableCells(row);
        const columnCount = Math.max(headerCells.length, cells.length);
        const renderedCells = [];

        for (let i = 0; i < columnCount; i++) {
          renderedCells.push(
            `<td${this.renderAlignmentAttribute(alignments[i])}>${this.parseInlineMarkdown(cells[i] || '')}</td>`
          );
        }

        return `<tr>${renderedCells.join('')}</tr>`;
      })
      .join('');

    return `<div class="table-wrapper"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  }

  /**
   * Resolve markdown table alignment from separator syntax.
   * @param {string} separatorCell - Separator cell
   * @returns {string} Alignment name
   */
  getMarkdownTableAlignment(separatorCell) {
    const trimmed = separatorCell.trim();

    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    if (trimmed.startsWith(':')) return 'left';

    return '';
  }

  /**
   * Render safe alignment attribute.
   * @param {string} alignment - Alignment name
   * @returns {string} HTML attribute
   */
  renderAlignmentAttribute(alignment) {
    return alignment ? ` style="text-align: ${alignment}"` : '';
  }

  /**
   * Parse inline markdown used inside paragraphs and table cells.
   * @param {string} text - Inline markdown
   * @returns {string} HTML
   */
  parseInlineMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/__(.+?)__/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code class="inline-code">$1</code>')
      .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  /**
   * Simple syntax highlighting for code blocks
   * @param {string} code - Code content
   * @param {string} lang - Language (javascript, python, etc)
   * @returns {string} Highlighted HTML
   */
  highlightCode(code, lang = 'javascript') {
    // Remove trailing newline
    code = code.trim();
    
    // Basic syntax highlighting for JavaScript
    if (lang === 'javascript' || lang === 'js') {
      // Keywords
      code = code.replace(
        /\b(function|const|let|var|return|if|else|for|while|import|export|class|async|await|new)\b/g,
        '<span class="keyword">$1</span>'
      );
      
      // Strings
      code = code.replace(/'([^']*)'/g, '<span class="string">\'$1\'</span>');
      code = code.replace(/"([^"]*)"/g, '<span class="string">"$1"</span>');
      code = code.replace(/`([^`]*)`/g, '<span class="string">`$1`</span>');
      
      // Comments
      code = code.replace(/\/\/(.*?)$/gm, '<span class="comment">//$1</span>');
      
      // Numbers
      code = code.replace(/\b(\d+)\b/g, '<span class="number">$1</span>');
    }
    
    return code;
  }
  /**
   * Truncate message for preview
   * @param {string} text - Message text
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  truncateMessage(text, maxLength = 100) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    
    return text.substring(0, maxLength) + '...';
  }
  
  /**
   * Format timestamp for display
   * @param {number} timestamp - Unix timestamp
   * @returns {string} Formatted time
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) {
      return 'Just now';
    }
    
    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    
    // Less than 24 hours
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    
    // More than 24 hours - show date
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
  
  /**
   * Generate unique message ID
   * @returns {string} Unique ID
   */
  generateMessageId() {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
  
  /**
   * Validate message
   * @param {Object} message - Message object
   * @returns {boolean} Is valid
   */
  isValidMessage(message) {
    if (!message) return false;
    if (!message.id) return false;
    if (!message.type) return false;
    if (!message.text && message.type !== MessageType.SYSTEM) return false;
    if (!message.timestamp) return false;
    
    return true;
  }
  
  /**
   * Copy message to clipboard
   * @param {string} text - Text to copy
   * @returns {Promise<boolean>} Success status
   */
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('[MessageHandler] Error copying to clipboard:', error);
      
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      
      return true;
    }
  }
  
  /**
   * Build chat history for API request
   * Orders messages from oldest to newest (natural conversation flow)
   * @param {Array} messages - Array of messages
   * @returns {Array} Formatted chat history ordered by timestamp (oldest first)
   */
  buildChatHistory(messages) {
    // Filter out non-conversation messages, get last N messages, sort by timestamp (oldest first)
    return messages
      .filter(m => m.type === MessageType.USER || m.type === MessageType.AI)
      .slice(-CONFIG.MAX_CHAT_HISTORY)
      .sort((a, b) => a.timestamp - b.timestamp) // Sort by timestamp: oldest first
      .map(m => ({
        role: m.type === MessageType.USER ? 'user' : 'assistant',
        content: m.text
      }));
  }
}

// Singleton instance
export const messageHandler = new MessageHandler();

export default messageHandler;
