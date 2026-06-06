import type { PendingIntentState } from '../types'
import { executeWithLock } from '../utils/distributed-lock.util'
import { appLogger } from '../utils/logger.util'
import { config } from '../config'

const TTL_MS = 1000 * 60 * 5 // 5 minutes
const MAX_RETRY_DEFAULT = config.slotFilling.maxRetry
const STATE_VERSION = 3
const LOCK_TTL_MS = 5000 // 5 seconds lock timeout

class ConversationStateService {
  private store = new Map<string, PendingIntentState>()

  constructor() {
    // Periodic eviction of expired state entries
    setInterval(() => {
      const now = Date.now()
      let expiredCount = 0
      for (const [key, state] of this.store) {
        if (now > state.expiresAt) {
          this.store.delete(key)
          expiredCount++
        }
      }
      if (expiredCount > 0) {
        appLogger.debug('[State] Periodic eviction completed', { expiredCount })
      }
    }, TTL_MS)
  }

  private key(userId: string, app: string) {
    return `${app}:${userId}`
  }

  private lockKey(userId: string, app: string) {
    return `conversation:${app}:${userId}`
  }

  // =========================================================
  // CREATE/UPDATE STATE (WITH LOCK)
  // =========================================================
  async set(userId: string, app: string, state: Partial<PendingIntentState>) {
    try {
      await executeWithLock(
        this.lockKey(userId, app),
        async () => {
          const now = Date.now()

          if (!state.intentSlug && !state.intentSlugs) {
            appLogger.warn("[State] Cannot store state without intent slug(s)", {
              userId,
              appName: app
            })
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
            missingResourceParams: state.missingResourceParams,
            originalPlan: state.originalPlan,
            retryCount: state.retryCount ?? 0,
            maxRetry: state.maxRetry ?? MAX_RETRY_DEFAULT,
            createdAt: now,
            updatedAt: now,
            expiresAt: now + TTL_MS,
            lastUserMessage: state.lastUserMessage,
            missingParams: state.missingParams || []  // ✅ Keep simple array for backward compat
          }

          this.store.set(this.key(userId, app), fullState)
          appLogger.debug("[State] Saved:", {
            userId,
            appName: app,
            intentSlugs: fullState.intentSlugs,
            missingToolsParams: fullState.missingToolsParams?.length,
            missingResourceParams: fullState.missingResourceParams?.length,
            hasOriginalPlan: !!fullState.originalPlan,
            retryCount: fullState.retryCount
          })
        },
        {
          ttlMs: LOCK_TTL_MS,
          retryDelayMs: 50,
          maxRetries: 100
        }
      )
    } catch (error) {
      appLogger.error("[State] Failed to set state (lock acquisition failed)", {
        userId,
        appName: app,
        error: error instanceof Error ? error.message : error
      })
      throw new Error(`Conversation state lock failed for user ${userId}`)
    }
  }

