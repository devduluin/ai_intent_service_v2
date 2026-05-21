import { openAiService } from './openAi.service';
import { episodicMemoryRepository } from '../repositories/episodic-memory.repository';
import { globalCache } from '../utils/cache-helper.util';
import { openAiService as alibabaService } from './openAi.service';
import type { Intent, ChatMessage, RecentPlannerInput } from '../types';
import type { PlannerOutput } from '../types/planner.types';
import type { Agent } from '../types/agent.types';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import { config } from '../config';
import { trimChatHistory } from '../utils/trim-chat';
import { appLogger } from '../utils/logger.util';

// ============================================================
// Constants
// ============================================================

const MAX_SLOTS_PER_USER = 6; // Daily limit per user
const CACHE_PREFIX = 'episodic_memory:';
const CONTEXT_CACHE_TTL = 300; // 5 minutes
const LAST_CONTEXT_CACHE_TTL = 600; // 10 minutes

type MenuMemory = {
  user_id: string;
  app_name: string;
  menu: string[];
  created_at: Date;
};

// ============================================================
// Episodic Memory Service Class
// ============================================================

class EpisodicMemoryService {
  // In-memory cache for menu (lightweight, no DB needed)
  private lastMenuDb: MenuMemory[] = [];

  constructor() {
    appLogger.info('EpisodicMemoryService initialized', {
      maxSlotsPerUser: MAX_SLOTS_PER_USER,
      redisAvailable: globalCache.isRedisAvailable()
    });
  }

  // ============================================================
  // 1️⃣ SAVE MENU (AI show numbered menu)
  // ============================================================
  saveMenu(userId: string, app: string, menu: string[]): void {
    // Remove existing menu for this user+app
    this.lastMenuDb = this.lastMenuDb.filter(
      (m) => !(m.user_id === userId && m.app_name === app)
    );

    // Add new menu
    this.lastMenuDb.push({
      user_id: userId,
      app_name: app,
      menu,
      created_at: new Date(),
    });

    appLogger.debug('Menu stored', {
      userId,
      appName: app,
      menuLength: menu.length
    });
  }

  // ============================================================
  // 2️⃣ DETECT MENU SELECTION ("1" → rewrite intent)
  // ============================================================
  rewriteIfMenuSelection(userId: string, app: string, text: string): string {
    const clean = text.trim();

    // Check if input is a single digit 1-9
    if (!/^[1-9]$/.test(clean)) {
      return text;
    }

    const lastMenu = this.lastMenuDb.find(
      (m) => m.user_id === userId && m.app_name === app
    );

    if (!lastMenu) {
      return text;
    }

    const index = Number(clean) - 1;
    const selected = lastMenu.menu[index];

    if (!selected) {
      return text;
    }

    const rewritten = `Saya memilih menu: ${selected}`;
    appLogger.debug('Menu selection detected', {
      userId,
      appName: app,
      selectedIndex: index,
      selectedValue: selected
    });

    return rewritten;
  }

