import { openAiService } from './openAi.service';
import { episodicMemoryRepository } from '../repositories/episodic-memory.repository';
import { globalCache } from '../utils/cache-helper.util';
import { openAiService as alibabaService } from './openAi.service';
import type { ChatMessage } from '../types';
import type { PlannerOutput, RecentUsageHints } from '../types/planner.types';  // ✅ ADDED RecentUsageHints
import type { Agent } from '../types/agent.types';
import type { EpisodicMemory } from '../types/episodic-memory.types';
import type { EpisodicMemoryWriteContext } from '../types/episodic-memory-write.types';
import { config } from '../config';
import { trimChatHistory } from '../utils/trim-chat';
import { appLogger } from '../utils/logger.util';

// ============================================================
// Constants
// ============================================================

const MAX_SLOTS_PER_USER = config.memory.maxRowMemoryPerUser; // ✅ Use config (25) instead of hardcoded 6
const CACHE_PREFIX = 'episodic_memory:';
const CONTEXT_CACHE_TTL = 60 * 30; // 1800 sec
const LAST_CONTEXT_CACHE_TTL = 60 * 60; // 3600 sec
const MAX_MENU_CACHE_SIZE = 100; // Limit menu cache size
const MENU_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_RETRIES = 3; // For summarization retries
const RETRY_DELAY_MS = 1000; // Base delay for retries

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
  private pendingRequests = new Map<string, Promise<string>>();

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
    // Clean up expired entries first
    this.cleanupExpiredMenus();
    
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

  // Cleanup expired menu entries
  private cleanupExpiredMenus(): void {
    const now = Date.now();
    const initialSize = this.lastMenuDb.length;
    
    this.lastMenuDb = this.lastMenuDb.filter(menu => 
      now - menu.created_at.getTime() < MENU_CACHE_TTL_MS
    );
    
    // Limit array size to prevent memory leaks
    if (this.lastMenuDb.length > MAX_MENU_CACHE_SIZE) {
      this.lastMenuDb = this.lastMenuDb.slice(-MAX_MENU_CACHE_SIZE);
    }
    
    const cleanedCount = initialSize - this.lastMenuDb.length;
    if (cleanedCount > 0) {
      appLogger.debug('Menu cache cleaned', { cleanedCount, remainingSize: this.lastMenuDb.length });
    }
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

    // Clean up expired entries on access
    this.cleanupExpiredMenus();

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
    toolsUsed?: PlannerOutput,
    writeContext?: Partial<EpisodicMemoryWriteContext>
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
        toolsUsed: writeContext?.taskPlan || toolsUsed || null,
        topicKey: writeContext?.topicKey || intentKey,
        topicLabel: writeContext?.topicLabel || null,
        flowStage: writeContext?.flowStage || null,
        taskPlan: writeContext?.taskPlan || toolsUsed || null,
        flowTrace: writeContext?.flowTrace || null,
        memoryMeta: writeContext?.memoryMeta || null,
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
  // 5️⃣ SUMMARIZE CONVERSATION → STORE MEMORY (with retry logic)
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
      return null;
    }

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama';
    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel;

    // Retry logic for summarization
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Trim chat history for efficiency
        const trimmedHistory = trimChatHistory(chatHistory, {
          maxMessages: 2,
          maxLength: 512,
        });

        const conversationText = trimmedHistory
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n');

        const prompt = `
ROLE: AI Memory Assistant.

Ringkas percakapan berikut menjadi kalimat singkat.
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

        // Store memory
        await this.upsertMemory(
          this.normalizeLegacyIntent(intent),
          provider,
          llmModel,
          userId,
          app,
          summary,
          planSeen,
          {
            topicKey: this.normalizeLegacyIntent(intent),
            flowStage: this.inferLegacyFlowStage(intent),
            taskPlan: planSeen || null
          }
        );

        if (attempt > 1) {
          appLogger.info('Summarization succeeded after retry', { attempt, userId, appName: app });
        }

        return summary;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < MAX_RETRIES) {
          const delayMs = RETRY_DELAY_MS * attempt;
          appLogger.warn(`Summarization attempt ${attempt} failed, retrying in ${delayMs}ms`, {
            error: lastError.message,
            userId,
            appName: app
          });
          await this.delay(delayMs);
        }
      }
    }

    // All retries failed
    appLogger.error('Summarization failed after all retries', {
      error: lastError?.message,
      userId,
      appName: app
    });
    return null;
  }

  async summarizeWithContext(input: {
    agent: Agent;
    userId: string;
    appName: string;
    messages: ChatMessage[];
    writeContext: EpisodicMemoryWriteContext;
  }): Promise<string | null> {
    const summary = await this.summarize(
      input.agent,
      input.writeContext.topicKey,
      input.userId,
      input.appName,
      input.messages,
      input.writeContext.taskPlan || undefined
    );

    if (!summary) {
      return null;
    }

    // summarize() already wrote a normalized row. Re-upsert metadata because the
    // legacy wrapper cannot receive the full context without changing callers.
    await this.upsertMemory(
      input.writeContext.topicKey,
      input.agent.llmModel?.provider || config.default?.provider || 'ollama',
      input.agent.llmModel?.modelCode || config.ollama?.llmModel,
      input.userId,
      input.appName,
      summary,
      input.writeContext.taskPlan || undefined,
      input.writeContext
    );

    return summary;
  }

  private normalizeLegacyIntent(intent: string | null): string {
    if (!intent) return 'general_chat';
    if (intent.startsWith('offer:')) return 'internal_flow:offer';
    if (intent.startsWith('continuation:')) return 'internal_flow:continuation';
    if (['slot_filling', 'continuation_fallback', 'continuation_error', 'error'].includes(intent)) {
      return `internal_flow:${intent}`;
    }
    return intent;
  }

  private inferLegacyFlowStage(intent: string | null): EpisodicMemoryWriteContext['flowStage'] {
    if (!intent) return 'general_chat';
    if (intent.startsWith('offer:')) return 'offer_accepted';
    if (intent.startsWith('continuation:')) return 'continuation';
    if (intent === 'comparison') return 'comparison';
    if (intent === 'slot_filling') return 'slot_filling';
    if (intent === 'error') return 'error';
    if (intent === 'general_chat') return 'general_chat';
    return 'main_pipeline';
  }

  // Helper method for delay
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // 6️⃣ GET RECENT CONTEXT (Redis Cache + DB Fallback + Deduplication)
  // ============================================================
  async getRecentContext(
    userId: string,
    app: string,
    limit = 5
  ): Promise<string> {
    const cacheKey = `${CACHE_PREFIX}context:${userId}:${app}`;
    const dedupKey = `${userId}:${app}:${limit}`;

    // Check for pending request to prevent duplicate DB calls
    if (this.pendingRequests.has(dedupKey)) {
      appLogger.debug('Reusing pending context request', { userId, appName: app });
      return this.pendingRequests.get(dedupKey)!;
    }

    const promise = this.fetchRecentContextWithCache(cacheKey, userId, app, limit);
    this.pendingRequests.set(dedupKey, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      // Clean up pending request after completion
      this.pendingRequests.delete(dedupKey);
    }
  }

  private async fetchRecentContextWithCache(
    cacheKey: string,
    userId: string,
    app: string,
    limit: number
  ): Promise<string> {
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
        // Cache empty result briefly to prevent DB hammering
        await globalCache.set(cacheKey, '', { ttl: 60 }); // Cache empty for 1 minute
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
        ttl: CONTEXT_CACHE_TTL,
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
        // Cache null result briefly to prevent DB hammering
        await globalCache.set(cacheKey, null, { ttl: 60 });
        return null;
      }

      // Cache the result
      await globalCache.set(cacheKey, lastMemory, {
        ttl: LAST_CONTEXT_CACHE_TTL,
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
  // 8️⃣ GET TOOL USAGE HINTS (with caching)
  // ============================================================
  async getToolUsageHints(
    userId: string,
    app: string
  ): Promise<RecentUsageHints> {  // ✅ CHANGED FROM PlannerOutput
    const cacheKey = `${CACHE_PREFIX}tools:${userId}:${app}`;

    try {
      // Try cache first
      const cached = await globalCache.get<RecentUsageHints>(cacheKey);
      if (cached) {
        return cached;
      }

      const merged = await episodicMemoryRepository.getAggregatedToolUsage(
        userId,
        app
      );

      // Convert from PlannerOutput to RecentUsageHints
      const result: RecentUsageHints = {
        tasks: merged.tasks || [],
        chat: merged.chat,
        hasDependencies: merged.tasks?.some(t => t.depends_on && t.depends_on.length > 0)
      };

      // Cache tool hints (shorter TTL since tools may change)
      await globalCache.set(cacheKey, result, { ttl: 300 }); // 5 minutes

      return result;
    } catch (error) {
      appLogger.error('Failed to get tool usage hints', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName: app
      });

      // Return empty hints on error
      return {
        tasks: [],
        chat: false,
        hasDependencies: false
      };
    }
  }

  // ============================================================
  // 9️⃣ CACHE INVALIDATION (optimized for batch delete)
  // ============================================================
  private async invalidateContextCache(
    userId: string,
    app: string
  ): Promise<void> {
    try {
      const contextKey = `${CACHE_PREFIX}context:${userId}:${app}`;
      const lastKey = `${CACHE_PREFIX}last:${userId}:${app}`;
      const toolsKey = `${CACHE_PREFIX}tools:${userId}:${app}`;

      // Batch delete for efficiency
      await Promise.all([
        globalCache.del(contextKey),
        globalCache.del(lastKey),
        globalCache.del(toolsKey)
      ]);

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

      // Also clear menu cache for this user
      this.lastMenuDb = this.lastMenuDb.filter(
        (m) => !(m.user_id === userId && m.app_name === app)
      );

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
  // 1️⃣1️⃣ GET USER MEMORY STATS (with caching)
  // ============================================================
  async getUserMemoryStats(
    userId: string,
    app: string
  ): Promise<{
    slotCount: number;
    maxSlots: number;
    usagePercentage: number;
  }> {
    const cacheKey = `${CACHE_PREFIX}stats:${userId}:${app}`;

    try {
      // Try cache first (short TTL for stats)
      const cached = await globalCache.get<{
        slotCount: number;
        maxSlots: number;
        usagePercentage: number;
      }>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const count = await episodicMemoryRepository.countByUserAndApp(userId, app);
      
      const stats = {
        slotCount: count,
        maxSlots: MAX_SLOTS_PER_USER,
        usagePercentage: (count / MAX_SLOTS_PER_USER) * 100,
      };

      // Cache stats for 30 seconds
      await globalCache.set(cacheKey, stats, { ttl: 30 });

      return stats;
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
  // 1️⃣3️⃣ HEALTH CHECK (with timeout)
  // ============================================================
  async isHealthy(): Promise<boolean> {
    try {
      // Add timeout to health check
      const timeoutPromise = new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 5000);
      });
      
      const healthCheckPromise = (async () => {
        await episodicMemoryRepository.countByUserAndApp('health_check', 'test');
        return true;
      })();
      
      return await Promise.race([healthCheckPromise, timeoutPromise]);
    } catch (error) {
      appLogger.error('Episodic memory health check failed', {
        error: error instanceof Error ? error.message : error
      });
      return false;
    }
  }
}

export const episodicMemoryService = new EpisodicMemoryService();
