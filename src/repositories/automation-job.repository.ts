import { Op } from 'sequelize';
import { AutomationJobModel } from '../database/models/automation-job.model';
import type {
  AutomationJob,
  AutomationJobDraft,
  AutomationJobStatus
} from '../types/automation.types';
import { appLogger } from '../utils/logger.util';
import { config } from '../config';

// ============================================================
// Constants
// ============================================================

const MAX_JOBS_PER_USER = config.memory.maxRowMemoryPerUser; // Slot limit per user (same as episodic memory)

export class AutomationJobRepository {
  async create(data: AutomationJobDraft): Promise<AutomationJob> {
    // ✅ SLOT-BASED LIMITATION: Clean up old jobs if user has reached max slots
    await this.cleanupOldJobsIfNecessary(data.userId || '', data.appName || '');

    const job = await AutomationJobModel.create({
      user_id: data.userId || '',
      app_name: data.appName || '',
      agent_id: data.agentId || null,
      title: data.title,
      goal: data.goal,
      type: data.type,
      trigger: data.trigger,
      condition: data.condition || null,
      workflow: data.workflow,
      action: data.action,
      notification: data.notification || null,
      status: data.status || 'draft',
      safety: data.safety,
      next_run_at: data.nextRunAt ? new Date(data.nextRunAt) : null,
      run_count: 0,
      max_runs: null,
    });

    appLogger.info('[AutomationJobRepository] Job created with slot cleanup', {
      jobId: job.id,
      userId: data.userId,
      appName: data.appName,
      maxSlots: MAX_JOBS_PER_USER
    });

    return this.toResponse(job);
  }

  /**
   * Get active automation jobs for user
   */
  async getActiveJobs(
    userId: string,
    appName: string,
    options?: {
      type?: 'reminder' | 'scheduled_workflow' | 'conditional_alert';
      nextRunAtToday?: boolean;
      limit?: number;
    }
  ): Promise<AutomationJob[]> {
    const where: any = {
      user_id: userId,
      app_name: appName,
      status: 'active'
    };

    // Filter by type if specified
    if (options?.type) {
      where.type = options.type;
    }

    // Filter by today's date if specified
    if (options?.nextRunAtToday) {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
      
      where.next_run_at = {
        [Op.gte]: startOfDay,
        [Op.lte]: endOfDay
      };
    }

    const jobs = await AutomationJobModel.findAll({
      where,
      order: [['next_run_at', 'ASC']],
      limit: options?.limit || 10
    });

    return jobs.map(job => this.toResponse(job));
  }

