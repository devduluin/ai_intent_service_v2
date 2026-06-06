// ============================================================
// Chat WebSocket Service
// ============================================================
// Manages WebSocket connections and message routing
// ============================================================

import { WebSocket } from 'ws';
import { appLogger } from '../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface WSConnection {
  clientId: string;
  socket: WebSocket;
  isConnected: boolean;
  lastActivity: number;
  messageQueue: WSMessage[];
  userId?: string;
  appName?: string;
  attributes?: Record<string, any>;
  modeStateReplayed?: boolean;
}

export interface WSMessage {
  type: WS_MESSAGE_TYPE;
  [key: string]: any;
}

export enum WS_MESSAGE_TYPE {
  // Connection
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  
  // Chat
  SESSION_INIT = 'session_init',
  CHAT = 'chat',
  RESPONSE = 'response',
  TYPING = 'typing',
  
  // Notifications
  NOTIFICATION = 'notification',
  
  // Keep-alive
  PING = 'ping',
  PONG = 'pong',
  
  // Control
  ERROR = 'error',
  RECONNECT = 'reconnect'
}

// ============================================================
// Chat WebSocket Service
// ============================================================

class ChatWsService {
  private connections: Map<string, WSConnection> = new Map();
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> clientIds
  private readonly MAX_QUEUE_SIZE = 100;
  private readonly CONNECTION_TIMEOUT = 300000; // 5 minutes

  /**
   * Add a new WebSocket connection
   */
  addConnection(connection: WSConnection): void {
    this.connections.set(connection.clientId, connection);
    
    // Track by userId if available
    if (connection.userId) {
      if (!this.userConnections.has(connection.userId)) {
        this.userConnections.set(connection.userId, new Set());
      }
      this.userConnections.get(connection.userId)!.add(connection.clientId);
    }

    appLogger.info('[ChatWsService] Connection added', {
      clientId: connection.clientId,
      totalConnections: this.connections.size
    });
  }

  /**
   * Remove a WebSocket connection
   */
  removeConnection(clientId: string): void {
    const connection = this.connections.get(clientId);
    
    if (connection) {
      // Remove from user connections
      if (connection.userId) {
        const userConns = this.userConnections.get(connection.userId);
        if (userConns) {
          userConns.delete(clientId);
          if (userConns.size === 0) {
            this.userConnections.delete(connection.userId);
          }
        }
      }

      // Queue messages for reconnecting clients
      if (connection.messageQueue.length > 0) {
        appLogger.info('[ChatWsService] Messages queued for client', {
          clientId,
          queueSize: connection.messageQueue.length
        });
      }

      this.connections.delete(clientId);
      
      appLogger.info('[ChatWsService] Connection removed', {
        clientId,
        totalConnections: this.connections.size
      });
    }
  }

  /**
   * Get connection by client ID
   */
  getConnection(clientId: string): WSConnection | undefined {
    return this.connections.get(clientId);
  }

  /**
   * Get all connections for a user
   */
  getConnectionsByUserId(userId: string): WSConnection[] {
    const clientIds = this.userConnections.get(userId);
    if (!clientIds) return [];

    const connections: WSConnection[] = [];
    clientIds.forEach(id => {
      const conn = this.connections.get(id);
      if (conn && conn.isConnected) {
        connections.push(conn);
      }
    });

    return connections;
  }

  /**
   * Get all active connections
   */
  getAllConnections(): WSConnection[] {
    const active: WSConnection[] = [];
    this.connections.forEach(conn => {
      if (conn.isConnected) {
        active.push(conn);
      }
    });
    return active;
  }

  /**
   * Queue message for client
   */
  queueMessage(clientId: string, message: WSMessage): void {
    const connection = this.connections.get(clientId);
    
    if (connection) {
      // Limit queue size
      if (connection.messageQueue.length >= this.MAX_QUEUE_SIZE) {
        connection.messageQueue.shift(); // Remove oldest
      }
      
      connection.messageQueue.push(message);
      
      appLogger.debug('[ChatWsService] Message queued', {
        clientId,
        queueSize: connection.messageQueue.length
      });
    }
  }

