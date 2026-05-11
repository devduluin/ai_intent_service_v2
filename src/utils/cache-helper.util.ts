// utils/cache-helper.util.ts
import { Redis } from 'ioredis';
import { config } from '../config';

interface CacheEntry<T = any> {
  data: T;
  timestamp: number;
  ttl: number; // milliseconds
}

interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  redisKey?: string; // Custom Redis key (optional)
  skipRedis?: boolean; // Force skip Redis
}

class GlobalCacheHelper {
  private memoryCache = new Map<string, CacheEntry>();
  private redisClient: Redis | null = null;
  private useRedis: boolean = false;
  private readonly DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.initializeRedis();
    this.startCleanupInterval();
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  private initializeRedis(): void {
    const redisUrl = config.redis?.host || process.env.REDIS_HOST;
    
    if (redisUrl && !config.cache?.disableRedis) {
      try {
        this.redisClient = new Redis(redisUrl, {
          retryStrategy: (times: number) => {
            if (times > 3) {
              console.warn('[GlobalCache] Redis connection failed, falling back to memory cache');
              this.useRedis = false;
              return null; // Stop retrying
            }
            return Math.min(times * 100, 3000);
          },
          maxRetriesPerRequest: 2,
        });

        this.redisClient.on('connect', () => {
          console.log('[GlobalCache] Redis connected successfully');
          this.useRedis = true;
        });

        this.redisClient.on('error', (error: Error) => {
          console.error('[GlobalCache] Redis error:', error.message);
          if (this.useRedis) {
            console.warn('[GlobalCache] Falling back to memory cache');
            this.useRedis = false;
          }
        });

      } catch (error) {
        console.warn('[GlobalCache] Failed to initialize Redis, using memory cache only');
        this.useRedis = false;
      }
    } else {
      console.log('[GlobalCache] Redis not configured, using memory cache only');
      this.useRedis = false;
    }
  }

