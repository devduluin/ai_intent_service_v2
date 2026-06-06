// ============================================================
// Chat WebSocket Route
// ============================================================
// WebSocket endpoint for real-time chat communication
// ============================================================

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WebSocket } from 'ws';
import { chatWsService, WS_MESSAGE_TYPE, WSConnection } from '../services/chat-ws.service';
import { pipelineService } from '../services/pipeline.service';
import { appLogger } from '../utils/logger.util';
import { schedulerNotificationService } from '../services/automation/scheduler-notification.service';
import { godModeManagerService } from '../services/god-mode-manager.service';

// ============================================================
// Types
// ============================================================

interface WSChatRequest {
  user_id: string;
  app_name: string;
  text: string;
  chat_history?: Array<{ role: string; content: string }>;
  language?: string;
  attributes?: Record<string, any>;
}

interface WSSessionInitRequest {
  user_id: string;
  app_name: string;
  attributes?: Record<string, any>;
}

// ============================================================
// WebSocket Route Registration
// ============================================================

export async function chatWsRoute(fastify: FastifyInstance): Promise<void> {
  
  // WebSocket upgrade route
  fastify.get('/chat-ws', {
    websocket: true,
    config: {
      rateLimit: {
        max: 10,
        timeWindow: 1000 // 10 messages per second
      }
    }
  } as any, async (connection: any, req: any) => {
    const ws = connection as WebSocket;
    const clientId = generateClientId();

    appLogger.info('[ChatWS] Client connected', {
      clientId,
      ip: (req as any).ip,
      userAgent: (req as any).headers['user-agent']
    });

    // Create connection wrapper
    const wsConnection: WSConnection = {
      clientId,
      socket: ws,
      isConnected: true,
      lastActivity: Date.now(),
      messageQueue: [],
      attributes: {}

    };

    // Register connection
    chatWsService.addConnection(wsConnection);

    // Send welcome message
    sendMessage(ws, {
      type: WS_MESSAGE_TYPE.CONNECTED,
      clientId,
      timestamp: Date.now(),
      message: 'Connected to chat WebSocket'
    });

    // Handle incoming messages
    ws.on('message', async (message: any) => {
      try {
        const data = JSON.parse(message.toString());
        appLogger.debug('[ChatWS] Message received', {
          clientId,
          type: data.type
        });

        wsConnection.lastActivity = Date.now();

        // Route message by type
        switch (data.type) {
          case WS_MESSAGE_TYPE.SESSION_INIT:
            await handleSessionInit(wsConnection, data.payload as WSSessionInitRequest);
            break;

          case WS_MESSAGE_TYPE.CHAT:
            appLogger.info('[ChatWS] CHAT message received - about to handleChatMessage', {
              clientId,
              hasPayload: !!data.payload,
              payloadUserId: data.payload?.user_id,
              payloadAppName: data.payload?.app_name,
              payloadText: data.payload?.text?.substring(0, 30)
            });
            await handleChatMessage(wsConnection, data.payload as WSChatRequest);
            break;

          case WS_MESSAGE_TYPE.PING:
            // Client ping - respond with pong
            sendMessage(ws, {
              type: WS_MESSAGE_TYPE.PONG,
              timestamp: Date.now()
            });
            break;

          case WS_MESSAGE_TYPE.PONG:
            // Client pong (response to server ping) - just log for keep-alive tracking
            appLogger.debug('[ChatWS] Client pong received (keep-alive)', {
              clientId
            });
            break;

          case WS_MESSAGE_TYPE.TYPING:
            // Optional: Handle typing indicator
            broadcastTypingIndicator(wsConnection, data.payload);
            break;

          default:
            // Ignore unknown types silently (could be client implementation differences)
            appLogger.debug('[ChatWS] Unknown message type (ignored)', {
              clientId,
              type: data.type
            });
        }
      } catch (error) {
        appLogger.error('[ChatWS] Error processing message', {
          clientId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        sendMessage(ws, {
          type: WS_MESSAGE_TYPE.ERROR,
          error: 'Failed to process message',
          timestamp: Date.now()
        });
      }
    });

    // Handle connection close
    ws.on('close', () => {
      appLogger.info('[ChatWS] Client disconnected', { clientId });
      wsConnection.isConnected = false;
      chatWsService.removeConnection(clientId);
    });

    // Handle connection error
    ws.on('error', (error) => {
      appLogger.error('[ChatWS] Connection error', {
        clientId,
        error: error.message
      });
      wsConnection.isConnected = false;
      chatWsService.removeConnection(clientId);
    });

    // Send periodic ping for keep-alive
    const pingInterval = setInterval(() => {
      if (!wsConnection.isConnected) {
        clearInterval(pingInterval);
        return;
      }

      // Check if connection is alive
      const inactiveTime = Date.now() - wsConnection.lastActivity;
      if (inactiveTime > 60000) { // 1 minute inactive
        appLogger.warn('[ChatWS] Client inactive, closing', { clientId });
        ws.close();
        clearInterval(pingInterval);
        return;
      }

      // Send ping
      sendMessage(ws, {
        type: WS_MESSAGE_TYPE.PING,
        timestamp: Date.now()
      });
    }, 30000); // Every 30 seconds

    // Cleanup on close
    ws.on('close', () => {
      clearInterval(pingInterval);
    });
  });

  // HTTP fallback endpoint (same as regular chat)
  fastify.post('/chat', async (
    request: FastifyRequest<{ Body: WSChatRequest }>,
    reply: FastifyReply
  ) => {
    try {
      const { user_id, app_name, text, chat_history = [], language = 'id', attributes } = request.body;

      appLogger.info('[ChatWS] HTTP fallback request', {
        userId: user_id,
        appName: app_name,
        request: request.body
      });

      // Call pipeline service
      const result = await pipelineService.run({
        user_id,
        app_name,
        text,
        chat_history: chat_history as any[],
        language,
        attributes
      });

      reply.send({
        success: true,
        response: (result as any).response || result.naturalResponse,
        intent: result.intent,
        confidence: (result as any).confidence || 0,
        metadata: result.metadata
      });
    } catch (error) {
      appLogger.error('[ChatWS] HTTP fallback error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      reply.status(500).send({
        success: false,
        error: 'Failed to process chat request',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Send message through WebSocket
 */
function sendMessage(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      const jsonStr = JSON.stringify(message);
      ws.send(jsonStr);
      
      // Log messages for debugging
      const msgType = (message as any).type;
      if (msgType === 'response' && (message as any).metadata?.source === 'automation_scheduler') {
        appLogger.info('[ChatWS] Automation reminder sent via WebSocket as response', {
          messageType: msgType,
          notificationId: (message as any).metadata?.notificationId,
          automationJobId: (message as any).metadata?.automationJobId,
          messagePreview: (message as any).response?.substring(0, 50)
        });
      } else if (msgType === 'response') {
        appLogger.debug('[ChatWS] Response sent via WebSocket', {
          messageType: msgType,
          hasResponse: !!(message as any).response
        });
      }
    } catch (error) {
      appLogger.error('[ChatWS] Failed to send WebSocket message', {
        error: error instanceof Error ? error.message : 'Unknown error',
        messageType: (message as any).type
      });
    }
  } else {
    appLogger.warn('[ChatWS] WebSocket not open - message not sent', {
      readyState: ws.readyState,
      expectedOpen: WebSocket.OPEN,
      messageType: (message as any).type
    });
  }
}

/**
 * Bind a WebSocket connection to a user session and replay durable UI state.
 */
async function bindSessionToConnection(
  connection: WSConnection,
  userId: string,
  appName: string,
  attributes?: Record<string, any>
): Promise<void> {
  connection.userId = userId;
  connection.appName = appName;
  connection.attributes = attributes || connection.attributes || {};

  chatWsService.updateConnectionUserId(connection.clientId, userId, appName);

  if (!connection.modeStateReplayed) {
    await godModeManagerService.replayActiveModeToClient(connection.clientId, userId, appName);
    connection.modeStateReplayed = true;
  }
}

/**
 * Handle session initialization from a freshly connected browser client.
 */
async function handleSessionInit(
  connection: WSConnection,
  payload: WSSessionInitRequest
): Promise<void> {
  if (!payload?.user_id || !payload?.app_name) {
    appLogger.warn('[ChatWS] SESSION_INIT ignored: missing user_id/app_name', {
      clientId: connection.clientId
    });
    return;
  }

  await bindSessionToConnection(
    connection,
    payload.user_id,
    payload.app_name,
    payload.attributes
  );

  sendMessage(connection.socket, {
    type: WS_MESSAGE_TYPE.CONNECTED,
    event: 'session_bound',
    clientId: connection.clientId,
    userId: payload.user_id,
    appName: payload.app_name,
    timestamp: Date.now()
  });
}

/**
 * Handle chat message
 */
async function handleChatMessage(
  connection: WSConnection,
  payload: WSChatRequest
): Promise<void> {
  const { user_id, app_name, text, chat_history = [], language = 'id', attributes } = payload;  // ✅ Destructure attributes

  await bindSessionToConnection(connection, user_id, app_name, attributes);

  appLogger.info('[ChatWS] Received chat message - checking for pending notifications', {
    clientId: connection.clientId,
    userId: user_id,
    appName: app_name,
    messageText: text.substring(0, 30)
  });

  // ✅ FIX: Send any pending notifications from scheduler
  const pendingNotifications = schedulerNotificationService.getPendingNotifications(user_id, app_name);
  
  appLogger.info('[ChatWS] Pending notifications check result', {
    clientId: connection.clientId,
    userId: user_id,
    appName: app_name,
    pendingCount: pendingNotifications.length,
    wsReadyState: connection.socket.readyState
  });

  if (pendingNotifications.length > 0) {
    appLogger.info('[ChatWS] Delivering pending scheduler notifications', {
      clientId: connection.clientId,
      userId: user_id,
      appName: app_name,
      count: pendingNotifications.length
    });

    // Send each pending notification to the client as RESPONSE type so it renders as chat
    pendingNotifications.forEach((notif, idx) => {
      appLogger.debug('[ChatWS] Sending notification as chat response', {
        index: idx,
        clientId: connection.clientId,
        notificationId: notif.id,
        message: notif.message,
        wsOpen: connection.socket.readyState === 1 // OPEN = 1
      });

      // ✅ Send as 'response' type so client renders it as a chat message
      sendMessage(connection.socket, {
        type: WS_MESSAGE_TYPE.RESPONSE,
        success: true,
        response: notif.message,  // ✅ Use 'response' field for AI message
        intent: 'automation_reminder',
        confidence: 1.0,
        metadata: {
          source: 'automation_scheduler',
          notificationId: notif.id,
          automationJobId: notif.automationJobId,
          timestamp: notif.sentAt.getTime(),
          responseTime: 0
        }
      });
    });

    // Mark as delivered
    schedulerNotificationService.markAsDelivered(user_id, app_name, pendingNotifications.length);
    
    appLogger.info('[ChatWS] All pending automation reminders delivered as chat responses', {
      clientId: connection.clientId,
      userId: user_id,
      count: pendingNotifications.length
    });
  } else {
    appLogger.debug('[ChatWS] No pending notifications to deliver', {
      clientId: connection.clientId,
      userId: user_id,
      appName: app_name
    });
  }

  appLogger.info('[ChatWS] Processing chat message', {
    clientId: connection.clientId,
    userId: user_id,
    appName: app_name,
    textLength: text.length,
    hasAttributes: !!attributes,  // ✅ Log if attributes exists
    attributesParams: attributes?.params  // ✅ Log attributes.params
  });

  // Send typing indicator
  sendMessage(connection.socket, {
    type: WS_MESSAGE_TYPE.TYPING,
    status: 'started',
    timestamp: Date.now()
  });

  try {
    // Start timing
    const startTime = Date.now();

    // Process through pipeline WITH ATTRIBUTES
    const result = await pipelineService.run({
      user_id,
      app_name,
      text,
      chat_history: chat_history as any[],
      language,
      attributes  // ✅ Pass attributes to pipeline
    });

    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Send response
    sendMessage(connection.socket, {
      type: WS_MESSAGE_TYPE.RESPONSE,
      success: true,
      response: (result as any).response || result.naturalResponse,
      intent: result.intent,
      confidence: (result as any).confidence || 0,
      metadata: {
        ...result.metadata,
        responseTime,
        via: 'websocket'
      },
      timestamp: Date.now()
    });

    // Send typing stopped
    sendMessage(connection.socket, {
      type: WS_MESSAGE_TYPE.TYPING,
      status: 'stopped',
      timestamp: Date.now()
    });

  } catch (error) {
    appLogger.error('[ChatWS] Error processing chat', {
      clientId: connection.clientId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    sendMessage(connection.socket, {
      type: WS_MESSAGE_TYPE.ERROR,
      error: 'Failed to process chat',
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now()
    });

    // Send typing stopped
    sendMessage(connection.socket, {
      type: WS_MESSAGE_TYPE.TYPING,
      status: 'stopped',
      timestamp: Date.now()
    });
  }
}

/**
 * Broadcast typing indicator to other connections
 */
function broadcastTypingIndicator(
  sender: WSConnection,
  payload?: { userId?: string }
): void {
  // Optional: Broadcast to other connections from same user
  const connections = chatWsService.getConnectionsByUserId(payload?.userId || '');
  
  connections.forEach(conn => {
    if (conn.clientId !== sender.clientId && conn.isConnected) {
      sendMessage(conn.socket, {
        type: WS_MESSAGE_TYPE.TYPING,
        userId: payload?.userId,
        status: 'typing',
        timestamp: Date.now()
      });
    }
  });
}

/**
 * Generate unique client ID
 */
function generateClientId(): string {
  return 'ws_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export default chatWsRoute;
