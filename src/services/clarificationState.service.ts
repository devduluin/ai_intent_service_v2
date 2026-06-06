import { config } from '../config';
import type { ClarificationState } from '../types/clarification-state.types';
import type { PlannerOutput } from '../types/planner.types';
import { executeWithLock } from '../utils/distributed-lock.util';
import { appLogger } from '../utils/logger.util';

const TTL_MS = 1000 * 60 * 5;
const LOCK_TTL_MS = 5000;
const STATE_VERSION = 1;

class ClarificationStateService {
  private store = new Map<string, ClarificationState>();

  private key(userId: string, appName: string): string {
    return `${appName}:${userId}`;
  }

  private lockKey(userId: string, appName: string): string {
    return `clarification:${appName}:${userId}`;
  }

  async set(
    userId: string,
    appName: string,
    state: {
      originalText: string;
      clarificationQuestion: string;
      originalPlan?: PlannerOutput | null;
      retryCount?: number;
      maxRetry?: number;
    }
  ): Promise<void> {
    await executeWithLock(
      this.lockKey(userId, appName),
      async () => {
        const now = Date.now();
        const fullState: ClarificationState = {
          userId,
          appName,
          version: STATE_VERSION,
          originalText: state.originalText,
          clarificationQuestion: state.clarificationQuestion,
          originalPlan: state.originalPlan,
          retryCount: state.retryCount ?? 0,
          maxRetry: state.maxRetry ?? config.slotFilling.maxRetry,
          createdAt: now,
          updatedAt: now,
          expiresAt: now + TTL_MS
        };

        this.store.set(this.key(userId, appName), fullState);

        appLogger.debug('[ClarificationState] Saved', {
          userId,
          appName,
          retryCount: fullState.retryCount,
          hasOriginalPlan: !!fullState.originalPlan
        });
      },
      {
        ttlMs: LOCK_TTL_MS,
        retryDelayMs: 50,
        maxRetries: 100
      }
    );
  }

  get(userId: string, appName: string): ClarificationState | null {
    const key = this.key(userId, appName);
    const state = this.store.get(key);
    if (!state) return null;

    if (state.version !== STATE_VERSION || Date.now() > state.expiresAt) {
      this.store.delete(key);
      appLogger.debug('[ClarificationState] Expired or version mismatch, cleared', {
        userId,
        appName
      });
      return null;
    }

    return state;
  }

  async incrementRetry(userId: string, appName: string): Promise<number> {
    const state = this.get(userId, appName);
    if (!state) return 0;

    const retryCount = state.retryCount + 1;
    await this.set(userId, appName, {
      originalText: state.originalText,
      clarificationQuestion: state.clarificationQuestion,
      originalPlan: state.originalPlan,
      retryCount,
      maxRetry: state.maxRetry
    });

    return retryCount;
  }

  async clear(userId: string, appName: string): Promise<void> {
    await executeWithLock(
      this.lockKey(userId, appName),
      async () => {
        this.store.delete(this.key(userId, appName));
        appLogger.debug('[ClarificationState] Cleared', { userId, appName });
      },
      {
        ttlMs: LOCK_TTL_MS,
        retryDelayMs: 50,
        maxRetries: 100
      }
    );
  }
}

export const clarificationStateService = new ClarificationStateService();
