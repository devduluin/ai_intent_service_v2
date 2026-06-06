// repositories/episodic-memory.repository.ts
import { Op } from 'sequelize';
import { EpisodicMemoryModel } from '../database/models/episodic-memory.model';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import type { PlannerOutput } from '../types/planner.types';
import type { EpisodicFlowTraceItem, EpisodicMemoryWriteContext } from '../types/episodic-memory-write.types';
import { appLogger } from '../utils/logger.util';
import { config } from '../config';

// ============================================================
// Constants
// ============================================================

export const MAX_SLOTS_PER_USER = config.memory.maxRowMemoryPerUser;

export class EpisodicMemoryRepository {
  /**
   * Create new episodic memory
   */
  async create(data: Omit<EpisodicMemory, 'id' | 'created_at'>): Promise<EpisodicMemory> {
    const memory = await EpisodicMemoryModel.create({
      user_id: data.user_id,
      app_name: data.app_name,
      level: data.level,
      intent: data.intent,
      summary: data.summary,
      toolsUsed: data.toolsUsed || null,
      topicKey: data.topicKey || data.intent,
      topicLabel: data.topicLabel || null,
      flowStage: data.flowStage || null,
      taskPlan: data.taskPlan || data.toolsUsed || null,
      flowTrace: data.flowTrace || null,
      rerunnable: data.rerunnable ?? (!!(data.taskPlan?.tasks?.length)),
      memoryMeta: data.memoryMeta || null,
    });

    return this.toResponse(memory);
  }

  /**
   * Update existing episodic memory by ID
   */
  async update(
    id: string,
    data: Partial<Omit<EpisodicMemory, 'id' | 'user_id' | 'app_name' | 'created_at'>>
  ): Promise<EpisodicMemory | null> {
    const memory = await EpisodicMemoryModel.findByPk(id);

    if (!memory) {
      return null;
    }

    await memory.update({
      intent: data.intent ?? memory.intent,
      summary: data.summary ?? memory.summary,
      toolsUsed: data.toolsUsed !== undefined ? data.toolsUsed : memory.toolsUsed,
      topicKey: data.topicKey !== undefined ? data.topicKey : memory.topicKey,
      topicLabel: data.topicLabel !== undefined ? data.topicLabel : memory.topicLabel,
      flowStage: data.flowStage !== undefined ? data.flowStage : memory.flowStage,
      taskPlan: data.taskPlan !== undefined ? data.taskPlan : memory.taskPlan,
      flowTrace: data.flowTrace !== undefined ? data.flowTrace : memory.flowTrace,
      memoryMeta: data.memoryMeta !== undefined ? data.memoryMeta : memory.memoryMeta,
      updated_at: new Date(),
    });

    return this.toResponse(memory);
  }

  /**
   * Upsert memory: update if intent exists for user+app, else create
   */
  async upsert(
    userId: string,
    appName: string,
    intentSlug: string,
    data: {
      level: EpisodicMemory['level'];
      summary: string;
      toolsUsed?: PlannerOutput | null;
      topicKey?: string | null;
      topicLabel?: string | null;
      flowStage?: string | null;
      taskPlan?: PlannerOutput | null;
      flowTrace?: EpisodicFlowTraceItem[] | null;
      rerunnable?: boolean;
      memoryMeta?: Record<string, unknown> | null;
    }
  ): Promise<EpisodicMemory> {
    // Find existing memory for this user+app+intent
    const existing = await EpisodicMemoryModel.findOne({
      where: {
        user_id: userId,
        app_name: appName,
        intent: intentSlug,
      },
    });

    if (existing) {
      // Update existing
      await existing.update({
        summary: data.summary,
        toolsUsed: data.toolsUsed ?? data.taskPlan ?? existing.toolsUsed,
        topicKey: data.topicKey ?? existing.topicKey ?? intentSlug,
        topicLabel: data.topicLabel ?? existing.topicLabel,
        flowStage: data.flowStage ?? existing.flowStage,
        taskPlan: data.taskPlan ?? data.toolsUsed ?? existing.taskPlan,
        flowTrace: data.flowTrace ?? existing.flowTrace,
        memoryMeta: data.memoryMeta ?? existing.memoryMeta,
        updated_at: new Date(),
      });

      return this.toResponse(existing);
    }

    // Create new
    const memory = await EpisodicMemoryModel.create({
      user_id: userId,
      app_name: appName,
      level: data.level,
      intent: intentSlug,
      summary: data.summary,
      toolsUsed: data.toolsUsed || data.taskPlan || null,
      topicKey: data.topicKey || intentSlug,
      topicLabel: data.topicLabel || null,
      flowStage: data.flowStage || null,
      taskPlan: data.taskPlan || data.toolsUsed || null,
      flowTrace: data.flowTrace || null,
      rerunnable: data.rerunnable ?? (!!(data.taskPlan?.tasks?.length)),
      memoryMeta: data.memoryMeta || null,
    });

    return this.toResponse(memory);
  }

