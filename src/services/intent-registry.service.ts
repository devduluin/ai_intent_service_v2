import type { Intent, ApiHandlerFn } from '../types'
import { intentRepository } from '../repositories/intent.repository'

class IntentRegistryService {

  // =========================================================
  // SOURCES
  // =========================================================
  private dbIntents: Map<string, Intent> = new Map()
  private staticIntents: Map<string, Intent> = new Map()
  private handlers: Map<string, ApiHandlerFn> = new Map()

  private strictMode = true

  // =========================================================
  // REGISTER HANDLER (CODE LAYER ONLY)
  // =========================================================
  registerHandler(key: string, handler: ApiHandlerFn): void {
    if (this.handlers.has(key)) {
      throw new Error(`Handler "${key}" sudah terdaftar.`)
    }

    this.handlers.set(key, handler)
  }

  // =========================================================
  // REGISTER STATIC INTENTS (OPTIONAL)
  // =========================================================
  registerMany(entries: Array<{ intent: Intent; handler: ApiHandlerFn }>): void {
    for (const entry of entries) {

      this.staticIntents.set(entry.intent.slug, entry.intent)

      if (entry.intent.handlerKey && entry.handler) {
        this.handlers.set(entry.intent.handlerKey, entry.handler)
      }
    }
  }

  // =========================================================
  // SYNC DB INTENTS (SOURCE OF TRUTH)
  // =========================================================
  async syncFromDatabase(): Promise<void> {

    const dbIntents = await intentRepository.findAllActive({ agentId: null })

    console.log(`[Registry] Syncing ${dbIntents.length} intents from DB`)

    this.dbIntents.clear()

    for (const intent of dbIntents) {

      const normalized: Intent = {
        ...intent,
        tools: [...(intent.tools ?? [])],
        knowledge: [...(intent.knowledge ?? [])],
      }

      this.dbIntents.set(normalized.slug, normalized)

      // =========================================================
      // VALIDATION (HANDLER CHECK)
      // =========================================================
      if (normalized.executionType === 'handler') {

        const key = normalized.handlerKey

        if (!key) {
          throw new Error(`Intent ${normalized.slug} tidak punya handlerKey`)
        }

        if (!this.handlers.has(key)) {

          if (this.strictMode) {
            throw new Error(
              `Handler "${key}" belum diregister (intent: ${normalized.slug})`
            )
          }

          console.warn(`[Registry] Missing handler: ${key}`)
        }
      }
    }
  }

  // =========================================================
  // GET ALL (MERGED VIEW) - WITH AGENT FILTERING
  // =========================================================
  getAll(filters?: { agentId?: string }): Intent[] {
    const allIntents = [
      ...this.staticIntents.values(),
      ...this.dbIntents.values()
    ]

    if (!filters?.agentId) {
      return allIntents
    }

    return allIntents.filter(intent => {
      // Intent available if:
      // 1. No agentId specified (global intent) OR
      // 2. agentId matches exactly
      return !intent.agentId || intent.agentId === filters.agentId
    })
  }

  // =========================================================
  // CHECK INTENT EXISTS
  // =========================================================
  hasIntent(key: string): boolean {
    console.log(`[Registry] Checking intent exists: ${key}`)
    return this.dbIntents.has(key) || this.staticIntents.has(key)
  }

  // =========================================================
  // GET INTENT (DB FIRST → STATIC FALLBACK)
  // =========================================================
  getIntent(key: string, agentId?: string): Intent {
    const db = this.dbIntents.get(key)
    if (db) {
      // Validate agent access if agentId provided
      if (agentId && db.agentId && db.agentId !== agentId) {
        throw new Error(`Intent "${key}" tidak tersedia untuk agent ini`)
      }
      return db
    }

    const stat = this.staticIntents.get(key)
    if (stat) {
      // Static intents are accessible by all agents
      return stat
    }

    throw new Error(`Intent "${key}" tidak ditemukan`)
  }

  // =========================================================
  // GET HANDLER (SAFE)
  // =========================================================
  getHandler(key: string): ApiHandlerFn {

    const handler = this.handlers.get(key)

    if (!handler) {
      throw new Error(`Handler "${key}" tidak ditemukan`)
    }

    return handler
  }

  // =========================================================
  // GET MULTIPLE INTENTS BY SLUGS
  // =========================================================
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
      } catch (err) {
        console.warn(`[Registry] Intent "${slug}" not found, skipping`)
      }
    }
    
    return intents
  }
  

  // =========================================================
  // EXECUTION RESOLVER (CORE ENGINE)
  // =========================================================
  resolveExecution(intent: Intent) {

    switch (intent.executionType) {

      // -------------------------
      // HANDLER EXECUTION
      // -------------------------
      case 'handler': {
        if (!intent.handlerKey) {
          throw new Error(`handlerKey kosong untuk ${intent.slug}`)
        }

        const handler = this.handlers.get(intent.handlerKey)

        if (!handler) {
          throw new Error(`Handler "${intent.handlerKey}" tidak ditemukan`)
        }

        return handler
      }

      // -------------------------
      // LLM FALLBACK
      // -------------------------
      case 'llm':
        return { type: 'llm' }

      default:
        throw new Error(`Unknown executionType: ${intent.executionType}`)
    }
  }

  // =========================================================
  // DEBUG / OBSERVABILITY
  // =========================================================
  listIntents() {
    return [
      ...this.staticIntents.values(),
      ...this.dbIntents.values()
    ].map(i => ({
      id: i.id,
      slug: i.slug,
      name: i.name,
      executionType: i.executionType,
      hasHandler: !!i.handlerKey,
      tools: i.tools?.length ?? 0,
      knowledge: i.knowledge?.length ?? 0
    }))
  }
}

export const intentRegistry = new IntentRegistryService()