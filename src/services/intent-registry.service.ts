import type { Intent } from '../types'
import { intentRepository } from '../repositories/intent.repository'

class IntentRegistryService {
  private dbIntents: Map<string, Intent> = new Map()
  private staticIntents: Map<string, Intent> = new Map()
  private filteredCache = new Map<string, { intents: Intent[]; expiresAt: number }>()
  private readonly FILTERED_CACHE_TTL = 30 * 1000 // 30 seconds

  registerMany(entries: Array<{ intent: Intent }>): void {
    for (const entry of entries) {
      this.staticIntents.set(entry.intent.slug, entry.intent)
    }
  }

  async syncFromDatabase(): Promise<void> {
    const dbIntents = await intentRepository.findAllActive({ agentId: null })

    console.log(`[Registry] Syncing ${dbIntents.length} intents from DB`)
    this.dbIntents.clear()
    this.filteredCache.clear() // Invalidate filtered caches on sync

    for (const intent of dbIntents) {
      this.dbIntents.set(intent.slug, {
        ...intent,
        tools: [...(intent.tools ?? [])],
        knowledge: [...(intent.knowledge ?? [])],
      })
    }
  }

  getAll(filters?: { agentId?: string }): Intent[] {
    const cacheKey = filters?.agentId ?? '__all__'
    const cached = this.filteredCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.intents
    }

    const allIntents = [
      ...this.staticIntents.values(),
      ...this.dbIntents.values()
    ]

    let result: Intent[]
    if (!filters?.agentId) {
      result = allIntents
    } else {
      result = allIntents.filter(intent => !intent.agentId || intent.agentId === filters.agentId)
    }

    this.filteredCache.set(cacheKey, { intents: result, expiresAt: Date.now() + this.FILTERED_CACHE_TTL })
    return result
  }

  hasIntent(key: string): boolean {
    return this.dbIntents.has(key) || this.staticIntents.has(key)
  }

  getIntent(key: string, agentId?: string): Intent {
    const db = this.dbIntents.get(key)
    if (db) {
      if (agentId && db.agentId && db.agentId !== agentId) {
        throw new Error(`Intent "${key}" tidak tersedia untuk agent ini`)
      }
      return db
    }

    const stat = this.staticIntents.get(key)
    if (stat) {
      return stat
    }

    throw new Error(`Intent "${key}" tidak ditemukan`)
  }

  getBySlugs(slugs: string[], agentId?: string): Intent[] {
    const intents: Intent[] = []
    const seen = new Set<string>()

    for (const slug of slugs) {
      try {
        const intent = this.getIntent(slug, agentId)
        if (!seen.has(intent.slug)) {
          seen.add(intent.slug)
          intents.push(intent)
        }
      } catch {
        console.warn(`[Registry] Intent "${slug}" not found, skipping`)
      }
    }

    return intents
  }

  resolveExecution(intent: Intent) {
    if (intent.executionType === 'llm') {
      return { type: 'llm' }
    }

    throw new Error(`Intent "${intent.slug}" has no direct registry execution. Use tools, skills, or knowledge.`)
  }

  listIntents() {
    return [
      ...this.staticIntents.values(),
      ...this.dbIntents.values()
    ].map(i => ({
      id: i.id,
      slug: i.slug,
      name: i.name,
      executionType: i.executionType,
      tools: i.tools?.length ?? 0,
      knowledge: i.knowledge?.length ?? 0
    }))
  }
}

export const intentRegistry = new IntentRegistryService()
