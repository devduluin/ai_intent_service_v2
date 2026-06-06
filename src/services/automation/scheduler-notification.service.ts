/**
 * Scheduler Notification Service
 * Stores pending notifications from scheduled automation jobs
 * Delivers them when user connects to chat or at next opportunity
 */

import { appLogger } from '../../utils/logger.util';

export interface PendingNotification {
  id: string;
  userId: string;
  appName: string;
  message: string;
  sentAt: Date;
  channel: 'chat';
  automationJobId?: string;
  read: boolean;
}

class SchedulerNotificationService {
  /**
   * Store pending notifications per user:app
   * Key format: "userId:appName"
   */
  private notifications: Map<string, PendingNotification[]> = new Map();

  /**
   * Add a pending notification to be delivered to user
   * Called by scheduler when automation job execution completes
   */
  addNotification(
    userId: string,
    appName: string,
    message: string,
    automationJobId?: string
  ): void {
    const key = `${userId}:${appName}`;
    
    const notification: PendingNotification = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      appName,
      message,
      sentAt: new Date(),
      channel: 'chat',
      automationJobId,
      read: false
    };

    if (!this.notifications.has(key)) {
      this.notifications.set(key, []);
    }
    
    this.notifications.get(key)!.push(notification);

    appLogger.info('[SchedulerNotificationService] Notification added to pending', {
      userId,
      appName,
      jobId: automationJobId,
      notificationId: notification.id,
      message: message.substring(0, 50) // Log first 50 chars
    });
  }

  /**
   * Get all pending notifications for a user+app combination
   */
  getPendingNotifications(userId: string, appName: string): PendingNotification[] {
    const key = `${userId}:${appName}`;
    const notifs = this.notifications.get(key) || [];
    
    // Debug logging
    if (notifs.length > 0) {
      appLogger.info('[SchedulerNotificationService] Retrieved pending notifications', {
        userId,
        appName,
        key,
        count: notifs.length,
        notifications: notifs.map(n => ({
          id: n.id,
          message: n.message.substring(0, 30),
          sentAt: n.sentAt.toISOString()
        }))
      });
    } else {
      appLogger.debug('[SchedulerNotificationService] No pending notifications found', {
        userId,
        appName,
        key,
        allKeys: Array.from(this.notifications.keys())
      });
    }
    
    return notifs;
  }

  /**
   * Mark notifications as delivered (remove from pending)
   */
  markAsDelivered(userId: string, appName: string, count: number = 1): void {
    const key = `${userId}:${appName}`;
    const notifs = this.notifications.get(key);
    
    if (notifs && count > 0) {
      const delivered = notifs.splice(0, count);
      
      appLogger.info('[SchedulerNotificationService] Notifications delivered', {
        userId,
        appName,
        count: delivered.length
      });

      // Clean up empty entries
      if (notifs.length === 0) {
        this.notifications.delete(key);
      }
    }
  }

  /**
   * Clear all pending notifications for a user+app
   */
  clearNotifications(userId: string, appName: string): void {
    const key = `${userId}:${appName}`;
    const cleared = this.notifications.get(key)?.length || 0;
    this.notifications.delete(key);
    
    if (cleared > 0) {
      appLogger.info('[SchedulerNotificationService] Notifications cleared', {
        userId,
        appName,
        count: cleared
      });
    }
  }

  /**
   * Get total pending notification count
   */
  getStats(): { total: number; queues: number } {
    let total = 0;
    this.notifications.forEach(notifs => {
      total += notifs.length;
    });
    
    return {
      total,
      queues: this.notifications.size
    };
  }

  /**
   * Debug: Get all notifications (for testing)
   */
  getAllNotifications(): Map<string, PendingNotification[]> {
    return new Map(this.notifications);
  }

  /**
   * Debug: Clear all notifications (for testing)
   */
  clearAll(): void {
    const stats = this.getStats();
    this.notifications.clear();
    appLogger.warn('[SchedulerNotificationService] All notifications cleared', {
      count: stats.total,
      queues: stats.queues
    });
  }
}

// Export singleton instance
export const schedulerNotificationService = new SchedulerNotificationService();

export default schedulerNotificationService;