  // =========================================================
  // GET STATE (with TTL) - NO LOCK NEEDED FOR READS
  // =========================================================
  get(userId: string, app: string): PendingIntentState | null {
    const key = this.key(userId, app)
    const state = this.store.get(key)

    if (!state) return null

    // Version guard - handle migration
    if (state.version !== STATE_VERSION) {
      appLogger.debug("[State] Version mismatch, attempting migration", {
        userId,
        appName: app,
        currentVersion: state.version
      })
      const migrated = this.migrateState(state)
      if (migrated) {
        this.store.set(key, migrated)
        return migrated
      }
      appLogger.warn("[State] Migration failed, clearing", {
        userId,
        appName: app
      })
      this.clear(userId, app)
      return null
    }

    // TTL guard
    if (Date.now() > state.expiresAt) {
      appLogger.debug("[State] Expired → clearing", {
        userId,
        appName: app,
        expiredAt: new Date(state.expiresAt).toISOString()
      })
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
        missing: item.missing
      }))
    }

    return {
      userId: oldState.userId,
      appName: oldState.appName,
      isMultiIntent: Boolean(oldState.intentSlugs?.length),
      version: STATE_VERSION,
      intentSlug: oldState.intentSlug,
      intentSlugs: oldState.intentSlugs,
      collectedParams: oldState.collectedParams ?? {},
      missingToolsParams,
      missingResourceParams: oldState.missingResourceParams,
      originalPlan: oldState.originalPlan,
      retryCount: oldState.retryCount ?? 0,  // ✅ Default to 0
      maxRetry: oldState.maxRetry ?? MAX_RETRY_DEFAULT,
      createdAt: oldState.createdAt ?? now,
      updatedAt: now,
      expiresAt: now + TTL_MS,
      lastUserMessage: oldState.lastUserMessage,
      missingParams: oldState.missingParams || []  // ✅ Keep simple array
    }
  }

  // =========================================================
  // CLEAR STATE (WITH LOCK)
  // =========================================================
  async clear(userId: string, app: string) {
    try {
      await executeWithLock(
        this.lockKey(userId, app),
        async () => {
          this.store.delete(this.key(userId, app))
          appLogger.debug('[State] Cleared', { userId, appName: app })
        },
        {
          ttlMs: LOCK_TTL_MS,
          retryDelayMs: 50,
          maxRetries: 100
        }
      )
    } catch (error) {
      appLogger.error('[State] Failed to clear state (lock acquisition failed)', {
        userId,
        appName: app,
        error: error instanceof Error ? error.message : error
      })
      throw new Error(`Conversation state lock failed for user ${userId}`)
    }
  }

  // =========================================================
  // RETRY COUNT MANAGEMENT
  // =========================================================
  
  /**
   * Get current retry count
   */
  async getRetryCount(userId: string, appName: string): Promise<number> {
    const state = this.get(userId, appName)
    return state?.retryCount || 0
  }

  /**
   * Increment retry count, return new count
   */
  async incrementRetry(userId: string, appName: string): Promise<number> {
    const state = this.get(userId, appName)
    if (!state) {
      appLogger.warn('[State] Cannot increment retry - no state found', { userId, appName })
      return 0
    }
    
    const newRetryCount = (state.retryCount || 0) + 1
    
    await this.set(userId, appName, {
      ...state,
      retryCount: newRetryCount,
      updatedAt: Date.now()
    })
    
    appLogger.info('[State] Retry count incremented', {
      userId,
      appName,
      newRetryCount,
      maxRetry: state.maxRetry
    })
    
    return newRetryCount
  }

  /**
   * Reset retry count (on successful param collection)
   */
  async resetRetry(userId: string, appName: string): Promise<void> {
    const state = this.get(userId, appName)
    if (!state) return
    
    await this.set(userId, appName, {
      ...state,
      retryCount: 0,
      updatedAt: Date.now()
    })
    
    appLogger.debug('[State] Retry count reset', { userId, appName })
  }

  /**
   * Update missing params in state
   */
  async updateMissingParams(
    userId: string,
    appName: string,
    missingParams: string[]
  ): Promise<void> {
    const state = this.get(userId, appName)
    if (!state) return
    
    await this.set(userId, appName, {
      ...state,
      missingToolsParams: state.missingToolsParams?.map(m => ({
        ...m,
        missing: missingParams
      })) || [],
      missingResourceParams: state.missingResourceParams
        ?.map(m => ({
          ...m,
          missing: m.missing.filter(paramName => missingParams.includes(paramName))
        }))
        .filter(m => m.missing.length > 0),
      missingParams,  // Keep simple missingParams array for backward compat
      updatedAt: Date.now()
    })
    
    appLogger.debug('[State] Missing params updated', {
      userId,
      appName,
      missingParamsCount: missingParams.length
    })
  }

  /**
   * Update collected params in state
   */
  async updateCollectedParams(
    userId: string,
    appName: string,
    collectedParams: Record<string, unknown>
  ): Promise<void> {
    const state = this.get(userId, appName)
    if (!state) return
    
    await this.set(userId, appName, {
      ...state,
      collectedParams: {
        ...state.collectedParams,
        ...collectedParams
      },
      updatedAt: Date.now()
    })
    
    appLogger.debug('[State] Collected params updated', {
      userId,
      appName,
      collectedParamsCount: Object.keys(collectedParams).length
    })
  }

  /**
   * Batch update: missing params + collected params in one lock
   */
  async updateSlotState(
    userId: string,
    appName: string,
    opts: {
      missingParams?: string[]
      collectedParams?: Record<string, unknown>
    }
  ): Promise<void> {
    const state = this.get(userId, appName)
    if (!state) return

    const updates: Partial<PendingIntentState> = { updatedAt: Date.now() }

    if (opts.missingParams) {
      updates.missingToolsParams = state.missingToolsParams?.map(m => ({
        ...m,
        missing: opts.missingParams!
      })) || []
      updates.missingResourceParams = state.missingResourceParams
        ?.map(m => ({
          ...m,
          missing: m.missing.filter(paramName => opts.missingParams!.includes(paramName))
        }))
        .filter(m => m.missing.length > 0)
      updates.missingParams = opts.missingParams
    }

    if (opts.collectedParams) {
      updates.collectedParams = { ...state.collectedParams, ...opts.collectedParams }
    }

    await this.set(userId, appName, { ...state, ...updates })

    appLogger.debug('[State] Slot state batch updated', {
      userId,
      appName,
      missingParams: opts.missingParams?.length,
      collectedParams: opts.collectedParams ? Object.keys(opts.collectedParams).length : 0
    })
  }
}

export const conversationStateService = new ConversationStateService()
