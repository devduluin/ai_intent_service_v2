---
name: Embedding Cache Redis Migration
description: Migration of embedding-cache.service from NodeCache (memory-only) to Redis-backed globalCache
type: reference
---

**Embedding Cache Redis Migration** (2026-05-19)

Migrated `embedding-cache.service.ts` from in-memory NodeCache to Redis-backed `globalCache` utility.

**Why:** Original implementation used NodeCache (memory-only), causing cache loss on restart and no shared cache across instances. Needed Redis for production scalability.

**How to apply:**
- All cache operations now async (Redis calls)
- Uses `globalCache.get/set/del/clear` from `utils/cache-helper.util.ts`
- Automatic Redis fallback to memory if Redis unavailable
- Structured logging via `embeddingLogger`
- Enhanced metrics: redisHits, memoryHits, hitRate, redisHitRate
- New methods: `isHealthy()`, `warmup()`, `migrateToRedis()`, `destroy()`

**Breaking Changes:**
- `get()` now returns `Promise<number[] | null>` (was synchronous)
- `set()` now returns `Promise<void>` (was synchronous)
- `getOrCompute()` signature unchanged but now fully async
- `getTopHits()` now returns Promise

**Files modified:**
- `src/services/embedding-cache.service.ts` — Complete rewrite with Redis support

**Usage Example:**
```typescript
// Before (sync)
const cached = embeddingCache.get(text, agentId);
embeddingCache.set(text, embedding, agentId);

// After (async)
const cached = await embeddingCache.get(text, agentId);
await embeddingCache.set(text, embedding, agentId);

// GetOrCompute (same API)
const embedding = await embeddingCache.getOrCompute(
  text,
  async () => ollamaService.embed(text),
  agentId,
  ttl
);
```

**Benefits:**
- ✅ Persistent cache across restarts (Redis)
- ✅ Shared cache across multiple instances
- ✅ Automatic memory fallback if Redis down
- ✅ Better monitoring with structured metrics
- ✅ Health check support for load balancers
- ✅ Cache warmup for cold-start mitigation
