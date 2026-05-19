// repositories/episodic-memory.repository.ts
import { Op } from 'sequelize';
import { EpisodicMemoryModel } from '../database/models/episodic-memory.model';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import type { PlannerOutput } from '../types';

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
        toolsUsed: data.toolsUsed ?? existing.toolsUsed,
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
      toolsUsed: data.toolsUsed || null,
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

    const merged: PlannerOutput = {
      handlers: [],
      tools: [],
      knowledge: [],
      chat: false,
    };

    for (const memory of memories) {
      const plan = memory.toolsUsed as PlannerOutput | null;
      if (!plan) continue;

      if (plan.handlers?.length) {
        merged.handlers.push(...plan.handlers);
      }
      if (plan.tools?.length) {
        merged.tools.push(...plan.tools);
      }
      if (plan.knowledge?.length) {
        merged.knowledge.push(...plan.knowledge);
      }
      if (plan.chat === true) {
        merged.chat = true;
      }
    }

    // Remove duplicates
    merged.handlers = [...new Set(merged.handlers)];
    merged.tools = [...new Set(merged.tools)];
    merged.knowledge = [...new Set(merged.knowledge)];

    return merged;
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
      created_at: memory.created_at,
    };
  }
}

export const episodicMemoryRepository = new EpisodicMemoryRepository();
