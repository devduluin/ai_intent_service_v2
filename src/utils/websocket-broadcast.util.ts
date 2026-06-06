// ============================================================
// WebSocket Broadcast Utils
// ============================================================
// Reusable utilities for broadcasting different message types
// ============================================================

import { chatWsService, WS_MESSAGE_TYPE } from '../services/chat-ws.service';
import { appLogger } from '../utils/logger.util';

export interface BroadcastOptions {
  userId: string;
  appName: string;
  excludeClientId?: string;
}

export interface ReminderBroadcastData {
  jobId: string;
  message: string;
  scheduledFor: string;
  createdAt: number;
}

/**
 * Broadcast mode change event (god-mode, chat-mode, etc.)
 */
export function broadcastModeChange(
  userId: string,
  mode: 'god-mode' | 'chat-mode',
  modeName?: string | null
): void {
  try {
    chatWsService.broadcastToUser(userId, {
      type: WS_MESSAGE_TYPE.NOTIFICATION,
      event: 'mode_change',
      mode,
      modeName,
      godModeName: modeName,
      timestamp: Date.now(),
      message: mode === 'god-mode' 
        ? `Entered ${modeName || 'god'} mode`
        : 'Exited to chat mode'
    });

    appLogger.info('[BroadcastUtils] Mode change broadcast', {
      userId,
      mode,
      modeName
    });
  } catch (error) {
    appLogger.error('[BroadcastUtils] Failed to broadcast mode change', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId
    });
  }
}

/**
 * Broadcast reminder notification (type: "reminder")
 * Used by scheduler to push reminders to connected clients
 */
export function broadcastReminder(
  userId: string,
  data: ReminderBroadcastData
): void {
  try {
    chatWsService.broadcastToUser(userId, {
      type: 'reminder' as any,  // Custom type for reminder
      event: 'reminder',
      jobId: data.jobId,
      message: data.message,
      scheduledFor: data.scheduledFor,
      createdAt: data.createdAt,
      timestamp: Date.now()
    });

    appLogger.info('[BroadcastUtils] Reminder broadcast', {
      userId,
      jobId: data.jobId,
      message: data.message.substring(0, 50)
    });
  } catch (error) {
    appLogger.error('[BroadcastUtils] Failed to broadcast reminder', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId,
      jobId: data.jobId
    });
  }
}

/**
 * Broadcast response message (type: "response")
 * Used for normal chat responses
 */
export function broadcastResponse(
  userId: string,
  response: string,
  metadata?: Record<string, any>
): void {
  try {
    chatWsService.broadcastToUser(userId, {
      type: WS_MESSAGE_TYPE.RESPONSE,
      success: true,
      response,
      intent: metadata?.intent || 'automation_reminder',
      confidence: metadata?.confidence || 1.0,
      metadata: {
        source: 'automation_scheduler',
        timestamp: Date.now(),
        ...metadata
      }
    });

    appLogger.debug('[BroadcastUtils] Response broadcast', {
      userId,
      response: response.substring(0, 50)
    });
  } catch (error) {
    appLogger.error('[BroadcastUtils] Failed to broadcast response', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId
    });
  }
}

/**
 * Broadcast error message (type: "error")
 */
export function broadcastError(
  userId: string,
  errorMessage: string,
  errorCode?: string
): void {
  try {
    chatWsService.broadcastToUser(userId, {
      type: WS_MESSAGE_TYPE.ERROR,
      error: errorMessage,
      errorCode,
      timestamp: Date.now()
    });

    appLogger.warn('[BroadcastUtils] Error broadcast', {
      userId,
      errorMessage,
      errorCode
    });
  } catch (error) {
    appLogger.error('[BroadcastUtils] Failed to broadcast error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId
    });
  }
}

/**
 * Broadcast typing indicator (type: "typing")
 */
export function broadcastTyping(
  userId: string,
  status: 'started' | 'stopped'
): void {
  try {
    chatWsService.broadcastToUser(userId, {
      type: WS_MESSAGE_TYPE.TYPING,
      status,
      timestamp: Date.now()
    });
  } catch (error) {
    appLogger.error('[BroadcastUtils] Failed to broadcast typing', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId
    });
  }
}
