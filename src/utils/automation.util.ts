// ============================================================
// Automation Utils
// ============================================================
// Utilities for automation job management
// ============================================================

import { automationJobRepository } from '../repositories/automation-job.repository';
import type { AutomationJob } from '../types/automation.types';

/**
 * Get and format active reminders for today
 */
export async function getActiveRemindersForToday(
  userId: string,
  appName: string,
  limit = 5
): Promise<{ count: number; list: string[] }> {
  const jobs = await automationJobRepository.getActiveJobs(userId, appName, {
    type: 'reminder',
    nextRunAtToday: true,
    limit
  });

  const list = jobs.map(job => {
    const nextRun = job.nextRunAt ? new Date(job.nextRunAt) : null;
    const timeStr = nextRun ? nextRun.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '';
    return `${job.title}${timeStr ? ` (${timeStr})` : ''}`;
  });

  return {
    count: jobs.length,
    list
  };
}

/**
 * Get and format active conditional alerts
 */
export async function getActiveConditionalAlerts(
  userId: string,
  appName: string,
  limit = 5
): Promise<{ count: number; list: string[] }> {
  const jobs = await automationJobRepository.getActiveJobs(userId, appName, {
    type: 'conditional_alert',
    limit
  });

  const list = jobs.map(job => job.title);

  return {
    count: jobs.length,
    list
  };
}

/**
 * Get and format active scheduled workflows
 */
export async function getActiveScheduledWorkflows(
  userId: string,
  appName: string,
  limit = 5
): Promise<{ count: number; list: string[] }> {
  const jobs = await automationJobRepository.getActiveJobs(userId, appName, {
    type: 'scheduled_workflow',
    limit
  });

  const list = jobs.map(job => {
    const nextRun = job.nextRunAt ? new Date(job.nextRunAt) : null;
    const cronDesc = nextRun ? nextRun.toLocaleString('id-ID') : '';
    return `${job.title}${cronDesc ? ` (${cronDesc})` : ''}`;
  });

  return {
    count: jobs.length,
    list
  };
}

/**
 * Format reminder info text for confirmation prompt
 */
export function formatReminderInfo(
  count: number,
  list: string[]
): string {
  if (count === 0) return '';

  if (count === 1) {
    return `Saya melihat Anda juga punya ${count} reminder aktif untuk hari ini, yaitu: ${list[0]}. `;
  }

  if (count <= 3) {
    return `Saya melihat Anda juga punya ${count} reminder aktif untuk hari ini, yaitu: ${list.join(', ')}. `;
  }

  return `Saya melihat Anda juga punya ${count} reminder aktif untuk hari ini, termasuk: ${list.slice(0, 3).join(', ')}${count > 3 ? ' dan lainnya' : ''}. `;
}

/**
 * Format conditional alert info text for confirmation prompt
 */
export function formatConditionalAlertInfo(
  count: number,
  list: string[]
): string {
  if (count === 0) return '';

  if (count === 1) {
    return `Saya melihat Anda juga punya ${count} conditional alert aktif, yaitu: ${list[0]}. `;
  }

  if (count <= 3) {
    return `Saya melihat Anda juga punya ${count} conditional alert aktif, yaitu: ${list.join(', ')}. `;
  }

  return `Saya melihat Anda juga punya ${count} conditional alert aktif, termasuk: ${list.slice(0, 3).join(', ')}${count > 3 ? ' dan lainnya' : ''}. `;
}

/**
 * Format scheduled workflow info text for confirmation prompt
 */
export function formatScheduledWorkflowInfo(
  count: number,
  list: string[]
): string {
  if (count === 0) return '';

  if (count === 1) {
    return `Saya melihat Anda juga punya ${count} scheduled workflow aktif, yaitu: ${list[0]}. `;
  }

  if (count <= 3) {
    return `Saya melihat Anda juga punya ${count} scheduled workflow aktif, yaitu: ${list.join(', ')}. `;
  }

  return `Saya melihat Anda juga punya ${count} scheduled workflow aktif, termasuk: ${list.slice(0, 3).join(', ')}${count > 3 ? ' dan lainnya' : ''}. `;
}
