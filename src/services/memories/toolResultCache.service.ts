// services/toolResultCache.service.ts
import { appLogger } from '../../utils/logger.util';
import { globalCache } from '../../utils/cache-helper.util';
import { hashParams } from '../../utils/hash.util';

interface CachedToolResult {
  result: unknown;
  toolSlug?: string;      // For tool-based results
  handlerSlug?: string;   // For handler-based results (xls_generator, data_analyzer)
  intent: string;
  entities: Record<string, unknown>;
  params?: Record<string, unknown>;  // NEW: Store params for entity detection
  timestamp: number;
  ttl: number; // Time to live in ms
}

interface CacheOptions {
  ttl?: number;
  skipRedis?: boolean;
  strictParams?: boolean;
  allowLegacyFallback?: boolean;
  allowLatestFallback?: boolean;
}

class ToolResultCacheService {
  private readonly DEFAULT_TTL = 15 * 1000; // 15 seconds
  private readonly CACHE_KEY_PREFIX = 'toolResult';

  /**
   * Store tool execution result
   * Phase 3 Enhancement: Now includes params for entity-specific caching
   */
  async store(
    sessionKey: string,
    toolSlug: string,
    intent: string,
    result: unknown,
    entities: Record<string, unknown>,
    params?: Record<string, unknown>,  // NEW: Parameters for entity-specific caching
    options?: CacheOptions
  ): Promise<void> {
    const ttl = options?.ttl || this.DEFAULT_TTL;
    const normalizedParams = params ? this.normalizeCacheParams(params) : undefined;
    
    // NEW: Generate cache key with params hash
    const cacheKey = normalizedParams 
      ? this.getParamCacheKey(sessionKey, toolSlug, normalizedParams)
      : this.getCacheKey(sessionKey, intent);

    const cacheData: CachedToolResult = {
      result,
      toolSlug,
      intent,
      entities,
      params: normalizedParams,  // Store params for entity detection
      timestamp: Date.now(),
      ttl
    };

    try {
      // Store in global cache (Redis + Memory)
      await globalCache.set(cacheKey, cacheData, {
        ttl,
        skipRedis: options?.skipRedis
      });

      appLogger.info('[ToolResultCache] Stored', {
        sessionKey,
        toolSlug,
        intent,
        cacheKey,
        ttl,
        usingRedis: globalCache.isRedisAvailable() && !options?.skipRedis,
        params: normalizedParams,
        entities: entities
      });
    } catch (error) {
      appLogger.error('[ToolResultCache] Failed to store', {
        sessionKey,
        toolSlug,
        intent,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get last result for session and intent
   * Phase 3 Enhancement: Now supports param-based lookup for entity detection
   */
  async get(
    sessionKey: string,
    intent?: string,
    options?: CacheOptions,
    params?: Record<string, unknown>  // NEW: For entity-specific cache lookup
  ): Promise<CachedToolResult | null> {
    const normalizedParams = params ? this.normalizeCacheParams(params) : undefined;

    // Try with specific intent and params first (most specific)
    if (intent && normalizedParams) {
      const paramKey = this.getParamCacheKey(sessionKey, intent, normalizedParams);
      const cached = await globalCache.get<CachedToolResult>(paramKey, {
        skipRedis: options?.skipRedis
      });

      if (cached && !this.isExpired(cached)) {
        appLogger.debug('[ToolResultCache] Cache hit (param-specific)', {
          sessionKey,
          intent,
          paramHash: hashParams(normalizedParams),
          cacheKey: paramKey
        });
        return cached;
      }

      if (options?.strictParams) {
        appLogger.debug('[ToolResultCache] Strict param cache miss', {
          sessionKey,
          intent,
          paramHash: hashParams(normalizedParams),
          cacheKey: paramKey
        });
        return null;
      }
    }

    // Try with specific intent (legacy support)
    if (intent && options?.allowLegacyFallback !== false) {
      const specificKey = this.getCacheKey(sessionKey, intent);
      const cached = await globalCache.get<CachedToolResult>(specificKey, {
        skipRedis: options?.skipRedis
      });

      if (cached && !this.isExpired(cached)) {
        appLogger.debug('[ToolResultCache] Cache hit (specific intent)', {
          sessionKey,
          intent,
          cacheKey: specificKey
        });
        return cached;
      }
    }

    // Try to get latest result for session (any intent)
    // Note: This requires scanning memory cache only (Redis doesn't support pattern scan efficiently)
    if (options?.allowLatestFallback === false) {
      appLogger.debug('[ToolResultCache] Cache miss without latest fallback', {
        sessionKey,
        intent
      });
      return null;
    }

    const sessionResults = await this.getLatestForSession(sessionKey, options?.skipRedis);

    if (sessionResults) {
      appLogger.debug('[ToolResultCache] Cache hit (latest session)', {
        sessionKey,
        toolSlug: sessionResults.toolSlug,
        intent: sessionResults.intent
      });
      return sessionResults;
    }

    appLogger.debug('[ToolResultCache] Cache miss', {
      sessionKey,
      intent
    });

    return null;
  }

  /**
   * Get last result for specific tool
   */
  async getByTool(sessionKey: string, toolSlug: string, options?: CacheOptions): Promise<CachedToolResult | null> {
    // Get all session results and filter by tool
    const sessionResults = await this.getLatestForSession(sessionKey, options?.skipRedis);

    if (sessionResults && sessionResults.toolSlug === toolSlug && !this.isExpired(sessionResults)) {
      appLogger.debug('[ToolResultCache] Cache hit (by tool)', {
        sessionKey,
        toolSlug,
        intent: sessionResults.intent
      });
      return sessionResults;
    }

    appLogger.debug('[ToolResultCache] Cache miss (by tool)', {
      sessionKey,
      toolSlug
    });

    return null;
  }

  /**
   * Clear session cache
   */
  async clearSession(sessionKey: string, options?: CacheOptions): Promise<void> {
    try {
      // Clear from global cache (pattern-based)
      await globalCache.clear(`${this.CACHE_KEY_PREFIX}:${sessionKey}:*`);

      appLogger.info('[ToolResultCache] Cleared session', {
        sessionKey,
        usingRedis: globalCache.isRedisAvailable() && !options?.skipRedis
      });
    } catch (error) {
      appLogger.error('[ToolResultCache] Failed to clear session', {
        sessionKey,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Clear specific intent cache
   */
  async clearIntent(sessionKey: string, intent: string, options?: CacheOptions): Promise<void> {
    const cacheKey = this.getCacheKey(sessionKey, intent);

    try {
      await globalCache.del(cacheKey, {
        skipRedis: options?.skipRedis
      });

      appLogger.debug('[ToolResultCache] Cleared intent', {
        sessionKey,
        intent,
        cacheKey
      });
    } catch (error) {
      appLogger.error('[ToolResultCache] Failed to clear intent', {
        sessionKey,
        intent,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Clear all expired sessions (maintenance, call periodically)
   */
  async clearExpiredSessions(): Promise<void> {
    try {
      const stats = globalCache.getStats();
      const now = Date.now();
      let clearedCount = 0;

      // Scan memory cache for expired entries
      for (const key of stats.memory.keys) {
        if (key.startsWith(`${this.CACHE_KEY_PREFIX}:`)) {
          const cached = await globalCache.get<CachedToolResult>(key, { skipRedis: true });
          if (cached && this.isExpired(cached)) {
            await globalCache.del(key, { skipRedis: true });
            clearedCount++;
          }
        }
      }

      if (clearedCount > 0) {
        appLogger.info('[ToolResultCache] Cleared expired sessions', {
          clearedCount,
          remainingKeys: stats.memory.keys.length - clearedCount
        });
      }
    } catch (error) {
      appLogger.error('[ToolResultCache] Failed to clear expired sessions', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get session stats for monitoring
   */
  async getSessionStats(sessionKey: string): Promise<{
    keyCount: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  } | null> {
    try {
      const stats = globalCache.getStats();
      const sessionKeys = stats.memory.keys.filter(k => 
        k.startsWith(`${this.CACHE_KEY_PREFIX}:${sessionKey}:`)
      );

      if (sessionKeys.length === 0) {
        return null;
      }

      let totalSize = 0;
      let oldestEntry: number | null = null;
      let newestEntry: number | null = null;

      for (const key of sessionKeys) {
        const cached = await globalCache.get<CachedToolResult>(key, { skipRedis: true });
        if (cached) {
          totalSize += JSON.stringify(cached).length;
          if (!oldestEntry || cached.timestamp < oldestEntry) {
            oldestEntry = cached.timestamp;
          }
          if (!newestEntry || cached.timestamp > newestEntry) {
            newestEntry = cached.timestamp;
          }
        }
      }

      return {
        keyCount: sessionKeys.length,
        totalSize,
        oldestEntry,
        newestEntry
      };
    } catch (error) {
      appLogger.error('[ToolResultCache] Failed to get session stats', {
        sessionKey,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Check if cached result is expired
   */
  private isExpired(cached: CachedToolResult): boolean {
    return Date.now() - cached.timestamp > cached.ttl;
  }

  /**
   * Get latest result for session (helper method)
   */
  private async getLatestForSession(sessionKey: string, skipRedis?: boolean): Promise<CachedToolResult | null> {
    // Try to get from memory cache by scanning keys
    // This is a limitation - we can't efficiently scan Redis for pattern
    // For production use, consider storing session->keys mapping in Redis
    const sessionPrefix = `${this.CACHE_KEY_PREFIX}:${sessionKey}:`;

    // Get all keys from memory cache that match session
    const memoryCacheStats = globalCache.getStats();
    const sessionKeys = memoryCacheStats.memory.keys.filter(k => k.startsWith(sessionPrefix));

    if (sessionKeys.length === 0) {
      return null;
    }

    // Get all values and find latest non-expired
    const results: CachedToolResult[] = [];

    for (const key of sessionKeys) {
      const cached = await globalCache.get<CachedToolResult>(key, { skipRedis: true });
      if (cached && !this.isExpired(cached)) {
        results.push(cached);
      }
    }

    if (results.length === 0) {
      return null;
    }

    // Return latest
    return results.sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  /**
   * Generate cache key
   */
  private getCacheKey(sessionKey: string, intent: string): string {
    return `${this.CACHE_KEY_PREFIX}:${sessionKey}:${intent}`;
  }

  private getParamCacheKey(
    sessionKey: string,
    toolSlug: string,
    params: Record<string, unknown>
  ): string {
    return `${this.CACHE_KEY_PREFIX}:${sessionKey}:${toolSlug}:${hashParams(params)}`;
  }

  private normalizeCacheParams(params: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};
    const semanticTextKeys = new Set(['search', 'keyword', 'name']);

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') {
          continue;
        }
        normalized[key] = semanticTextKeys.has(key)
          ? trimmed.toLowerCase()
          : trimmed;
        continue;
      }

      normalized[key] = value;
    }

    return normalized;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    memory: { size: number; keys: string[] };
    redis: { available: boolean; connected: boolean };
  } {
    return globalCache.getStats();
  }

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    return globalCache.isRedisAvailable();
  }
}

export const toolResultCache = new ToolResultCacheService();
