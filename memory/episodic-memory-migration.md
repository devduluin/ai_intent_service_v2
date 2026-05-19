---
name: Episodic Memory Database Migration
description: Complete migration of episodic memory from in-memory to PostgreSQL + Redis cache with slot-based cleanup
type: reference
---

**Episodic Memory Database Migration** (2026-05-19)

Migrated `episodic-memory.service.ts` from in-memory storage to PostgreSQL database with Redis caching layer.

**Why:** Original implementation used in-memory arrays (`storeDb: EpisodicMemory[]`), causing data loss on restart and no persistence. Needed database for production reliability with Redis cache for performance.

**Architecture:**
```
┌─────────────────────────────────────────┐
│   episodicMemoryService.getRecentContext()  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│        Redis Cache (globalCache)        │
│  Key: episodic_memory:context:{userId}:{app} │
│  TTL: 5 minutes (context), 10 min (last)    │
└──────────────┬──────────────────────────┘
               │ Cache MISS
               ▼
┌─────────────────────────────────────────┐
│   episodicMemoryRepository (PostgreSQL) │
│  Table: episodic_memories               │
│  Indexes: user_id+app_name, created_at  │
└─────────────────────────────────────────┘
```

**Key Features:**
- ✅ **Slot-based storage**: Max 6 memories per user per app (daily limit)
- ✅ **Automatic cleanup**: Oldest row deleted when limit exceeded, new row added
- ✅ **Redis caching**: `getRecentContext()` and `getLastContext()` use Redis first
- ✅ **DB fallback**: If cache miss, fetch from PostgreSQL table
- ✅ **Cache invalidation**: Automatic on memory upsert/delete
- ✅ **Tool usage hints**: Aggregated from `toolsUsed` JSONB column

**Files Created:**
1. `src/database/models/episodic-memory.model.ts` — Sequelize model
2. `src/repositories/episodic-memory.repository.ts` — Data access layer
3. `src/database/migrations/20240101000016-create-episodic-memories.js` — DB migration
4. `src/services/episodic-memory.service.ts` — Updated service (complete rewrite)

**Files Modified:**
- `src/database/models/index.ts` — Added `EpisodicMemoryModel` export

**Schema:**
```sql
CREATE TABLE episodic_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  app_name VARCHAR(100) NOT NULL,
  level ENUM('daily', 'weekly', 'monthly', 'yearly', 'story') DEFAULT 'daily',
  intent VARCHAR(200) NOT NULL,
  summary TEXT NOT NULL,
  toolsUsed JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_episodic_memories_user_app ON episodic_memories(user_id, app_name);
CREATE INDEX idx_episodic_memories_user_app_created ON episodic_memories(user_id, app_name, created_at);
CREATE INDEX idx_episodic_memories_user_app_intent ON episodic_memories(user_id, app_name, intent);
```

**New Service Methods:**
```typescript
// Get context with Redis cache (5 min TTL)
await episodicMemoryService.getRecentContext(userId, app, limit=5);

// Get last context with Redis cache (10 min TTL)
await episodicMemoryService.getLastContext(userId, app);

// Get user memory stats
await episodicMemoryService.getUserMemoryStats(userId, app);
// Returns: { slotCount, maxSlots: 6, usagePercentage }

// Health check
await episodicMemoryService.isHealthy();
```

**Migration Command:**
```bash
cd d:\Development\App\ai-intent-api-v2
npm run db:migrate
```

**Cache Keys:**
- `episodic_memory:context:{userId}:{app}` — Recent context summaries (TTL: 5 min)
- `episodic_memory:last:{userId}:{app}` — Last memory summary (TTL: 10 min)

**Slot Limit Behavior:**
```
User has 6 memories → Add 7th → Oldest (1st) deleted automatically
User has 5 memories → Add 6th → No deletion (under limit)
User cancels → All memories cleared via clearUserMemory()
```

**Benefits:**
- ✅ Persistent across restarts
- ✅ Shared across multiple service instances
- ✅ Automatic cleanup prevents unbounded growth
- ✅ Redis cache reduces DB load (5-10 min TTL)
- ✅ Structured logging with `appLogger`
- ✅ Health check for monitoring
