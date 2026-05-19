---
name: Knowledge Ingestion at Startup
description: Added automatic knowledge ingestion for all sources during server startup in server.ts
type: reference
---

**Knowledge Ingestion at Startup** (2026-05-19)

Added `ingestAllKnowledge()` function to `server.ts` to automatically ingest all knowledge sources during server startup.

**Why:** Previously, knowledge sources needed manual triggering via worker queue. For development/single-instance deployments, automatic ingestion at startup ensures all knowledge is immediately available for RAG queries.

**How it works:**
```typescript
// Startup sequence in server.ts:
1. Connect PostgreSQL
2. Register intent handlers
3. Load intents from DB
4. Init ChromaDB (vector DB)
5. Reset vector collections
6. Index intents → vector DB
7. 🆕 INGEST ALL KNOWLEDGE SOURCES ← NEW
8. Start server
```

**Ingestion Flow:**
```
findAllActive() → Get all active knowledge
  ↓
forEach knowledge:
  ↓
findByKnowledgeId() → Get all sources
  ↓
forEach source:
  ↓
ingestSource(sourceId):
  - Extract text (URL/PDF/DOCX/text)
  - Chunk text (textChunkerService)
  - Delete old chunks (Postgres + ChromaDB)
  - Save chunks to Postgres
  - Index chunks to ChromaDB (vectors)
  - Update status → 'completed'
  ↓
Log summary
```

**Files Modified:**
- `src/server.ts` — Added `ingestAllKnowledge()` function

**Startup Log Output:**
```
[INFO] Ingesting all knowledge sources...
[INFO] Found 5 active knowledge entries
[INFO] Ingesting knowledge: company-policy (2 sources)
[INFO] ✓ Ingested source: url - https://example.com/policy.pdf
[INFO] ✓ Ingested source: text - Employee handbook...
[INFO] ✓ Completed knowledge: company-policy
[INFO] Knowledge ingestion completed {
  totalKnowledge: 5,
  ingested: 12,
  failed: 0,
  skipped: 2,
  durationMs: 45230,
  durationSec: 45.23
}
```

**Error Handling:**
- Per-source try-catch: One failed source doesn't stop others
- Per-knowledge try-catch: One failed knowledge doesn't stop others
- Failed sources logged with error details
- Summary includes failed/skipped counts

**Skip Conditions:**
- Knowledge with no sources → skipped + logged as warning
- Source type unsupported → failed + logged as error
- Source URL unreachable → failed + logged as error

**Configuration:**
```typescript
// In config.ts, knowledge ingestion uses:
config.ollama.embedModel  // For chunk embeddings
config.vectorDb.url       // ChromaDB connection
config.vectorDb.collection // Vector collection name
```

**Performance:**
- Sequential ingestion (one source at a time)
- Typical speed: ~2-5 seconds per source (depends on content size)
- For large knowledge bases, consider:
  - Parallel ingestion with concurrency limit
  - Background worker (existing RabbitMQ worker)
  - Incremental ingestion (only new/updated sources)

**Future Enhancements:**
```typescript
// Option: Only ingest if status is 'idle' or 'failed'
const pendingSources = sources.filter(s =>
  knowledge.ingestionStatus === 'idle' ||
  knowledge.ingestionStatus === 'failed'
);

// Option: Parallel ingestion with concurrency limit
const chunks = chunk(sources, 3); // 3 concurrent
for (const chunk of chunks) {
  await Promise.all(chunk.map(s => ingestSource(s.id)));
}
```

**Related Files:**
- `src/services/knowledgeIngestion.service.ts` — Core ingestion logic
- `src/workers/knowledgeIngestion.worker.ts` — Background worker (alternative)
- `src/services/knowledgeVector.service.ts` — Vector indexing
- `src/repositories/knowledgeChunk.repository.ts` — Chunk storage
