// ============================================================
// Chat UI Configuration
// ============================================================
// API endpoints and app settings
// ============================================================

export const CONFIG = {
  // API Configuration
  API_BASE_URL: 'http://localhost:3000',  // Change to your backend URL
  API_VERSION: 'v1',
  API_ENDPOINT: '/api/v1/chat',
  WS_ENDPOINT: '/api/v1/chat-ws',  // WebSocket endpoint
  
  // App Configuration
  APP_NAME: 'hris',  // Default app name
  DEFAULT_USER_ID: 'user_' + Math.random().toString(36).substr(2, 9),
  
  // Chat Configuration
  MAX_CHAT_HISTORY: 6,  // Maximum messages to keep in UI
  MAX_HISTORY_CHARS: 500,  // Maximum characters per message in history
  INPUT_MAX_LENGTH: 1000,  // Maximum input length
  
  // Timeout Configuration
  API_TIMEOUT: 30000,  // 30 seconds
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY: 1000,  // 1 second
  
  // UI Configuration
  SCROLL_ANIMATION_DURATION: 300,  // ms
  LOADING_MESSAGE: 'AI sedang berpikir...',
  ERROR_MESSAGE: 'Maaf, terjadi kesalahan. Silakan coba lagi.',
  TIMEOUT_MESSAGE: 'Request timeout. Silakan coba lagi.',
  
  // Storage Configuration
  STORAGE_KEY_PREFIX: 'ai_chat_',
  STORAGE_MESSAGES_KEY: 'messages',
  STORAGE_USER_ID_KEY: 'user_id',
  STORAGE_APP_NAME_KEY: 'app_name',
  
  // WebSocket Configuration
  ENABLE_WEBSOCKET: true,  // Set to true to use WebSocket
  WS_URL: null,  // Auto-generated from API_BASE_URL if null
  WS_PING_INTERVAL: 30000,  // 30 seconds
  WS_MAX_RECONNECT_ATTEMPTS: 5,
  WS_RECONNECT_DELAY: 3000,  // 3 seconds (with exponential backoff)
  
  // Feature Flags
  ENABLE_VOICE_INPUT: false,  // Set to true if voice input is available
  ENABLE_COPY_MESSAGE: true,
  ENABLE_DELETE_MESSAGE: true,
  ENABLE_CLEAR_CHAT: true,
};

// Generate unique user ID if not exists
export function getUserId() {
  let userId = localStorage.getItem(CONFIG.STORAGE_KEY_PREFIX + CONFIG.STORAGE_USER_ID_KEY);
  if (!userId) {
    userId = CONFIG.DEFAULT_USER_ID;
    localStorage.setItem(CONFIG.STORAGE_KEY_PREFIX + CONFIG.STORAGE_USER_ID_KEY, userId);
  }
  return userId;
}

// Get app name
export function getAppName() {
  return localStorage.getItem(CONFIG.STORAGE_KEY_PREFIX + CONFIG.STORAGE_APP_NAME_KEY) || CONFIG.APP_NAME;
}

// Set app name
export function setAppName(appName) {
  localStorage.setItem(CONFIG.STORAGE_KEY_PREFIX + CONFIG.STORAGE_APP_NAME_KEY, appName);
}

// Get API endpoint URL
export function getApiUrl() {
  return `${CONFIG.API_BASE_URL}${CONFIG.API_ENDPOINT}`;
}

// Get storage key for messages
export function getMessagesStorageKey() {
  return `${CONFIG.STORAGE_KEY_PREFIX}${CONFIG.STORAGE_MESSAGES_KEY}_${getAppName()}`;
}

export default CONFIG;
