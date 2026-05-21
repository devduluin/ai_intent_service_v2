import type { PendingIntentState } from '../types'
import { executeWithLock } from '../utils/distributed-lock.util'
import { appLogger } from '../utils/logger.util'

const TTL_MS = 1000 * 60 * 5 // 5 minutes
const MAX_RETRY_DEFAULT = 2
const STATE_VERSION = 2
const LOCK_TTL_MS = 5000 // 5 seconds lock timeout

class ConversationStateService {
  private store = new Map<string, PendingIntentState>()

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
            originalPlan: state.originalPlan,
            retryCount: 0,
            maxRetry: state.maxRetry ?? MAX_RETRY_DEFAULT,
            createdAt: now,
            updatedAt: now,
            expiresAt: now + TTL_MS,
            lastUserMessage: state.lastUserMessage,
          }

          this.store.set(this.key(userId, app), fullState)
          appLogger.debug("[State] Saved:", {
            userId,
            appName: app,
            intentSlugs: fullState.intentSlugs,
            missingToolsParams: fullState.missingToolsParams?.length,
            hasOriginalPlan: !!fullState.originalPlan
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
  // UPDATE PARTIAL STATE (WITH LOCK)
  // =========================================================
  async update(userId: string, app: string, patch: Partial<PendingIntentState>) {
    try {
      await executeWithLock(
        this.lockKey(userId, app),
        async () => {
          const current = this.get(userId, app)
          if (!current) {
            appLogger.warn("[State] Cannot update non-existent state", {
              userId,
              appName: app
            })
            return
          }

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
          appLogger.debug("[State] Updated:", {
            userId,
            appName: app,
            intentSlugs: updated.intentSlugs,
            missingToolsParams: updated.missingToolsParams?.length,
            hasOriginalPlan: !!updated.originalPlan
          })
        },
        {
          ttlMs: LOCK_TTL_MS,
          retryDelayMs: 50,
          maxRetries: 100
        }
      )
    } catch (error) {
      appLogger.error("[State] Failed to update state (lock acquisition failed)", {
        userId,
        appName: app,
        error: error instanceof Error ? error.message : error
      })
      throw new Error(`Conversation state update lock failed for user ${userId}`)
    }
  }

  // =========================================================
  // RETRY HANDLING (WITH LOCK)
  // =========================================================
  async incrementRetry(userId: string, app: string): Promise<boolean> {
    try {
      let success = false;

      await executeWithLock(
        this.lockKey(userId, app),
        async () => {
          const state = this.get(userId, app)
          if (!state) {
            appLogger.warn("[State] Cannot increment retry for non-existent state", {
              userId,
              appName: app
            })
            return
          }

          const nextRetry = state.retryCount + 1

          if (nextRetry >= state.maxRetry) {
            appLogger.info("[State] Retry limit reached → clearing", {
              userId,
              appName: app,
              retryCount: nextRetry,
              maxRetry: state.maxRetry
            })
            this.clear(userId, app)
            return
          }

          this.store.set(this.key(userId, app), {
            ...state,
            retryCount: nextRetry,
            updatedAt: Date.now()
          })

          appLogger.debug(`[State] Retry increment → ${nextRetry}`, {
            userId,
            appName: app
          })

          success = true;
        },
        {
          ttlMs: LOCK_TTL_MS,
          retryDelayMs: 50,
          maxRetries: 100
        }
      )

      return success;
    } catch (error) {
      appLogger.error("[State] Failed to increment retry (lock acquisition failed)", {
        userId,
        appName: app,
        error: error instanceof Error ? error.message : error
      })
      return false
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
          appLogger.debug("[State] Cleared", {
            userId,
            appName: app
          })
        },
        {
          ttlMs: LOCK_TTL_MS,
          retryDelayMs: 50,
          maxRetries: 10
        }
      )
    } catch (error) {
      appLogger.error("[State] Failed to clear state (lock acquisition failed)", {
        userId,
        appName: app,
        error: error instanceof Error ? error.message : error
      })
      // Still delete even if lock fails (best effort)
      this.store.delete(this.key(userId, app))
    }
  }
}

export const conversationStateService = new ConversationStateService()