  /**
   * Find memory by ID
   */
  async findById(id: string): Promise<EpisodicMemory | null> {
    const memory = await EpisodicMemoryModel.findByPk(id);
    return memory ? this.toResponse(memory) : null;
  }

  /**
   * Get memories for user+app, ordered by created_at DESC
   */
  async findByUserAndApp(
    userId: string,
    appName: string,
    limit = 10
  ): Promise<EpisodicMemory[]> {
    const memories = await EpisodicMemoryModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
      },
      order: [['created_at', 'DESC']],
      limit,
    });

    return memories.map((m) => this.toResponse(m));
  }

  /**
   * Get most recent memory for user+app
   */
  async findLastByUserAndApp(
    userId: string,
    appName: string
  ): Promise<EpisodicMemory | null> {
    const memory = await EpisodicMemoryModel.findOne({
      where: {
        user_id: userId,
        app_name: appName,
      },
      order: [['created_at', 'DESC']],
    });

    return memory ? this.toResponse(memory) : null;
  }

  /**
   * Get memory by user+app+intent
   */
  async findByIntent(
    userId: string,
    appName: string,
    intentSlug: string
  ): Promise<EpisodicMemory | null> {
    const memory = await EpisodicMemoryModel.findOne({
      where: {
        user_id: userId,
        app_name: appName,
        intent: intentSlug,
      },
      order: [['created_at', 'DESC']],
    });

    return memory ? this.toResponse(memory) : null;
  }

  /**
   * Count memories for user+app
   */
  async countByUserAndApp(userId: string, appName: string): Promise<number> {
    return EpisodicMemoryModel.count({
      where: {
        user_id: userId,
        app_name: appName,
      },
    });
  }

  /**
   * Delete oldest memories to maintain limit (slot-based cleanup)
   * Returns deleted count
   */
  async deleteOldestToMaintainLimit(
    userId: string,
    appName: string,
    maxSlots: number
  ): Promise<number> {
    const memories = await EpisodicMemoryModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
      },
      order: [['created_at', 'DESC']],
    });

    if (memories.length <= maxSlots) {
      return 0;
    }

    const toDelete = memories.slice(maxSlots);
    const idsToDelete = toDelete.map((m) => m.id);

    const deleted = await EpisodicMemoryModel.destroy({
      where: {
        id: {
          [Op.in]: idsToDelete,
        },
      },
    });

    return deleted;
  }

  /**
   * Delete memory by ID
   */
  async deleteById(id: string): Promise<boolean> {
    const deleted = await EpisodicMemoryModel.destroy({
      where: { id },
    });

    return deleted > 0;
  }

  /**
   * Delete all memories for user+app
   */
  async deleteByUserAndApp(userId: string, appName: string): Promise<number> {
    return EpisodicMemoryModel.destroy({
      where: {
        user_id: userId,
        app_name: appName,
      },
    });
  }

  /**
   * Get recent context summaries for user+app
   */
  async getRecentContext(
    userId: string,
    appName: string,
    limit = 5
  ): Promise<string[]> {
    const memories = await EpisodicMemoryModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
      },
      attributes: ['summary'],
      order: [['created_at', 'DESC']],
      limit,
    });

    return memories.map((m) => m.summary);
  }

  /**
   * Get memories for user+app within a date range, ordered newest first.
   */
  async findByDateRange(
    userId: string,
    appName: string,
    start: Date,
    end: Date,
    limit = 10
  ): Promise<EpisodicMemory[]> {
    const memories = await EpisodicMemoryModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
        created_at: {
          [Op.between]: [start, end],
        },
      },
      order: [['created_at', 'DESC']],
      limit,
    });

    return memories.map((m) => this.toResponse(m));
  }

  /**
   * Get recent memories by lightweight topic match.
   */
  async findRecentByTopic(
    userId: string,
    appName: string,
    topic: string,
    limit = 10
  ): Promise<EpisodicMemory[]> {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      return this.findByUserAndApp(userId, appName, limit);
    }

    const memories = await EpisodicMemoryModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
        [Op.or]: [
          { intent: { [Op.iLike]: `%${normalizedTopic}%` } },
          { summary: { [Op.iLike]: `%${normalizedTopic}%` } },
        ],
      },
      order: [['created_at', 'DESC']],
      limit,
    });

    return memories.map((m) => this.toResponse(m));
  }

  /**
   * Get aggregated tool usage from memories
   */
  async getAggregatedToolUsage(
    userId: string,
    appName: string
  ): Promise<PlannerOutput> {
    const memories = await EpisodicMemoryModel.findAll({
      where: {
        user_id: userId,
        app_name: appName,
      },
      attributes: ['toolsUsed'],
    });

    const allTasks: Array<{
      id: string;
      resource: 'tool' | 'skill' | 'knowledge';
      key: string;
      depends_on: string[];
    }> = [];

    let hasChat = false;
    let taskIdCounter = 1;

    for (const memory of memories) {
      const plan = memory.toolsUsed as PlannerOutput | null;
      if (!plan) continue;

      // Collect tasks from plan
      if (plan.tasks && plan.tasks.length > 0) {
        plan.tasks.forEach(task => {
          allTasks.push({
            id: String(taskIdCounter++),
            resource: task.resource,
            key: task.key,
            depends_on: task.depends_on || []
          });
        });
      }

      if (plan.chat === true) {
        hasChat = true;
      }
    }

    // Remove duplicate tasks by key
    const uniqueTasks = allTasks.filter((task, index, self) =>
      index === self.findIndex(t => t.key === task.key && t.resource === task.resource)
    );

    return {
      mode: uniqueTasks.length > 1 ? 'multi_step' : 'single_step',
      chat: hasChat && uniqueTasks.length === 0,
      tasks: uniqueTasks,
      meta: undefined
    };
  }

  /**
   * Convert model to response DTO
   */
  private toResponse(memory: EpisodicMemoryModel): EpisodicMemory {
    return {
      id: memory.id,
      user_id: memory.user_id,
      app_name: memory.app_name,
      level: memory.level,
      intent: memory.intent,
      summary: memory.summary,
      toolsUsed: memory.toolsUsed as PlannerOutput | undefined,
      topicKey: memory.topicKey,
      topicLabel: memory.topicLabel,
      flowStage: memory.flowStage,
      taskPlan: memory.taskPlan as PlannerOutput | null,
      flowTrace: memory.flowTrace as EpisodicFlowTraceItem[] | null,
      rerunnable: memory.rerunnable ?? false,
      memoryMeta: memory.memoryMeta as Record<string, unknown> | null,
      created_at: memory.created_at,
    };
  }
}

export const episodicMemoryRepository = new EpisodicMemoryRepository();