  /**
   * Deliver queued messages to client
   */
  async deliverQueuedMessages(clientId: string): Promise<void> {
    const connection = this.connections.get(clientId);
    
    if (!connection || connection.messageQueue.length === 0) {
      return;
    }

    appLogger.info('[ChatWsService] Delivering queued messages', {
      clientId,
      queueSize: connection.messageQueue.length
    });

    // Send messages with small delay to avoid flooding
    for (const message of connection.messageQueue) {
      if (connection.isConnected && connection.socket.readyState === WebSocket.OPEN) {
        connection.socket.send(JSON.stringify(message));
        await this.delay(50); // 50ms delay between messages
      }
    }

    // Clear queue
    connection.messageQueue = [];
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: WSMessage): boolean {
    const connection = this.connections.get(clientId);
    
    if (!connection || !connection.isConnected) {
      appLogger.warn('[ChatWsService] Cannot send to client', {
        clientId,
        reason: connection ? 'not connected' : 'not found'
      });
      return false;
    }

    if (connection.socket.readyState === WebSocket.OPEN) {
      connection.socket.send(JSON.stringify(message));
      return true;
    }

    // Queue for later
    this.queueMessage(clientId, message);
    return false;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: WSMessage, excludeClientId?: string): void {
    this.connections.forEach((conn, clientId) => {
      if (clientId !== excludeClientId && conn.isConnected) {
        this.sendToClient(clientId, message);
      }
    });
  }

  /**
   * Update connection's userId (called when user sends first message)
   */
  updateConnectionUserId(clientId: string, userId: string, appName: string): void {
    const connection = this.connections.get(clientId);
    
    if (connection) {
      // Remove from old user connections if exists
      if (connection.userId) {
        const oldUserConns = this.userConnections.get(connection.userId);
        if (oldUserConns) {
          oldUserConns.delete(clientId);
          if (oldUserConns.size === 0) {
            this.userConnections.delete(connection.userId);
          }
        }
      }
      
      // Set new userId and appName
      connection.userId = userId;
      connection.appName = appName;
      
      // Add to new user connections
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(clientId);
      
      appLogger.debug('[ChatWsService] Connection userId updated', {
        clientId,
        userId,
        appName
      });
    }
  }

  /**
   * Broadcast to user's all connections
   * @returns Number of connections that received the message
   */
  broadcastToUser(userId: string, message: WSMessage, excludeClientId?: string): { connectionsFound: number } {
    const connections = this.getConnectionsByUserId(userId);
    let sentCount = 0;
    
    connections.forEach(conn => {
      if (conn.clientId !== excludeClientId) {
        const success = this.sendToClient(conn.clientId, message);
        if (success) {
          sentCount++;
        }
      }
    });
    
    return { connectionsFound: sentCount };
  }

  /**
   * Cleanup inactive connections
   */
  cleanupInactiveConnections(): void {
    const now = Date.now();
    let cleaned = 0;

    this.connections.forEach((conn, clientId) => {
      const inactiveTime = now - conn.lastActivity;
      
      if (inactiveTime > this.CONNECTION_TIMEOUT) {
        appLogger.info('[ChatWsService] Cleaning up inactive connection', {
          clientId,
          inactiveTime
        });
        
        conn.socket.close();
        this.removeConnection(clientId);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      appLogger.info('[ChatWsService] Cleanup completed', {
        cleanedConnections: cleaned,
        remainingConnections: this.connections.size
      });
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalConnections: number;
    activeConnections: number;
    uniqueUsers: number;
    totalQueuedMessages: number;
  } {
    let totalQueued = 0;
    this.connections.forEach(conn => {
      totalQueued += conn.messageQueue.length;
    });

    return {
      totalConnections: this.connections.size,
      activeConnections: this.getAllConnections().length,
      uniqueUsers: this.userConnections.size,
      totalQueuedMessages: totalQueued
    };
  }

  /**
   * Start periodic cleanup
   */
  startCleanupInterval(intervalMs: number = 60000): void {
    setInterval(() => {
      this.cleanupInactiveConnections();
    }, intervalMs);

    appLogger.info('[ChatWsService] Cleanup interval started', {
      intervalMs
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const chatWsService = new ChatWsService();

export default chatWsService;
