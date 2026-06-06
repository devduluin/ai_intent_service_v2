// ============================================================
// Scheduler Runner Service
// ============================================================
// Runs automation jobs on schedule using node-cron
// Checks every minute for due jobs and executes them
// ============================================================

import cron, { ScheduledTask } from 'node-cron';
import { automationSchedulerService } from './scheduler.service';
import { appLogger } from '../../utils/logger.util';

// ============================================================
// Scheduler Runner Service
// ============================================================

export class SchedulerRunnerService {
  private cronJob: ScheduledTask | null = null;
  private isRunning = false;

  /**
   * Start the scheduler
   * Runs every minute at second 0
   */
  start(): void {
    if (this.isRunning) {
      appLogger.warn('[SchedulerRunner] Scheduler already running');
      return;
    }

    appLogger.info('[SchedulerRunner] Initializing scheduler...');

    // Schedule: Every minute at second 0
    // Cron format: second minute hour day month weekday
    this.cronJob = cron.schedule('0 * * * * *', async () => {
      await this.runScheduledCheck();
    }, {
      timezone: 'Asia/Jakarta'
    });

    if (this.cronJob) {
      this.isRunning = true;
      appLogger.info('[SchedulerRunner] Scheduler started - checking automation jobs every minute');
    }
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.cronJob && this.isRunning) {
      this.cronJob.stop();
      this.isRunning = false;
      appLogger.info('[SchedulerRunner] Scheduler stopped');
    }
  }

  /**
   * Check if scheduler is active
   */
  isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Run scheduled job check
   * Called every minute by cron
   */
  private async runScheduledCheck(): Promise<void> {
    const now = new Date();

    // Skip if already running (prevent overlap)
    if (this.isRunning && false) {  // Note: isRunning check, but we allow concurrent for now
      appLogger.warn('[SchedulerRunner] Check skipped - previous check still running');
      return;
    }

    try {
      appLogger.debug('[SchedulerRunner] Running scheduled job check...', {
        timestamp: now.toISOString()
      });

      const result = await automationSchedulerService.runDueJobs(
        now,
        50  // Max 50 jobs per run
      );

      // Log results if there's activity
      if (result.executed > 0 || result.failed > 0 || result.skipped > 0) {
        appLogger.info('[SchedulerRunner] Job check completed', {
          checked: result.checked,
          executed: result.executed,
          failed: result.failed,
          skipped: result.skipped,
          timestamp: now.toISOString()
        });

        // Log individual results for debugging
        if (result.results.length > 0) {
          result.results.forEach((r, i) => {
            appLogger.debug(`[SchedulerRunner] Job [${i}]`, {
              jobId: r.jobId,
              status: r.status,
              error: r.error
            });
          });
        }
      } else {
        appLogger.debug('[SchedulerRunner] No due jobs found', {
          checked: result.checked,
          timestamp: now.toISOString()
        });
      }
    } catch (error) {
      appLogger.error('[SchedulerRunner] Job check failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: now.toISOString()
      });
    }
  }

  /**
   * Manually trigger a job check (for testing)
   */
  async triggerManualCheck(): Promise<void> {
    appLogger.info('[SchedulerRunner] Triggering manual job check...');
    await this.runScheduledCheck();
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const schedulerRunnerService = new SchedulerRunnerService();
