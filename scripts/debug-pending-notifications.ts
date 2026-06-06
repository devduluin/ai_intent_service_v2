#!/usr/bin/env node

/**
 * Debug Script: Check Pending Notifications
 * Usage: npx tsx scripts/debug-pending-notifications.ts (from root)
 */

import 'dotenv/config';
import { schedulerNotificationService } from '../src/services/automation/scheduler-notification.service';

async function debugNotifications() {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 PENDING NOTIFICATIONS DEBUG');
  console.log('='.repeat(80) + '\n');

  try {
    // Get all notifications
    const allNotifications = schedulerNotificationService.getAllNotifications();
    
    console.log('[1] Total queues with pending notifications:', allNotifications.size);
    
    if (allNotifications.size === 0) {
      console.log('⚠️  No notifications in queue\n');
    } else {
      // Iterate through all queues
      let totalNotifications = 0;
      
      allNotifications.forEach((notifications, key) => {
        console.log(`\n[Queue] ${key}`);
        console.log(`  Total notifications: ${notifications.length}`);
        
        notifications.forEach((notif, idx) => {
          console.log(`  [${idx}] ${notif.id}`);
          console.log(`      Message: ${notif.message}`);
          console.log(`      Sent At: ${notif.sentAt.toISOString()}`);
          console.log(`      Channel: ${notif.channel}`);
          console.log(`      Auto Job: ${notif.automationJobId || 'N/A'}`);
          console.log('');
        });
        
        totalNotifications += notifications.length;
      });
      
      console.log(`\n✅ Total notifications in all queues: ${totalNotifications}`);
    }

    // Get stats
    const stats = schedulerNotificationService.getStats();
    console.log('\n[2] Statistics:');
    console.log(`    Total notifications: ${stats.total}`);
    console.log(`    Active queues: ${stats.queues}`);

    // Test retrieval
    console.log('\n[3] Test Retrieval:');
    const testUserId = 'user_nwe7a4w2d';
    const testAppName = 'hris';
    const testKey = `${testUserId}:${testAppName}`;
    
    console.log(`    Testing key: "${testKey}"`);
    const testNotifs = schedulerNotificationService.getPendingNotifications(testUserId, testAppName);
    console.log(`    Found: ${testNotifs.length} notifications`);
    
    if (testNotifs.length > 0) {
      testNotifs.forEach((notif, idx) => {
        console.log(`    [${idx}] ${notif.message}`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
  }

  console.log('\n' + '='.repeat(80) + '\n');
  process.exit(0);
}

debugNotifications().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
