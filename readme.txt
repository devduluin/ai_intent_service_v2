agents (1) ─────< (N) intents
                         │
                         ├──< (N) intent_examples
                         │
                         ├──>< (intent_tool_mappings) >── tools
                         │         │
                         │         toolId → tools (1)
                         │
                         └──>< (intent_knowledge_mappings) >── knowledge
                                   │
                                   knowledgeId → knowledge (1)


schema ingestion layer :

User → embedding → match intent_examples → dapat intent
     → tool planning → ambil knowledge by intent
     → LLM naturalisasi

services/crawler/
   WebsiteCrawlerService.ts  ← main service
   LinkDiscoveryService.ts   ← cari semua halaman
   PageScraperService.ts     ← scrape halaman
   HtmlCleaner.ts            ← bersihkan html
   TextChunker.ts            ← split jadi chunks

struktur knowledge :
Knowledge (concept/topic)
        │
        ├── KnowledgeSource (raw data location)
        │        ├── Web URL
        │        ├── PDF
        │        ├── Docx
        │        └── Manual text
        │
        └── KnowledgeChunk (vector embeddings)

1) User message
2) Embed message
3) Vector search → intent_examples
4) Tool Planner decide:
      tools[]
      knowledge[]
      chat

5) IF knowledge[] NOT EMPTY
      → search knowledge_chunks
   ELSE
      → skip knowledge retrieval

6) Execute tools (if any)
7) Naturalize response with:
      tool results + knowledge chunks

Flow ingestion final
1️⃣ Save knowledge
2️⃣ Save knowledge_source
3️⃣ Chunk text
4️⃣ Save chunks → Postgres
5️⃣ Index chunks → Chroma  ← call knowledgeVectorService.indexChunks()


KnowledgeSource created
      ↓
KnowledgeIngestionService ⭐
      ↓
Postgres chunks
      ↓
Chroma indexed



Final Knowledge Pipeline
Admin Upload Source
        ↓
API publish event → RabbitMQ
        ↓
KnowledgeIngestionWorker (consumer)
        ↓
KnowledgeIngestionService.ingestSource()
        ↓
Postgres (chunks) + Chroma (vectors)
        ↓
AI RAG ready


| Layer           | Role                 |
| --------------- | -------------------- |
| Knowledge       | Container / Document |
| KnowledgeSource | Raw data             |
| KnowledgeChunk  | Chunk for RAG        |
| Chroma          | Vector search        |


POST /admin/knowledge
{
  "slug": "leave_policy",
  "title": "Cuti Tahunan",
  "type": "policy"
}

POST /admin/knowledge/knowledge-source
{
    "knowledgeId": "781f7f5f-9f44-49e4-8064-c95b9cd0ae49",
    "type": "text",
    "content": "**Lupa Absen**\n- Hubungi HR maksimal H+1 untuk koreksi manual\n- Lampirkan bukti kehadiran (foto selfie/timeline)\n\n**Absen dari luar kantor**\n- Wajib dapat persetujuan atasan via email/chat\n- Gunakan fitur presensi dengan status tugas di luar di aplikasi Workin\n\n**Tidak Bisa Absen**\n- Pastikan koneksi internet stabil\n- Wajib periksa shift atau jadwal hari ini\n- Restart aplikasi Workin dan coba lagi\n- Hubungi HR anda jika masalah berlanjut\n- Jika masih ada kendala, anda juga bisa pakai offline mode"
}
{
  "knowledgeId": "781f7f5f-9f44-49e4-8064-c95b9cd0ae49",
  "type": "url",
  "url": "https://docs.workin.duluin.com"
}

responseMapping: JSONB
{
  "successPath": "data.success",
  "messagePath": "data.message",
  "dataPath": "data"
}