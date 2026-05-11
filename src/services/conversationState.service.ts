import type { PendingIntentState } from '../types'

const TTL_MS = 1000 * 60 * 5 // 5 minutes
const MAX_RETRY_DEFAULT = 2
const STATE_VERSION = 2

class ConversationStateService {
  private store = new Map<string, PendingIntentState>()

  private key(userId: string, app: string) {
    return `${app}:${userId}`
  }

  // =========================================================
  // CREATE/UPDATE STATE
  // =========================================================
  set(userId: string, app: string, state: Partial<PendingIntentState>) {
    const now = Date.now()

    if (!state.intentSlug && !state.intentSlugs) {
      console.error("[State] Cannot store state without intent slug(s)")
      return
    }

    const isMultiIntent = Boolean(state.intentSlugs?.length)

    let missingToolsParams = state.missingToolsParams
    
    if (!missingToolsParams && state.missingParamsMap) {
      missingToolsParams = state.missingParamsMap.map(item => ({
        toolSlug: item.intentSlug,
        toolName: item.toolName || item.intentSlug,
        missing: item.missing
      }))
    }

    const fullState: PendingIntentState = {
      userId,
      appName: app,
      isMultiIntent,
      version: STATE_VERSION,
      intentSlug: state.intentSlug,
      intentSlugs: state.intentSlugs,
      collectedParams: state.collectedParams ?? {},
      missingToolsParams,
      originalPlan: state.originalPlan,
      retryCount: 0,
      maxRetry: state.maxRetry ?? MAX_RETRY_DEFAULT,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + TTL_MS,
      lastUserMessage: state.lastUserMessage,
    }

    this.store.set(this.key(userId, app), fullState)
    console.log("[State] Saved:", {
      intentSlugs: fullState.intentSlugs,
      missingToolsParams: fullState.missingToolsParams?.length,
      hasOriginalPlan: !!fullState.originalPlan
    })
  }

  // =========================================================
  // GET STATE (with TTL)
  // =========================================================
  get(userId: string, app: string): PendingIntentState | null {
    const key = this.key(userId, app)
    const state = this.store.get(key)

    if (!state) return null

    // Version guard - handle migration
    if (state.version !== STATE_VERSION) {
      console.log("[State] Version mismatch, attempting migration")
      const migrated = this.migrateState(state)
      if (migrated) {
        this.store.set(key, migrated)
        return migrated
      }
      console.warn("[State] Migration failed, clearing")
      this.clear(userId, app)
      return null
    }

    // TTL guard
    if (Date.now() > state.expiresAt) {
      console.log("[State] Expired → clearing")
      this.clear(userId, app)
      return null
    }

    return state
  }

  // =========================================================
  // MIGRATE OLD STATE TO NEW FORMAT
  // =========================================================
  private migrateState(oldState: any): PendingIntentState | null {
    const now = Date.now()
    
    let missingToolsParams = oldState.missingToolsParams
    
    if (!missingToolsParams && oldState.missingParamsMap) {
      missingToolsParams = oldState.missingParamsMap.map((item: any) => ({
        toolSlug: item.intentSlug,
        toolName: item.toolName || item.intentSlug,
        missing: Array.isArray(item.missing) ? item.missing : [item.missing]
      }))
    }

    return {
      userId: oldState.userId,
      appName: oldState.appName,
      isMultiIntent: oldState.isMultiIntent ?? Boolean(oldState.intentSlugs?.length),
      version: STATE_VERSION,
      intentSlug: oldState.intentSlug,
      intentSlugs: oldState.intentSlugs,
      collectedParams: oldState.collectedParams ?? {},
      missingToolsParams,
      originalPlan: oldState.originalPlan,
      retryCount: oldState.retryCount ?? 0,
      maxRetry: oldState.maxRetry ?? MAX_RETRY_DEFAULT,
      createdAt: oldState.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + TTL_MS,
      lastUserMessage: oldState.lastUserMessage,
    }
  }

  // =========================================================
  // UPDATE PARTIAL STATE
  // =========================================================
  update(userId: string, app: string, patch: Partial<PendingIntentState>) {
    const current = this.get(userId, app)
    if (!current) return

    let mergedMissingToolsParams = current.missingToolsParams
    if (patch.missingToolsParams) {
      mergedMissingToolsParams = patch.missingToolsParams
    }

    const updated: PendingIntentState = {
      ...current,
      ...patch,
      missingToolsParams: mergedMissingToolsParams,
      originalPlan: patch.originalPlan ?? current.originalPlan,
      updatedAt: Date.now(),
      expiresAt: Date.now() + TTL_MS
    }

    this.store.set(this.key(userId, app), updated)
    console.log("[State] Updated:", {
      intentSlugs: updated.intentSlugs,
      missingToolsParams: updated.missingToolsParams?.length,
      hasOriginalPlan: !!updated.originalPlan
    })
  }

  // =========================================================
  // RETRY HANDLING
  // =========================================================
  incrementRetry(userId: string, app: string): boolean {
    const state = this.get(userId, app)
    if (!state) return false

    const nextRetry = state.retryCount + 1

    if (nextRetry >= state.maxRetry) {
      console.log("[State] Retry limit reached → clearing")
      this.clear(userId, app)
      return false
    }

    this.update(userId, app, { retryCount: nextRetry })
    console.log(`[State] Retry increment → ${nextRetry}`)
    return true
  }

  // =========================================================
  // CLEAR STATE
  // =========================================================
  clear(userId: string, app: string) {
    this.store.delete(this.key(userId, app))
    console.log("[State] Cleared")
  }
}

export const conversationStateService = new ConversationStateService()