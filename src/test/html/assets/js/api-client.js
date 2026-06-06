// ============================================================
// API Client - HTTP Communication
// ============================================================
// Handles all API requests to the backend
// ============================================================

import { CONFIG, getApiUrl, getUserId, getAppName } from './config.js';

/**
 * API Client Class
 * Manages HTTP communication with the backend
 */
export class ApiClient {
  
  constructor() {
    this.baseUrl = getApiUrl();
    this.timeout = CONFIG.API_TIMEOUT;
  }
  
  /**
   * Send chat message to API
   * @param {string} message - User message
   * @param {Array} chatHistory - Previous messages
   * @returns {Promise<Object>} API response
   */
  async sendChatMessage(message, chatHistory = []) {
    const payload = {
      user_id: getUserId(),
      app_name: getAppName(),
      text: message,
      chat_history: chatHistory,
      language: 'id',
      attributes: {
        name: "John Doe",  // ✅ Example attribute
        params: {
          company_id: "79483b71-25c2-11f0-8c42-d28e58827589",  // ✅ Example param
        }
      }  // ✅ Add attributes
    };

    console.log('[ApiClient] Sending request:', payload);  // ✅ Log payload with attributes

    try {
      const response = await this.post('/api/v1/chat', payload);
      console.log('[ApiClient] Response:', response);
      return response;
    } catch (error) {
      console.error('[ApiClient] Error:', error);
      throw error;
    }
  }
  
  /**
   * Make HTTP POST request
   * @param {string} endpoint - API endpoint
   * @param {Object} data - Request data
   * @returns {Promise<Object>} Response data
   */
  async post(endpoint, data) {
    const url = `${CONFIG.API_BASE_URL}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const responseData = await response.json();
      
      // Handle API errors
      if (!responseData.success && responseData.error) {
        throw new Error(responseData.error || responseData.message || 'API error');
      }
      
      return responseData;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(CONFIG.TIMEOUT_MESSAGE);
      }
      
      throw error;
    }
  }
  
  /**
   * Make HTTP GET request
   * @param {string} endpoint - API endpoint
   * @returns {Promise<Object>} Response data
   */
  async get(endpoint) {
    const url = `${CONFIG.API_BASE_URL}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(CONFIG.TIMEOUT_MESSAGE);
      }
      
      throw error;
    }
  }
  
  /**
   * Send request with retry logic
   * @param {Function} requestFn - Request function
   * @param {number} retries - Number of retry attempts
   * @returns {Promise<Object>} Response data
   */
  async sendWithRetry(requestFn, retries = CONFIG.RETRY_ATTEMPTS) {
    let lastError;
    
    for (let i = 0; i <= retries; i++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        console.warn(`[ApiClient] Attempt ${i + 1} failed:`, error.message);
        
        if (i < retries) {
          await this.delay(CONFIG.RETRY_DELAY * (i + 1));
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * Delay execution
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Check API health
   * @returns {Promise<boolean>} Is API healthy
   */
  async healthCheck() {
    try {
      const response = await this.get('/api/v1/health');
      return response.success || false;
    } catch (error) {
      console.error('[ApiClient] Health check failed:', error);
      return false;
    }
  }
  
  /**
   * Update API base URL
   * @param {string} url - New base URL
   */
  setBaseUrl(url) {
    this.baseUrl = url;
    CONFIG.API_BASE_URL = url;
    console.log('[ApiClient] Base URL updated:', url);
  }
  
  /**
   * Update request timeout
   * @param {number} timeout - Timeout in milliseconds
   */
  setTimeout(timeout) {
    this.timeout = timeout;
    CONFIG.API_TIMEOUT = timeout;
    console.log('[ApiClient] Timeout updated:', timeout + 'ms');
  }
}

// Singleton instance
export const apiClient = new ApiClient();

export default apiClient;
