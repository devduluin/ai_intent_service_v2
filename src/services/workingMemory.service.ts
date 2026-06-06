// services/workingMemory.service.ts
import { globalCache } from '../utils/cache-helper.util';
import { appLogger } from '../utils/logger.util';
import type {WorkingMemoryData, WorkingMemoryOptions, WorkingMemoryResult } from '../types/working-memory.type';
import type { ActiveOffer, ActiveOfferStatus } from '../types/active-offer.types';

// ============================================================
// WORKING MEMORY SERVICE
// ============================================================

class WorkingMemoryService {
  private readonly DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
  private readonly CACHE_KEY_PREFIX = 'workingMemory';

  /**
   * Generate cache key dari userId dan appName
   */
  private getCacheKey(userId: string, appName: string): string {
    return `${this.CACHE_KEY_PREFIX}:${userId}:${appName}`;
  }

  /**
   * CREATE - Buat working memory baru
   * @param userId - User identifier
   * @param appName - App name
   * @param data - Initial working memory data
   * @param options - Optional configuration
   */
  async create(
    userId: string,
    appName: string,
    data: Partial<WorkingMemoryData> = {},
    options?: WorkingMemoryOptions
  ): Promise<WorkingMemoryResult> {
    try {
      const cacheKey = this.getCacheKey(userId, appName);
      const now = Date.now();

      // Check if already exists
      const existing = await this.get(userId, appName);
      if (existing) {
        // appLogger.warn('[WorkingMemory] Memory already exists, updating instead', {
        //   userId,
        //   appName
        // });
        return await this.update(userId, appName, data, options);
      }

      // Create new memory
      const memoryData: WorkingMemoryData = {
        ...data,
        metadata: {
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 1,
          ...data.metadata
        }
      };

      await globalCache.set(cacheKey, memoryData, {
        ttl: options?.ttl || this.DEFAULT_TTL
      });

      // appLogger.info('[WorkingMemory] Created new memory', {
      //   userId,
      //   appName,
      //   activeIntent: data.activeIntent,
      //   activeWorkflow: data.activeWorkflow
      // });

      return {
        success: true,
        data: memoryData
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appLogger.error('[WorkingMemory] Create failed', {
        userId,
        appName,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * READ - Ambil working memory yang ada
   * @param userId - User identifier
   * @param appName - App name
   */
  async get(
    userId: string,
    appName: string
  ): Promise<WorkingMemoryData | null> {
    try {
      const cacheKey = this.getCacheKey(userId, appName);
      
      // appLogger.debug('[WorkingMemory] GET START', {
      //   cacheKey,
      //   userId,
      //   appName
      // });
      
      const memory = await globalCache.get<WorkingMemoryData>(cacheKey);

      if (memory) {
        // Update lastAccessedAt dan accessCount
        memory.metadata = {
          ...memory.metadata,
          lastAccessedAt: Date.now(),
          accessCount: (memory.metadata?.accessCount || 0) + 1
        };

        // Update di cache tanpa mengubah TTL
        await globalCache.set(cacheKey, memory, { skipRedis: false });
        
        // appLogger.debug('[WorkingMemory] Memory retrieved', {
        //   userId,
        //   appName,
        //   cacheKey,
        //   activeIntent: memory.activeIntent,
        //   activeTool: memory.activeTool,
        //   accessCount: memory.metadata?.accessCount,
        //   hasContinuationHints: !!memory.continuationHints,
        //   lastToolSlug: memory.continuationHints?.lastToolSlug
        // });
      } else {
        // appLogger.debug('[WorkingMemory] Memory not found', {
        //   userId,
        //   appName,
        //   cacheKey
        // });
      }

      return memory;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appLogger.error('[WorkingMemory] Get failed', {
        userId,
        appName,
        error: errorMessage
      });

      return null;
    }
  }

  /**
   * UPDATE - Update working memory yang ada (merge dengan data lama)
   * @param userId - User identifier
   * @param appName - App name
   * @param data - Data yang akan di-update/merge
   * @param options - Optional configuration
   */
  async update(
    userId: string,
    appName: string,
    data: Partial<WorkingMemoryData>,
    options?: WorkingMemoryOptions
  ): Promise<WorkingMemoryResult> {
    try {
      const cacheKey = this.getCacheKey(userId, appName);
      const now = Date.now();

      // appLogger.debug('[WorkingMemory] UPDATE START', {
      //   cacheKey,
      //   userId,
      //   appName,
      //   dataKeys: Object.keys(data),
      //   activeTool: data.activeTool,
      //   activeIntent: data.activeIntent
      // });

      // Get existing memory
      const existing = await this.get(userId, appName);

      if (!existing) {
        // appLogger.warn('[WorkingMemory] Memory not found, creating new one', {
        //   userId,
        //   appName,
        //   cacheKey
        // });
        return await this.create(userId, appName, data, options);
      }

      // appLogger.debug('[WorkingMemory] Memory found, merging', {
      //   existingActiveTool: existing.activeTool,
      //   existingActiveIntent: existing.activeIntent
      // });

      // Merge data (deep merge untuk activeEntities dan continuationHints)
      // IMPORTANT: Don't overwrite activeTool if new data doesn't have it or has wrong value
      const updatedData: WorkingMemoryData = {
        ...existing,
        // Only override activeTool if new data has a valid tool slug (not intent slug)
        ...(data.activeTool && !data.activeTool.includes('utilities') && !data.activeTool.includes('greeting') 
          ? { activeTool: data.activeTool } 
          : { activeTool: existing.activeTool }),
        // Only override activeIntent if new data has it
        ...(data.activeIntent ? { activeIntent: data.activeIntent } : {}),
        ...(data.activeSkill ? { activeSkill: data.activeSkill } : {}),
        ...(data.activePlan !== undefined ? { activePlan: data.activePlan } : {}),
        ...(data.activeOffer !== undefined ? { activeOffer: data.activeOffer } : {}),
        ...(data.offerHistory !== undefined ? { offerHistory: data.offerHistory } : {}),
        // Only override activeWorkflow if new data has it
        ...(data.activeWorkflow ? { activeWorkflow: data.activeWorkflow } : {}),
        activeEntities: {
          ...existing.activeEntities,
          ...data.activeEntities
        },
        continuationHints: {
          ...existing.continuationHints,
          ...data.continuationHints
        },
        metadata: {
          ...existing.metadata,
          ...data.metadata,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: (existing.metadata?.accessCount || 0) + 1
        }
      };

      // appLogger.debug('[WorkingMemory] SETTING TO CACHE', {
      //   cacheKey,
      //   ttl: options?.ttl || this.DEFAULT_TTL,
      //   ttlMinutes: (options?.ttl || this.DEFAULT_TTL) / 1000 / 60,
      //   hasActiveTool: !!updatedData.activeTool
      // });

      await globalCache.set(cacheKey, updatedData, {
        ttl: options?.ttl || this.DEFAULT_TTL
      });

      // Verify save
      // const saved = await globalCache.get<WorkingMemoryData>(cacheKey);
      // appLogger.debug('[WorkingMemory] CACHE SAVE VERIFIED', {
      //   cacheKey,
      //   saved: !!saved,
      //   savedActiveTool: saved?.activeTool,
      //   savedActiveIntent: saved?.activeIntent
      // });

      // appLogger.info('[WorkingMemory] Memory updated', {
      //   userId,
      //   appName,
      //   updatedFields: Object.keys(data),
      //   activeIntent: updatedData.activeIntent,
      //   activeWorkflow: updatedData.activeWorkflow,
      //   activeTool: updatedData.activeTool
      // });

      return {
        success: true,
        data: updatedData
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appLogger.error('[WorkingMemory] Update failed', {
        userId,
        appName,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async setActiveOffer(
    userId: string,
    appName: string,
    offer: ActiveOffer | null
  ): Promise<WorkingMemoryResult> {
    const existing = await this.get(userId, appName);
    const history = [...(existing?.offerHistory || [])];

    if (existing?.activeOffer?.status === 'active' && offer?.id !== existing.activeOffer.id) {
      history.unshift({
        id: existing.activeOffer.id,
        type: existing.activeOffer.type,
        status: 'cleared',
        timestamp: Date.now()
      });
    }

    return this.update(userId, appName, {
      activeOffer: offer,
      offerHistory: history.slice(0, 20)
    });
  }

  async updateActiveOfferStatus(
    userId: string,
    appName: string,
    status: Exclude<ActiveOfferStatus, 'active'>
  ): Promise<WorkingMemoryResult> {
    const existing = await this.get(userId, appName);
    if (!existing?.activeOffer) {
      return { success: true, data: existing };
    }

    const history = [
      {
        id: existing.activeOffer.id,
        type: existing.activeOffer.type,
        status,
        timestamp: Date.now()
      },
      ...(existing.offerHistory || [])
    ].slice(0, 20);

    return this.update(userId, appName, {
      activeOffer: null,
      offerHistory: history
    });
  }

  /**
   * DELETE - Hapus working memory
   * @param userId - User identifier
   * @param appName - App name
   */
  async delete(
    userId: string,
    appName: string
  ): Promise<WorkingMemoryResult> {
    try {
      const cacheKey = this.getCacheKey(userId, appName);

      // Check if exists
      const existing = await this.get(userId, appName);
      if (!existing) {
        // appLogger.debug('[WorkingMemory] Memory not found, nothing to delete', {
        //   userId,
        //   appName
        // });
        return {
          success: true,
          data: null
        };
      }

      // Delete from cache
      await globalCache.del(cacheKey);

      // appLogger.info('[WorkingMemory] Memory deleted', {
      //   userId,
      //   appName,
      //   activeIntent: existing.activeIntent,
      //   activeWorkflow: existing.activeWorkflow
      // });

      return {
        success: true,
        data: existing // Return deleted data for reference
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appLogger.error('[WorkingMemory] Delete failed', {
        userId,
        appName,
        error: errorMessage
      });

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * CLEAR - Hapus semua working memory (untuk cleanup)
   * @param pattern - Optional pattern untuk filter (default: semua)
   */
  async clear(pattern?: string): Promise<void> {
    try {
      const cachePattern = pattern
        ? `${this.CACHE_KEY_PREFIX}:${pattern}`
        : `${this.CACHE_KEY_PREFIX}:*`;

      await globalCache.clear(cachePattern);

      // appLogger.info('[WorkingMemory] All memory cleared', {
      //   pattern: pattern || 'all'
      // });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appLogger.error('[WorkingMemory] Clear failed', {
        error: errorMessage
      });
      throw error;
    }
  }

  /**
   * UPDATE SPECIFIC FIELD - Update field tertentu saja
   * @param userId - User identifier
   * @param appName - App name
   * @param field - Field name yang akan di-update
   * @param value - Value baru
   */
  async updateField<T extends keyof WorkingMemoryData>(
    userId: string,
    appName: string,
    field: T,
    value: WorkingMemoryData[T]
  ): Promise<WorkingMemoryResult> {
    return this.update(userId, appName, { [field]: value });
  }

  /**
   * ADD ENTITY - Tambah entity ke activeEntities
   * @param userId - User identifier
   * @param appName - App name
   * @param entityKey - Key entity (misal: 'leaveType')
   * @param entityValue - Value entity
   */
  async addEntity(
    userId: string,
    appName: string,
    entityKey: string,
    entityValue: unknown
  ): Promise<WorkingMemoryResult> {
    const existing = await this.get(userId, appName);
    if (!existing) {
      return await this.create(userId, appName, {
        activeEntities: { [entityKey]: entityValue }
      });
    }

    return this.update(userId, appName, {
      activeEntities: { [entityKey]: entityValue }
    });
  }

  /**
   * REMOVE ENTITY - Hapus entity dari activeEntities
   * @param userId - User identifier
   * @param appName - App name
   * @param entityKey - Key entity yang akan dihapus
   */
  async removeEntity(
    userId: string,
    appName: string,
    entityKey: string
  ): Promise<WorkingMemoryResult> {
    const existing = await this.get(userId, appName);
    if (!existing || !existing.activeEntities) {
      return {
        success: true,
        data: null
      };
    }

    const { [entityKey]: _, ...remainingEntities } = existing.activeEntities;

    return this.update(userId, appName, {
      activeEntities: remainingEntities
    });
  }

  /**
   * SET CONTINUATION HINT - Set hint untuk continuation
   * @param userId - User identifier
   * @param appName - App name
   * @param hintKey - Hint key (misal: 'canExport')
   * @param value - Hint value (boolean)
   */
  async setContinuationHint(
    userId: string,
    appName: string,
    hintKey: string,
    value: boolean
  ): Promise<WorkingMemoryResult> {
    return this.update(userId, appName, {
      continuationHints: { [hintKey]: value }
    });
  }

  /**
   * EXISTS - Cek apakah working memory ada
   * @param userId - User identifier
   * @param appName - App name
   */
  async exists(userId: string, appName: string): Promise<boolean> {
    const memory = await this.get(userId, appName);
    return memory !== null;
  }

  /**
   * GET STATS - Dapatkan statistik working memory
   */
  async getStats(userId: string, appName: string): Promise<{
    exists: boolean;
    age?: number; // dalam milliseconds
    accessCount?: number;
    activeIntent?: string;
    activeWorkflow?: string;
  } | null> {
    const memory = await this.get(userId, appName);
    if (!memory) {
      return null;
    }

    const now = Date.now();
    const createdAt = memory.metadata?.createdAt || now;
    const age = now - createdAt;

    return {
      exists: true,
      age,
      accessCount: memory.metadata?.accessCount || 0,
      activeIntent: memory.activeIntent || undefined,
      activeWorkflow: memory.activeWorkflow || undefined
    };
  }
}

// Singleton instance
export const workingMemoryService = new WorkingMemoryService();
