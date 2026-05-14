import { ChromaClient, Collection, IncludeEnum } from 'chromadb'
import { config } from '../config'
import { ollamaService } from './ollamaRaw.service'

class KnowledgeVectorService {
  private client: ChromaClient
  private collection: Collection | null = null

  constructor() {
    this.client = new ChromaClient({ path: config.vectorDb.url })
  }

  // ============================================================
  // TEXT NORMALIZATION
  // ============================================================
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  }

  // ============================================================
  // INIT COLLECTION
  // ============================================================
  async init(): Promise<void> {
    this.collection = await this.client.getOrCreateCollection({
      name: 'ai_knowledge_chunks',
      metadata: { 'hnsw:space': 'cosine' },
    })
  }

  private ensureCollection(): Collection {
    if (!this.collection) {
      throw new Error('Knowledge VectorDB not initialized')
    }
    return this.collection
  }

  // ============================================================
  // CREATE / INDEX CHUNKS
  // dipanggil setelah chunk disimpan ke Postgres
  // ============================================================
  async indexChunks(chunks: {
    id: string
    content: string
    agentId: string
    knowledgeId: string
    sourceId: string
  }[]): Promise<void> {
    const col = this.ensureCollection()

    if (!chunks.length) return

    const texts = chunks.map(c => this.normalize(c.content))
    const embeddings = await ollamaService.embedBatch(texts)

    await col.add({
      ids: chunks.map(c => c.id),
      embeddings,
      documents: texts,
      metadatas: chunks.map(c => ({
        agentId: c.agentId,
        knowledgeId: c.knowledgeId,
        sourceId: c.sourceId,
        chunkId: c.id,
      })),
    })
  }

  // ============================================================
  // READ / SEARCH (RAG RETRIEVAL)
  // ============================================================
  async search(
    queryEmbedding: number[],
    agentId: string,
    topK = 5
  ) {
    const col = this.ensureCollection()

    const res = await col.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: [
        IncludeEnum.Documents,
        IncludeEnum.Metadatas,
        IncludeEnum.Distances,
      ],
      where: { agentId },
    })

    if (!res.documents?.[0]) return []

    const results = []

    for (let i = 0; i < res.documents[0].length; i++) {
      const distance = res.distances?.[0]?.[i] ?? 1
      const score = 1 - distance

      results.push({
        content: res.documents[0][i],
        metadata: res.metadatas?.[0]?.[i],
        score,
      })
    }

    return results.sort((a, b) => b.score - a.score)
  }

  // ============================================================
  // SCOPED SEARCH (planner-selected knowledge)
  // ============================================================
  async searchKnowledgeChunks(params: {
    embedding: number[]
    knowledgeIds: string[]
    topK?: number
  }) {
    const { embedding, knowledgeIds, topK = 5 } = params

    const col = this.ensureCollection()

    if (!knowledgeIds.length) return []

    const res = await col.query({
      queryEmbeddings: [embedding],
      nResults: topK,
      include: [
        IncludeEnum.Documents,
        IncludeEnum.Metadatas,
        IncludeEnum.Distances,
      ],
      where: {
        knowledgeId: { "$in": knowledgeIds },
      },
    })

    if (!res.documents?.[0]) return []

    const results = []

    for (let i = 0; i < res.documents[0].length; i++) {
      const distance = res.distances?.[0]?.[i] ?? 1
      const score = 1 - distance

      results.push({
        content: res.documents[0][i],
        metadata: res.metadatas?.[0]?.[i],
        score,
      })
    }

    return results.sort((a, b) => b.score - a.score)
  }

  // ============================================================
  // UPDATE (re-embed single chunk)
  // ============================================================
  async updateChunk(
    chunkId: string,
    newContent: string,
    meta: {
      agentId: string
      knowledgeId: string
      sourceId: string
    }
  ) {
    const col = this.ensureCollection()

    const text = this.normalize(newContent)
    const embedding = await ollamaService.embed(text)

    await col.upsert({
      ids: [chunkId],
      embeddings: [embedding],
      documents: [text],
      metadatas: [{
        ...meta,
        chunkId,
      }],
    })
  }

  // ============================================================
  // DELETE SINGLE CHUNK
  // ============================================================
  async deleteChunk(chunkId: string): Promise<void> {
    const col = this.ensureCollection()
    await col.delete({ ids: [chunkId] })
  }

  // ============================================================
  // DELETE BY KNOWLEDGE (when article removed)
  // ============================================================
  async deleteByKnowledge(knowledgeId: string): Promise<void> {
    const col = this.ensureCollection()
    await col.delete({
      where: { knowledgeId },
    })
  }

  // ============================================================
  // RESET COLLECTION
  // ============================================================
  async resetCollection(): Promise<void> {
    await this.client.deleteCollection({
      name: 'ai_knowledge_chunks',
    })
    this.collection = null
    await this.init()
  }

  // ============================================================
  // HEALTH CHECK
  // ============================================================
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.heartbeat()
      return true
    } catch {
      return false
    }
  }
}

export const knowledgeVectorService = new KnowledgeVectorService()