  private startCleanupInterval(): void {
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpiredEntries();
      }, this.CLEANUP_INTERVAL);
    }
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let deletedCount = 0;

    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[GlobalCache] Cleaned up ${deletedCount} expired entries. Remaining: ${this.memoryCache.size}`);
    }
  }

  // ============================================================
  // CORE METHODS
  // ============================================================
  
  /**
   * Get value from cache (Redis优先，fallback to memory)
   */
  async get<T = any>(key: string, options?: CacheOptions): Promise<T | null> {
    const memoryKey = this.getMemoryKey(key);
    
    // Try Redis first if available
    if (this.useRedis && !options?.skipRedis) {
      try {
        const redisKey = options?.redisKey || `cache:${key}`;
        const cached = await this.redisClient!.get(redisKey);
        
        if (cached) {
          const parsed = JSON.parse(cached) as T;
          console.log(`[GlobalCache] Redis HIT: ${key}`);
          
          // Also store in memory for faster subsequent access
          this.setMemoryOnly(memoryKey, parsed, options?.ttl || this.DEFAULT_TTL);
          
          return parsed;
        }
      } catch (error) {
        console.error(`[GlobalCache] Redis read error for ${key}:`, error);
        // Fall through to memory cache
      }
    }
    
    // Try memory cache
    const memoryEntry = this.memoryCache.get(memoryKey);
    if (memoryEntry && (Date.now() - memoryEntry.timestamp) <= memoryEntry.ttl) {
      console.log(`[GlobalCache] Memory HIT: ${key}`);
      return memoryEntry.data as T;
    }
    
    // Cache miss
    if (memoryEntry) {
      // Expired entry, delete it
      this.memoryCache.delete(memoryKey);
    }
    
    console.log(`[GlobalCache] MISS: ${key}`);
    return null;
  }

  /**
   * Set value to cache (Redis jika tersedia, selalu ke memory)
   */
  async set<T = any>(
    key: string, 
    data: T, 
    options?: CacheOptions
  ): Promise<void> {
    const ttl = options?.ttl || this.DEFAULT_TTL;
    const memoryKey = this.getMemoryKey(key);
    
    // Always store in memory
    this.setMemoryOnly(memoryKey, data, ttl);
    
    // Store in Redis if available
    if (this.useRedis && !options?.skipRedis) {
      try {
        const redisKey = options?.redisKey || `cache:${key}`;
        const ttlSeconds = Math.floor(ttl / 1000);
        
        await this.redisClient!.setex(redisKey, ttlSeconds, JSON.stringify(data));
        console.log(`[GlobalCache] Redis SET: ${key} (TTL: ${ttlSeconds}s)`);
      } catch (error) {
        console.error(`[GlobalCache] Redis write error for ${key}:`, error);
        // Already stored in memory, so continue
      }
    }
    
    console.log(`[GlobalCache] Memory SET: ${key} (TTL: ${ttl}ms)`);
  }

  /**
   * Get or compute (atomic operation)
   */
  async getOrCompute<T = any>(
    key: string,
    computeFn: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key, options);
    
    if (cached !== null) {
      return cached;
    }
    
    // Compute value
    console.log(`[GlobalCache] Computing value for: ${key}`);
    const value = await computeFn();
    
    // Store in cache
    await this.set(key, value, options);
    
    return value;
  }

  /**
   * Delete from cache
   */
  async del(key: string, options?: CacheOptions): Promise<void> {
    const memoryKey = this.getMemoryKey(key);
    
    // Delete from memory
    this.memoryCache.delete(memoryKey);
    
    // Delete from Redis if available
    if (this.useRedis && !options?.skipRedis) {
      try {
        const redisKey = options?.redisKey || `cache:${key}`;
        await this.redisClient!.del(redisKey);
        console.log(`[GlobalCache] Redis DEL: ${key}`);
      } catch (error) {
        console.error(`[GlobalCache] Redis delete error for ${key}:`, error);
      }
    }
    
    console.log(`[GlobalCache] Memory DEL: ${key}`);
  }

  /**
   * Clear all cache
   */
  async clear(pattern?: string): Promise<void> {
    // Clear memory cache
    if (pattern) {
      const regex = new RegExp(pattern);
      for (const key of this.memoryCache.keys()) {
        if (regex.test(key)) {
          this.memoryCache.delete(key);
        }
      }
    } else {
      this.memoryCache.clear();
    }
    
    // Clear Redis if available
    if (this.useRedis) {
      try {
        if (pattern) {
          const keys = await this.redisClient!.keys(`cache:${pattern}`);
          if (keys.length) {
            await this.redisClient!.del(...keys);
          }
        } else {
          await this.redisClient!.flushdb();
        }
        console.log(`[GlobalCache] Redis cleared (pattern: ${pattern || '*'})`);
      } catch (error) {
        console.error('[GlobalCache] Redis clear error:', error);
      }
    }
    
    console.log(`[GlobalCache] Memory cleared (pattern: ${pattern || '*'})`);
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================
  
  private getMemoryKey(key: string): string {
    return `memory:${key}`;
  }

  private setMemoryOnly(key: string, data: any, ttl: number): void {
    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  // ============================================================
  // UTILITY METHODS
  // ============================================================
  
  /**
   * Get cache statistics
   */
  getStats(): {
    memory: { size: number; keys: string[] };
    redis: { available: boolean; connected: boolean };
  } {
    return {
      memory: {
        size: this.memoryCache.size,
        keys: Array.from(this.memoryCache.keys()).map(k => k.replace('memory:', ''))
      },
      redis: {
        available: this.useRedis,
        connected: this.redisClient?.status === 'ready'
      }
    };
  }

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    return this.useRedis && this.redisClient?.status === 'ready';
  }

  /**
   * Warm up cache with multiple keys
   */
  async warmup(entries: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    console.log(`[GlobalCache] Warming up ${entries.length} entries...`);
    
    await Promise.all(
      entries.map(entry => this.set(entry.key, entry.value, { ttl: entry.ttl }))
    );
    
    console.log(`[GlobalCache] Warmup complete`);
  }

  /**
   * Destroy cache helper (call on app shutdown)
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    if (this.redisClient) {
      await this.redisClient.quit();
      console.log('[GlobalCache] Redis connection closed');
    }
    
    this.memoryCache.clear();
    console.log('[GlobalCache] Cache helper destroyed');
  }
}

// Singleton instance
export const globalCache = new GlobalCacheHelper();