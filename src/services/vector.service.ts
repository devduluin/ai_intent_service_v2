import { ChromaClient, Collection, IncludeEnum } from 'chromadb'
import { config } from '../config'
import { ollamaService } from './ollamaRaw.service'
import type { Agent, Intent, IntentMatch } from '../types'

// ============================================================
// Vector DB Service — Multi Agent Intent Search
// ============================================================

class VectorService {
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
      name: config.vectorDb.collection,
      metadata: {
        'hnsw:space': 'cosine',
      },
    })
  }

  private ensureCollection(): Collection {
    if (!this.collection) {
      throw new Error('VectorDB not initialized. Call init() first.')
    }
    return this.collection
  }

  // ============================================================
  // INDEX SINGLE INTENT
  // ============================================================
  async indexIntent(intent: Intent): Promise<void> {
    const col = this.ensureCollection()
    // console.log(`indexIntent`, intent)
    if (!intent.agentId) {
      throw new Error(`Intent ${intent.slug} missing agentId`)
    }

    if (!intent.examples?.length) return

    const normalizedExamples = intent.examples.map(this.normalize)

    const embeddings = await ollamaService.embedBatch(normalizedExamples)

    const ids = intent.examples.map(
      (_, i) => `${intent.agentId}_${intent.id}_ex_${i}`
    )

    const metadatas = intent.examples.map(() => ({
      agentId: intent.agentId,
      intentId: intent.id,
      intentSlug: intent.slug,
      intentName: intent.name,
    }))

    await col.add({
      ids,
      embeddings,
      metadatas,
      documents: normalizedExamples,
    })
  }

  // ============================================================
  // INDEX ALL INTENTS
  // ============================================================
  async indexAllIntents(intents: Intent[]): Promise<void> {
    for (const intent of intents) {
      await this.indexIntent(intent)
    }
  }

  // ============================================================
  // FIND INTENT (AGENT ISOLATED SEARCH)
  // ============================================================
  async findIntent(
    queryEmbedding: number[],
    intents: Intent[],
    agent: Agent,
    topK = config.intent.topK
  ): Promise<IntentMatch[]> {
    const col = this.ensureCollection()
    const agentId = agent?.id;

    console.log(`Finding intent for agent "${agentId}" intents`)

    const results = await col.query({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      include: [
        IncludeEnum.Metadatas,
        IncludeEnum.Distances,
      ],
      where: {
        agentId: agentId,
      },
    })

    if (!results.metadatas?.[0]) return []

    const matches: IntentMatch[] = []
    const seen = new Set<string>()

    for (let i = 0; i < results.metadatas[0].length; i++) {
      const meta = results.metadatas[0][i] as {
        intentId: string
        agentId: string
      }

      const distance = results.distances?.[0]?.[i] ?? 1
      const score = 1 - distance

      if (score < config.intent.similarityThreshold) continue

      if (seen.has(meta.intentId)) continue
      seen.add(meta.intentId)

      const intent = intents.find(i => i.id === meta.intentId)
      if (!intent) continue

      matches.push({
        intent,
        score,
      })
    }

    return matches.sort((a, b) => b.score - a.score)
  }

  // ============================================================
  // RESET COLLECTION
  // ============================================================
  async resetCollection(): Promise<void> {
    await this.client.deleteCollection({
      name: config.vectorDb.collection,
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

export const vectorService = new VectorService()