  /**
   * Clean up old jobs if user has reached max slots
   * Deletes oldest completed/failed jobs to make room for new ones
   */
  private async cleanupOldJobsIfNecessary(userId: string, appName: string): Promise<void> {
    try {
      // Count active jobs
      const activeJobs = await AutomationJobModel.count({
        where: {
          user_id: userId,
          app_name: appName,
          status: {
            [Op.in]: ['active', 'paused', 'draft']  // Only count active/pending jobs
          }
        }
      });

      // If at max capacity, delete oldest completed/failed jobs
      if (activeJobs >= MAX_JOBS_PER_USER) {
        const jobsToDelete = await AutomationJobModel.findAll({
          where: {
            user_id: userId,
            app_name: appName,
            status: {
              [Op.in]: ['completed', 'failed', 'cancelled']  // Only delete finished jobs
            }
          },
          order: [['updated_at', 'ASC']],  // Delete oldest first
          limit: Math.min(3, activeJobs - MAX_JOBS_PER_USER + 1)  // Delete enough to make room
        });

        if (jobsToDelete.length > 0) {
          const deleteIds = jobsToDelete.map(j => j.id);
          await AutomationJobModel.destroy({
            where: {
              id: {
                [Op.in]: deleteIds
              }
            }
          });

          appLogger.warn('[AutomationJobRepository] Old jobs cleaned up to make room for new jobs', {
            userId,
            appName,
            deletedCount: jobsToDelete.length,
            deletedIds: deleteIds,
            remainingActiveJobs: activeJobs - jobsToDelete.length
          });
        }
      }
    } catch (error) {
      appLogger.error('[AutomationJobRepository] Slot cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
        appName
      });
      // Don't throw - cleanup failure shouldn't prevent job creation
    }
  }

  async findById(id: string): Promise<AutomationJob | null> {
    const job = await AutomationJobModel.findByPk(id);
    return job ? this.toResponse(job) : null;
  }

  async deleteById(id: string): Promise<AutomationJob | null> {
    const job = await AutomationJobModel.findByPk(id);
    if (!job) return null;

    const response = this.toResponse(job);
    await job.destroy();

    appLogger.info('[AutomationJobRepository] Job hard deleted', {
      jobId: id,
      userId: response.userId,
      appName: response.appName
    });

    return response;
  }

  async findByUserAndApp(
    userId: string,
    appName: string,
    options?: {
      status?: AutomationJobStatus;
      limit?: number;
    }
  ): Promise<AutomationJob[]> {
    const jobs = await AutomationJobModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
        ...(options?.status ? { status: options.status } : {})
      },
      order: [['created_at', 'DESC']],
      limit: options?.limit || 20
    });

    return jobs.map(job => this.toResponse(job));
  }

  async findDueJobs(now = new Date(), limit = 50): Promise<AutomationJob[]> {
    const jobs = await AutomationJobModel.findAll({
      where: {
        status: 'active',
        next_run_at: {
          [Op.lte]: now
        }
      },
      order: [['next_run_at', 'ASC']],
      limit
    });

    return jobs.map(job => this.toResponse(job));
  }

  async updateStatus(
    id: string,
    status: AutomationJobStatus,
    patch?: {
      lastError?: string | null;
      lastResult?: unknown;
      nextRunAt?: Date | string | null;
      lastRunAt?: Date | string | null;
      incrementRunCount?: boolean;
    }
  ): Promise<AutomationJob | null> {
    const job = await AutomationJobModel.findByPk(id);
    if (!job) return null;

    const update: Partial<AutomationJobModel> = {
      status,
      updated_at: new Date()
    };

    if (patch?.lastError !== undefined) update.last_error = patch.lastError;
    if (patch?.lastResult !== undefined) update.last_result = patch.lastResult as Record<string, any>;
    if (patch?.nextRunAt !== undefined) update.next_run_at = patch.nextRunAt ? new Date(patch.nextRunAt) : null;
    if (patch?.lastRunAt !== undefined) update.last_run_at = patch.lastRunAt ? new Date(patch.lastRunAt) : null;
    if (patch?.incrementRunCount) update.run_count = (job.run_count || 0) + 1;

    await job.update(update);
    return this.toResponse(job);
  }

  async pauseById(id: string): Promise<AutomationJob | null> {
    return this.updateStatus(id, 'paused', {
      nextRunAt: null,
      lastError: null
    });
  }

  async resumeById(id: string, nextRunAt?: Date | string | null): Promise<AutomationJob | null> {
    return this.updateStatus(id, 'active', {
      nextRunAt: nextRunAt ?? null,
      lastError: null
    });
  }

  async update(
    id: string,
    data: Partial<AutomationJobDraft>
  ): Promise<AutomationJob | null> {
    const job = await AutomationJobModel.findByPk(id);
    if (!job) return null;

    await job.update({
      title: data.title ?? job.title,
      goal: data.goal ?? job.goal,
      type: data.type ?? job.type,
      trigger: data.trigger ?? job.trigger,
      condition: data.condition !== undefined ? data.condition : job.condition,
      workflow: data.workflow ?? job.workflow,
      action: data.action ?? job.action,
      notification: data.notification !== undefined ? data.notification : job.notification,
      status: data.status ?? job.status,
      safety: data.safety ?? job.safety,
      next_run_at: data.nextRunAt !== undefined
        ? data.nextRunAt ? new Date(data.nextRunAt) : null
        : job.next_run_at,
      updated_at: new Date()
    });

    return this.toResponse(job);
  }

  private toResponse(job: AutomationJobModel): AutomationJob {
    return {
      id: job.id,
      userId: job.user_id,
      appName: job.app_name,
      agentId: job.agent_id,
      title: job.title,
      goal: job.goal,
      type: job.type,
      trigger: job.trigger as any,
      condition: job.condition as any,
      workflow: job.workflow as any,
      action: job.action as any,
      notification: job.notification as any,
      status: job.status,
      safety: job.safety as any,
      nextRunAt: job.next_run_at ? job.next_run_at.toISOString() : null,
      lastRunAt: job.last_run_at,
      lastResult: job.last_result,
      lastError: job.last_error,
      runCount: job.run_count || 0,
      maxRuns: job.max_runs,
      createdAt: job.created_at,
      updatedAt: job.updated_at
    };
  }
}

export const automationJobRepository = new AutomationJobRepository();
