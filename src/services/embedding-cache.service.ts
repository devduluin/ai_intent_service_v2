// services/embedding-cache.service.ts
import { createHash } from 'crypto';
import { globalCache } from '../utils/cache-helper.util';
import { config } from '../config';
import { embeddingLogger } from '../utils/logger.util';

// ============================================================
// Constants
// ============================================================

const DEFAULT_TTL_MS = (config.cache?.embeddingTTL || 3600) * 1000; // Default 1 hour in ms
const CACHE_PREFIX = 'embedding:';

// ============================================================
// Cache Entry Interface
// ============================================================

interface CacheEntry {
  embedding: number[];
  timestamp: number;
  hitCount: number;
  agentId?: string;
}

// ============================================================
// Embedding Cache Service Class
// ============================================================

class EmbeddingCacheService {
  private stats = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    redisHits: 0,
    memoryHits: 0,
    errors: 0
  };

  constructor() {
    embeddingLogger.info('EmbeddingCacheService initialized', {
      ttl: DEFAULT_TTL_MS / 1000,
      redisAvailable: globalCache.isRedisAvailable()
    });
  }

  // ============================================================
  // KEY GENERATION
  // ============================================================

  /**
   * Generate cache key from text and optional agent context
   */
  private generateKey(text: string, agentId?: string): string {
    const normalizedText = text.toLowerCase().trim();
    const context = agentId ? `agent:${agentId}:` : '';
    const content = `${context}${normalizedText}`;

    return `${CACHE_PREFIX}${createHash('sha256').update(content).digest('hex')}`;
  }

  /**
   * Parse cache key to extract metadata
   */
  private parseKey(key: string): { textHash: string; agentId?: string } {
    const withoutPrefix = key.replace(CACHE_PREFIX, '');
    const agentMatch = withoutPrefix.match(/^agent:([^:]+):(.+)$/);

    if (agentMatch) {
      return {
        agentId: agentMatch[1],
        textHash: agentMatch[2]
      };
    }

    return { textHash: withoutPrefix };
  }

  // ============================================================
  // CORE CACHE OPERATIONS
  // ============================================================

  /**
   * Get embedding from cache (Redis优先，memory fallback)
   */
  async get(text: string, agentId?: string): Promise<number[] | null> {
    this.stats.totalRequests++;
    const key = this.generateKey(text, agentId);

    try {
      const cached = await globalCache.get<CacheEntry>(key);

      if (cached) {
        this.stats.hits++;

        // Track Redis vs memory hit
        if (globalCache.isRedisAvailable()) {
          this.stats.redisHits++;
          embeddingLogger.debug('Embedding cache HIT (Redis)', {
            textLength: text.length,
            agentId,
            hitCount: cached.hitCount + 1
          });
        } else {
          this.stats.memoryHits++;
          embeddingLogger.debug('Embedding cache HIT (Memory)', {
            textLength: text.length,
            agentId,
            hitCount: cached.hitCount + 1
          });
        }

        // Update hit count for analytics
        cached.hitCount++;
        await globalCache.set(key, cached, { ttl: DEFAULT_TTL_MS });

        return cached.embedding;
      }

      this.stats.misses++;
      embeddingLogger.debug('Embedding cache MISS', {
        textLength: text.length,
        agentId
      });

      return null;
    } catch (error) {
      this.stats.errors++;
      embeddingLogger.error('Embedding cache read error', {
        error: error instanceof Error ? error.message : error,
        key
      });

      // Return null on error (cache miss behavior)
      return null;
    }
  }

  /**
   * Store embedding in cache (Redis + Memory)
   */
  async set(
    text: string,
    embedding: number[],
    agentId?: string,
    ttl?: number
  ): Promise<void> {
    const key = this.generateKey(text, agentId);
    const entry: CacheEntry = {
      embedding,
      timestamp: Date.now(),
      hitCount: 0,
      agentId
    };

    try {
      await globalCache.set(key, entry, { ttl: ttl ?? DEFAULT_TTL_MS });

      embeddingLogger.debug('Embedding cached', {
        key,
        textLength: text.length,
        agentId,
        ttl: ttl ?? DEFAULT_TTL_MS,
        redisAvailable: globalCache.isRedisAvailable()
      });
    } catch (error) {
      this.stats.errors++;
      embeddingLogger.error('Embedding cache write error', {
        error: error instanceof Error ? error.message : error,
        key
      });
      // Continue silently - embedding was computed successfully
    }
  }

  /**
   * Get or compute embedding (atomic operation with caching)
   */
  async getOrCompute(
    text: string,
    computeFn: () => Promise<number[]>,
    agentId?: string,
    ttl?: number
  ): Promise<number[]> {
    const startTime = Date.now();

    // Try cache first
    const cached = await this.get(text, agentId);
    if (cached) {
      const duration = Date.now() - startTime;
      embeddingLogger.metric('embedding_cache_duration', duration, 'ms', {
        hit: true,
        agentId
      });
      return cached;
    }

    // Compute new embedding
    // embeddingLogger.debug('Computing new embedding', {
    //   textLength: text.length,
    //   agentId
    // });

    const embedding = await computeFn();

    // Store in cache
    await this.set(text, embedding, agentId, ttl);

    const duration = Date.now() - startTime;
    embeddingLogger.metric('embedding_cache_duration', duration, 'ms', {
      hit: false,
      agentId
    });

    return embedding;
  }

  // ============================================================
  // CACHE INVALIDATION
  // ============================================================

  /**
   * Invalidate cache for specific text
   */
  async invalidate(text: string, agentId?: string): Promise<void> {
    const key = this.generateKey(text, agentId);

    try {
      await globalCache.del(key);
      embeddingLogger.info('Embedding cache invalidated', {
        key,
        textLength: text.length,
        agentId
      });
    } catch (error) {
      this.stats.errors++;
      embeddingLogger.error('Cache invalidation error', {
        error: error instanceof Error ? error.message : error,
        key
      });
    }
  }

  /**
   * Invalidate all cache for specific agent
   */
  async invalidateAgentCache(agentId: string): Promise<void> {
    try {
      // Get all keys and filter by agent prefix
      const stats = globalCache.getStats();
      const agentPrefix = `embedding:agent:${agentId}:`;

      const keysToDelete = stats.memory.keys.filter((key: string) =>
        key.startsWith(agentPrefix)
      );

      // Delete from memory cache
      for (const key of keysToDelete) {
        await globalCache.del(key, { skipRedis: true });
      }

      // Delete from Redis with pattern
      if (globalCache.isRedisAvailable()) {
        await globalCache.clear(`embedding:agent:${agentId}:*`);
      }

      embeddingLogger.info('Agent cache invalidated', {
        agentId,
        deletedCount: keysToDelete.length
      });
    } catch (error) {
      this.stats.errors++;
      embeddingLogger.error('Agent cache invalidation error', {
        error: error instanceof Error ? error.message : error,
        agentId
      });
    }
  }

  /**
   * Clear all embedding cache
   */
  async clear(): Promise<void> {
    try {
      await globalCache.clear('embedding:*');
      this.stats = {
        hits: 0,
        misses: 0,
        totalRequests: 0,
        redisHits: 0,
        memoryHits: 0,
        errors: 0
      };
      embeddingLogger.info('All embedding cache cleared');
    } catch (error) {
      this.stats.errors++;
      embeddingLogger.error('Cache clear error', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  // ============================================================
  // STATISTICS & MONITORING
  // ============================================================

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.totalRequests > 0
      ? (this.stats.hits / this.stats.totalRequests) * 100
      : 0;

    const redisHitRate = this.stats.hits > 0
      ? (this.stats.redisHits / this.stats.hits) * 100
      : 0;

    const cacheStats = globalCache.getStats();

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      totalRequests: this.stats.totalRequests,
      hitRate: `${hitRate.toFixed(2)}%`,
      redisHitRate: `${redisHitRate.toFixed(2)}%`,
      memoryHits: this.stats.memoryHits,
      redisHits: this.stats.redisHits,
      errors: this.stats.errors,
      cacheSize: cacheStats.memory.size,
      redisAvailable: cacheStats.redis.available,
      redisConnected: cacheStats.redis.connected
    };
  }

  /**
   * Get most frequently accessed embeddings
   */
  async getTopHits(limit: number = 10): Promise<Array<{
    key: string;
    hitCount: number;
    agentId?: string;
    timestamp?: number;
  }>> {
    try {
      const stats = globalCache.getStats();
      const entries: Array<{
        key: string;
        hitCount: number;
        agentId?: string;
        timestamp?: number;
      }> = [];

      // Get from memory cache
      for (const key of stats.memory.keys) {
        const entry = await globalCache.get<CacheEntry>(key);
        if (entry) {
          const parsed = this.parseKey(key);
          entries.push({
            key,
            hitCount: entry.hitCount,
            agentId: parsed.agentId,
            timestamp: entry.timestamp
          });
        }
      }

      return entries
        .sort((a, b) => b.hitCount - a.hitCount)
        .slice(0, limit);
    } catch (error) {
      embeddingLogger.error('Get top hits error', {
        error: error instanceof Error ? error.message : error
      });
      return [];
    }
  }

  /**
   * Get cache health status
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Test write/read
      const testKey = `${CACHE_PREFIX}health_check_${Date.now()}`;
      const testValue = { embedding: [0.1, 0.2], timestamp: Date.now(), hitCount: 0 };

      await globalCache.set(testKey, testValue, { ttl: 1000 });
      const retrieved = await globalCache.get(testKey);

      if (retrieved) {
        await globalCache.del(testKey);
        return true;
      }

      return false;
    } catch (error) {
      embeddingLogger.error('Cache health check failed', {
        error: error instanceof Error ? error.message : error
      });
      return false;
    }
  }

  /**
   * Warm up cache with pre-computed embeddings
   */
  async warmup(
    embeddings: Array<{ text: string; embedding: number[]; agentId?: string }>
  ): Promise<void> {
    embeddingLogger.info(`Warming up cache with ${embeddings.length} entries`);

    try {
      const warmupEntries = embeddings.map(e => ({
        key: this.generateKey(e.text, e.agentId),
        value: {
          embedding: e.embedding,
          timestamp: Date.now(),
          hitCount: 0,
          agentId: e.agentId
        } as CacheEntry
      }));

      await globalCache.warmup(
        warmupEntries.map(e => ({
          key: e.key,
          value: e.value,
          ttl: DEFAULT_TTL_MS
        }))
      );

      embeddingLogger.info('Cache warmup completed', {
        entries: embeddings.length
      });
    } catch (error) {
      this.stats.errors++;
      embeddingLogger.error('Cache warmup error', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  /**
   * Migrate in-memory cache to Redis (call before shutdown if needed)
   */
  async migrateToRedis(): Promise<void> {
    if (globalCache.isRedisAvailable()) {
      embeddingLogger.info('Migrating in-memory cache to Redis...');

      try {
        const stats = globalCache.getStats();

        for (const key of stats.memory.keys) {
          const entry = await globalCache.get<CacheEntry>(key);
          if (entry) {
            // Re-set to ensure it's in Redis
            await globalCache.set(key, entry, { ttl: DEFAULT_TTL_MS });
          }
        }

        embeddingLogger.info('Migration to Redis completed', {
          migratedKeys: stats.memory.size
        });
      } catch (error) {
        embeddingLogger.error('Migration to Redis failed', {
          error: error instanceof Error ? error.message : error
        });
      }
    }
  }

  /**
   * Destroy cache service (call on app shutdown)
   */
  async destroy(): Promise<void> {
    embeddingLogger.info('Destroying embedding cache service...');
    await this.clear();
    embeddingLogger.info('Embedding cache service destroyed');
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const embeddingCache = new EmbeddingCacheService();
