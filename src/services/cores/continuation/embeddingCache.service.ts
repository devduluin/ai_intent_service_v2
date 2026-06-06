// ============================================================
// Embedding Cache Service
// ============================================================
// Caches query embeddings to avoid recomputation
// Features:
// - TTL-based expiration (default: 30 min)
// - LRU eviction (max 1000 entries)
// - Automatic cleanup on cache miss
// ============================================================

import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface EmbeddingCacheEntry {
  query: string;
  embedding: number[];
  cachedAt: number;
  ttl: number;
  accessCount: number;
  lastAccessedAt: number;
}

export interface EmbeddingCacheConfig {
  /** Default TTL in milliseconds (default: 30 min) */
  defaultTtl: number;
  
  /** Maximum cache entries (default: 1000) */
  maxEntries: number;
  
  /** Cleanup interval in milliseconds (default: 5 min) */
  cleanupInterval: number;
}

// ============================================================
// Default Configuration
// ============================================================

const DEFAULT_CONFIG: EmbeddingCacheConfig = {
  defaultTtl: 30 * 60 * 1000,      // 30 minutes
  maxEntries: 1000,                 // 1000 entries
  cleanupInterval: 5 * 60 * 1000   // 5 minutes
};

// ============================================================
// Embedding Cache Service
// ============================================================

class EmbeddingCacheService {
  private cache = new Map<string, EmbeddingCacheEntry>();
  private config: EmbeddingCacheConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config?: Partial<EmbeddingCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanupTimer();
    
    appLogger.info('[EmbeddingCache] Initialized', {
      defaultTtl: this.config.defaultTtl / 1000 + 's',
      maxEntries: this.config.maxEntries,
      cleanupInterval: this.config.cleanupInterval / 1000 + 's'
    });
  }

  /**
   * Get embedding from cache or compute if not cached
   */
  async getOrCompute(
    query: string,
    computeFn: () => Promise<number[]>
  ): Promise<number[]> {
    // Try cache first
    const cached = this.get(query);
    if (cached) {
      appLogger.debug('[EmbeddingCache] Cache hit', {
        query: query.substring(0, 50),
        age: (Date.now() - cached.cachedAt) / 1000 + 's',
        accessCount: cached.accessCount
      });
      return cached.embedding;
    }

    // Compute and cache
    appLogger.debug('[EmbeddingCache] Cache miss, computing', {
      query: query.substring(0, 50)
    });

    const embedding = await computeFn();
    this.set(query, embedding);

    return embedding;
  }

  /**
   * Get embedding from cache
   */
  get(query: string): EmbeddingCacheEntry | null {
    const entry = this.cache.get(this.normalizeQuery(query));
    
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > entry.ttl) {
      appLogger.debug('[EmbeddingCache] Cache entry expired', {
        query: query.substring(0, 50)
      });
      this.cache.delete(this.normalizeQuery(query));
      return null;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccessedAt = Date.now();

    return entry;
  }

  /**
   * Set embedding in cache
   */
  set(query: string, embedding: number[], ttl?: number): void {
    const normalizedQuery = this.normalizeQuery(query);
    
    // Check if we need to evict
    if (this.cache.size >= this.config.maxEntries) {
      this.evictOldest();
    }

    const entry: EmbeddingCacheEntry = {
      query,
      embedding,
      cachedAt: Date.now(),
      ttl: ttl || this.config.defaultTtl,
      accessCount: 0,
      lastAccessedAt: Date.now()
    };

    this.cache.set(normalizedQuery, entry);

    appLogger.debug('[EmbeddingCache] Cached', {
      query: query.substring(0, 50),
      embeddingLength: embedding.length,
      ttl: entry.ttl / 1000 + 's'
    });
  }

  /**
   * Remove embedding from cache
   */
  remove(query: string): void {
    const normalizedQuery = this.normalizeQuery(query);
    this.cache.delete(normalizedQuery);
    
    appLogger.debug('[EmbeddingCache] Removed', {
      query: query.substring(0, 50)
    });
  }

  /**
   * Clear all cached embeddings
   */
  clear(): void {
    this.cache.clear();
    appLogger.info('[EmbeddingCache] Cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxEntries: number;
    hitRate: number;
    avgAge: number;
  } {
    const now = Date.now();
    const entries = Array.from(this.cache.values());
    
    const totalAge = entries.reduce(
      (sum, entry) => sum + (now - entry.cachedAt),
      0
    );
    
    const totalAccesses = entries.reduce(
      (sum, entry) => sum + entry.accessCount,
      0
    );

    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      hitRate: this.cache.size > 0 ? totalAccesses / this.cache.size : 0,
      avgAge: entries.length > 0 ? totalAge / entries.length : 0
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.cachedAt > entry.ttl) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      appLogger.debug('[EmbeddingCache] Cleanup completed', {
        removed,
        remaining: this.cache.size
      });
    }

    return removed;
  }

  /**
   * Evict least recently used entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      appLogger.debug('[EmbeddingCache] Evicted LRU entry', {
        key: oldestKey
      });
    }
  }

  /**
   * Normalize query for cache key
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim().substring(0, 500);
  }

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      const removed = this.cleanup();
      if (removed > 0) {
        appLogger.info('[EmbeddingCache] Periodic cleanup', {
          removed,
          remaining: this.cache.size
        });
      }
    }, this.config.cleanupInterval);

    // Cleanup on process exit
    process.on('exit', () => {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
      }
    });
  }

  /**
   * Destroy cache and stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
    appLogger.info('[EmbeddingCache] Destroyed');
  }
}

// Singleton instance
export const embeddingCache = new EmbeddingCacheService();
