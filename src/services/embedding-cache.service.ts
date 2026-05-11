// services/embedding-cache.service.ts
import NodeCache from 'node-cache'
import { createHash } from 'crypto'

interface CacheEntry {
  embedding: number[]
  timestamp: number
  hitCount: number
}

class EmbeddingCacheService {
  private cache: NodeCache
  private stats = {
    hits: 0,
    misses: 0,
    totalRequests: 0
  }

  constructor(ttlSeconds: number = 3600, maxKeys: number = 1000) {
    this.cache = new NodeCache({
      stdTTL: ttlSeconds,      // Default TTL: 1 hour
      checkperiod: 120,        // Check for expired keys every 2 minutes
      maxKeys: maxKeys,        // Maximum number of keys
      useClones: false         // Better performance
    })
  }

  /**
   * Generate cache key from text and optional agent context
   */
  private generateKey(text: string, agentId?: string): string {
    const normalizedText = text.toLowerCase().trim()
    const context = agentId ? `${agentId}:` : ''
    const content = `${context}${normalizedText}`
    
    return createHash('sha256').update(content).digest('hex')
  }

  /**
   * Get embedding from cache
   */
  get(text: string, agentId?: string): number[] | null {
    this.stats.totalRequests++
    const key = this.generateKey(text, agentId)
    const entry = this.cache.get<CacheEntry>(key)
    
    if (entry) {
      this.stats.hits++
      // Update hit count (for analytics)
      entry.hitCount++
      this.cache.set(key, entry)
      
      console.log(`[Cache] HIT for "${text.substring(0, 50)}..." (Hit #${entry.hitCount})`)
      return entry.embedding
    }
    
    this.stats.misses++
    console.log(`[Cache] MISS for "${text.substring(0, 50)}..."`)
    return null
  }

  /**
   * Store embedding in cache
   */
  set(text: string, embedding: number[], agentId?: string, ttl?: number): void {
    const key = this.generateKey(text, agentId)
    const entry: CacheEntry = {
      embedding,
      timestamp: Date.now(),
      hitCount: 0
    }
    
    if (ttl !== undefined) {
      this.cache.set(key, entry, ttl)
    } else {
      this.cache.set(key, entry)
    }
    console.log(`[Cache] Stored embedding for "${text.substring(0, 50)}..."`)
  }

  /**
   * Get or compute embedding (atomic operation)
   */
  async getOrCompute(
    text: string, 
    computeFn: () => Promise<number[]>,
    agentId?: string,
    ttl?: number
  ): Promise<number[]> {
    // Try cache first
    const cached = this.get(text, agentId)
    if (cached) return cached
    
    // Compute new embedding
    const embedding = await computeFn()
    
    // Store in cache
    this.set(text, embedding, agentId, ttl)
    
    return embedding
  }

  /**
   * Invalidate cache for specific text
   */
  invalidate(text: string, agentId?: string): void {
    const key = this.generateKey(text, agentId)
    this.cache.del(key)
    console.log(`[Cache] Invalidated for "${text.substring(0, 50)}..."`)
  }

  /**
   * Invalidate all cache for agent
   */
  invalidateAgentCache(agentId: string): void {
    const keys = this.cache.keys()
    const agentPrefix = this.generateKey('', agentId).substring(0, 16)
    const toDelete = keys.filter(key => key.startsWith(agentPrefix))
    
    toDelete.forEach(key => this.cache.del(key))
    console.log(`[Cache] Invalidated ${toDelete.length} entries for agent ${agentId}`)
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.flushAll()
    this.stats = { hits: 0, misses: 0, totalRequests: 0 }
    console.log('[Cache] Cleared all entries')
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.totalRequests > 0 
      ? (this.stats.hits / this.stats.totalRequests) * 100 
      : 0
    
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      totalRequests: this.stats.totalRequests,
      hitRate: `${hitRate.toFixed(2)}%`,
      cacheSize: this.cache.keys().length,
      keys: this.cache.keys()
    }
  }

  /**
   * Get most frequently accessed queries
   */
  getTopHits(limit: number = 10): Array<{ key: string; hitCount: number }> {
    const entries: Array<{ key: string; hitCount: number }> = []
    
    this.cache.keys().forEach(key => {
      const entry = this.cache.get<CacheEntry>(key)
      if (entry) {
        entries.push({ key, hitCount: entry.hitCount })
      }
    })
    
    return entries
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, limit)
  }
}

export const embeddingCache = new EmbeddingCacheService(
  parseInt(process.env.EMBEDDING_CACHE_TTL || '3600'),  // 1 hour default
  parseInt(process.env.EMBEDDING_CACHE_MAX_KEYS || '1000')
)