  // ============================================================
  // 3️⃣ UPSERT MEMORY SLOT (Core Feature)
  // ============================================================
  private async upsertMemory(
    intent: string | null,
    provider: string,
    llmModel: string,
    userId: string,
    app: string,
    summary: string,
    toolsUsed?: PlannerOutput
  ): Promise<EpisodicMemory> {
    if (!intent) {
      throw new Error('Intent not found');
    }
    const intentKey = intent;

    appLogger.debug('Upserting episodic memory', {
      userId,
      appName: app,
      intent: intentKey,
      summaryLength: summary.length
    });

    try {
      // Upsert in database
      const memory = await episodicMemoryRepository.upsert(userId, app, intentKey, {
        level: 'daily',
        summary,
        toolsUsed: toolsUsed || null,
      });

      // Enforce slot limit
      await this.enforceSlotLimit(userId, app);

      // Invalidate cache for this user+app
      await this.invalidateContextCache(userId, app);

      appLogger.info('Episodic memory upserted', {
        userId,
        appName: app,
        intent: intentKey,
        memoryId: memory.id
      });

      return memory;
    } catch (error) {
      appLogger.error('Failed to upsert episodic memory', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app,
        intent: intentKey
      });
      throw error;
    }
  }

  // ============================================================
  // 4️⃣ ENFORCE SLOT LIMIT (MAX_SLOTS_PER_USER)
  // ============================================================
  private async enforceSlotLimit(userId: string, app: string): Promise<void> {
    try {
      const count = await episodicMemoryRepository.countByUserAndApp(userId, app);

      if (count > MAX_SLOTS_PER_USER) {
        const deletedCount = await episodicMemoryRepository.deleteOldestToMaintainLimit(
          userId,
          app,
          MAX_SLOTS_PER_USER
        );

        appLogger.info('Slot limit enforced', {
          userId,
          appName: app,
          deletedCount,
          remainingSlots: count - deletedCount
        });

        // Invalidate cache after cleanup
        await this.invalidateContextCache(userId, app);
      }
    } catch (error) {
      appLogger.error('Failed to enforce slot limit', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });
    }
  }

  // ============================================================
  // 5️⃣ SUMMARIZE CONVERSATION → STORE MEMORY
  // ============================================================
  async summarize(
    agent: Agent,
    intent: string | null,
    userId: string,
    app: string,
    chatHistory: ChatMessage[],
    planSeen?: PlannerOutput
  ): Promise<string | null> {
    // Validate input
    if (!chatHistory || chatHistory.length < 2) {
      appLogger.debug('Skipping summary: insufficient chat history', {
        userId,
        appName: app,
        historyLength: chatHistory?.length || 0
      });
      return null;
    }

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama';
    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel;

    appLogger.debug('Summarizing conversation', {
      userId,
      appName: app,
      provider,
      llmModel
    });

    try {
      // Trim chat history for efficiency
      const trimmedHistory = trimChatHistory(chatHistory, {
        maxMessages: 2,
        maxLength: 200,
      });

      const conversationText = trimmedHistory
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      const prompt = `
ROLE: AI Memory Assistant.

Ringkas percakapan berikut menjadi 2 kalimat singkat (max 100 kata).
Fokus pada:
- tujuan user
- info penting user
- tool yang digunakan

Percakapan:
${conversationText}

Ringkasan:`.trim();

      const summary = (
        await alibabaService.chat(provider, llmModel, prompt)
      ).trim();

      appLogger.debug('Summary generated', {
        summaryLength: summary.length,
        summary: summary.substring(0, 100)
      });

      // Store memory
      await this.upsertMemory(intent, provider, llmModel, userId, app, summary, planSeen);

      return summary;
    } catch (error) {
      appLogger.error('Summarization failed', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });
      return null;
    }
  }

  // ============================================================
  // 6️⃣ GET RECENT CONTEXT (Redis Cache + DB Fallback)
  // ============================================================
  async getRecentContext(
    userId: string,
    app: string,
    limit = 5
  ): Promise<string> {
    const cacheKey = `${CACHE_PREFIX}context:${userId}:${app}`;

    try {
      // Try Redis cache first
      const cached = await globalCache.get<string>(cacheKey);
      if (cached) {
        appLogger.debug('Context cache HIT', {
          userId,
          appName: app,
          cacheKey
        });
        return cached;
      }

      // Cache miss - fetch from database
      appLogger.debug('Context cache MISS, fetching from DB', {
        userId,
        appName: app
      });

      const summaries = await episodicMemoryRepository.getRecentContext(
        userId,
        app,
        limit
      );

      if (summaries.length === 0) {
        return '';
      }

      const joined = summaries.map((s) => `• ${s}`).join('\n');
      const context = `
Context percakapan sebelumnya:
${joined}

Pesan saat ini:
`.trim();

      // Cache the result
      await globalCache.set(cacheKey, context, {
        ttl: CONTEXT_CACHE_TTL * 1000,
      });

      appLogger.debug('Context cached', {
        userId,
        appName: app,
        summaryCount: summaries.length
      });

      return context;
    } catch (error) {
      appLogger.error('Failed to get recent context', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });
      return '';
    }
  }

  // ============================================================
  // 7️⃣ GET LAST CONTEXT (Redis Cache + DB Fallback)
  // ============================================================
  async getLastContext(
    userId: string,
    app: string
  ): Promise<EpisodicMemory | null> {
    const cacheKey = `${CACHE_PREFIX}last:${userId}:${app}`;

    try {
      // Try Redis cache first
      const cached = await globalCache.get<EpisodicMemory>(cacheKey);
      if (cached) {
        appLogger.debug('Last context cache HIT', {
          userId,
          appName: app
        });
        return cached;
      }

      // Cache miss - fetch from database
      appLogger.debug('Last context cache MISS, fetching from DB', {
        userId,
        appName: app
      });

      const lastMemory = await episodicMemoryRepository.findLastByUserAndApp(
        userId,
        app
      );

      if (!lastMemory) {
        return null;
      }

      // const context = lastMemory.summary

      // Cache the result
      await globalCache.set(cacheKey, lastMemory, {
        ttl: LAST_CONTEXT_CACHE_TTL * 1000,
      });

      appLogger.debug('Last context cached', {
        userId,
        appName: app,
        memoryId: lastMemory.id
      });

      return lastMemory;
    } catch (error) {
      appLogger.error('Failed to get last context', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });
      return null;
    }
  }

  // ============================================================
  // 8️⃣ GET TOOL USAGE HINTS
  // ============================================================
  async getToolUsageHints(
    userId: string,
    app: string
  ): Promise<PlannerOutput> {
    try {
      const merged = await episodicMemoryRepository.getAggregatedToolUsage(
        userId,
        app
      );

      // appLogger.debug('Tool usage hints retrieved', {
      //   userId,
      //   appName: app,
      //   toolsCount: merged.tools?.length || 0,
      //   handlersCount: merged.handlers?.length || 0,
      //   knowledgeCount: merged.knowledge?.length || 0
      // });

      return merged;
    } catch (error) {
      appLogger.error('Failed to get tool usage hints', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });

      // Return empty planner on error
      return {
        mode: "single_step",
        tasks: [],
        chat: false,
      };
    }
  }

  // ============================================================
  // 9️⃣ CACHE INVALIDATION
  // ============================================================
  private async invalidateContextCache(
    userId: string,
    app: string
  ): Promise<void> {
    try {
      const contextKey = `${CACHE_PREFIX}context:${userId}:${app}`;
      const lastKey = `${CACHE_PREFIX}last:${userId}:${app}`;

      await globalCache.del(contextKey);
      await globalCache.del(lastKey);

      appLogger.debug('Context cache invalidated', {
        userId,
        appName: app
      });
    } catch (error) {
      appLogger.error('Failed to invalidate context cache', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });
    }
  }

  // ============================================================
  // 🔟 CLEAR USER MEMORY
  // ============================================================
  async clearUserMemory(userId: string, app: string): Promise<void> {
    try {
      // Delete from database
      await episodicMemoryRepository.deleteByUserAndApp(userId, app);

      // Invalidate cache
      await this.invalidateContextCache(userId, app);

      appLogger.info('User memory cleared', {
        userId,
        appName: app
      });
    } catch (error) {
      appLogger.error('Failed to clear user memory', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });
      throw error;
    }
  }

  // ============================================================
  // 1️⃣1️⃣ GET USER MEMORY STATS
  // ============================================================
  async getUserMemoryStats(
    userId: string,
    app: string
  ): Promise<{
    slotCount: number;
    maxSlots: number;
    usagePercentage: number;
  }> {
    try {
      const count = await episodicMemoryRepository.countByUserAndApp(userId, app);

      return {
        slotCount: count,
        maxSlots: MAX_SLOTS_PER_USER,
        usagePercentage: (count / MAX_SLOTS_PER_USER) * 100,
      };
    } catch (error) {
      appLogger.error('Failed to get user memory stats', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });

      return {
        slotCount: 0,
        maxSlots: MAX_SLOTS_PER_USER,
        usagePercentage: 0,
      };
    }
  }

  // ============================================================
  // 1️⃣2️⃣ DEBUG UTILS
  // ============================================================
  async debugDump(userId?: string, app?: string): Promise<EpisodicMemory[]> {
    try {
      if (userId && app) {
        return await episodicMemoryRepository.findByUserAndApp(userId, app, 20);
      }

      // Return all (for debugging)
      return [];
    } catch (error) {
      appLogger.error('Failed to debug dump', {
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  }

  // ============================================================
  // 1️⃣3️⃣ HEALTH CHECK
  // ============================================================
  async isHealthy(): Promise<boolean> {
    try {
      // Test repository connection
      await episodicMemoryRepository.countByUserAndApp('health_check', 'test');
      return true;
    } catch (error) {
      appLogger.error('Episodic memory health check failed', {
        error: error instanceof Error ? error.message : error
      });
      return false;
    }
  }
}

export const episodicMemoryService = new EpisodicMemoryService();
