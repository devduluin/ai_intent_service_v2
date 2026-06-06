import { randomUUID } from 'crypto';
import type { PendingConfirmation, ConfirmationStatus } from '../types/confirmation.types';
import { executeWithLock } from '../utils/distributed-lock.util';
import { appLogger } from '../utils/logger.util';
import { globalCache } from '../utils/cache-helper.util';

const DEFAULT_TTL_MS = 60 * 1000;
const LOCK_TTL_MS = 5000;

export class ConfirmationStateService {
  async set(
    userId: string,
    appName: string,
    state: Omit<PendingConfirmation, 'id' | 'userId' | 'appName' | 'status' | 'createdAt' | 'updatedAt' | 'expiresAt'> & {
      id?: string;
      status?: ConfirmationStatus;
      ttlMs?: number;
      expiresAt?: number;
    }
  ): Promise<PendingConfirmation> {
    let saved!: PendingConfirmation;

    await executeWithLock(this.lockKey(userId, appName), async () => {
      const now = Date.now();
      saved = {
        id: state.id || `confirmation_${randomUUID()}`,
        userId,
        appName,
        type: state.type,
        status: state.status || 'pending',
        draft: state.draft,
        editableFields: state.editableFields,
        commitAction: state.commitAction,
        createdAt: now,
        updatedAt: now,
        expiresAt: state.expiresAt || now + (state.ttlMs || DEFAULT_TTL_MS)
      };

      await globalCache.set(this.key(userId, appName), saved, {
        ttl: Math.max(saved.expiresAt - now, 1000),
        redisKey: this.redisKey(userId, appName)
      });
      appLogger.debug('[ConfirmationState] Saved', {
        userId,
        appName,
        type: saved.type,
        status: saved.status,
        expiresAt: saved.expiresAt
      });
    }, { ttlMs: LOCK_TTL_MS, retryDelayMs: 50, maxRetries: 20 });

    return saved;
  }

  async get(userId: string, appName: string): Promise<PendingConfirmation | null> {
    const confirmation = await globalCache.get<PendingConfirmation>(this.key(userId, appName), {
      redisKey: this.redisKey(userId, appName)
    });
    if (!confirmation) return null;

    if (confirmation.expiresAt <= Date.now()) {
      await this.clear(userId, appName);
      return {
        ...confirmation,
        status: 'expired',
        updatedAt: Date.now()
      };
    }

    return confirmation;
  }

  async patch(
    userId: string,
    appName: string,
    patch: Record<string, unknown>
  ): Promise<PendingConfirmation | null> {
    let updated: PendingConfirmation | null = null;

    await executeWithLock(this.lockKey(userId, appName), async () => {
      const current = await globalCache.get<PendingConfirmation>(this.key(userId, appName), {
        redisKey: this.redisKey(userId, appName)
      });
      if (!current) return;

      const now = Date.now();
      updated = {
        ...current,
        status: 'edited',
        draft: this.deepMerge(current.draft, patch),
        updatedAt: now,
        expiresAt: now + DEFAULT_TTL_MS
      };
      await globalCache.set(this.key(userId, appName), updated, {
        ttl: DEFAULT_TTL_MS,
        redisKey: this.redisKey(userId, appName)
      });
    }, { ttlMs: LOCK_TTL_MS, retryDelayMs: 50, maxRetries: 20 });

    return updated;
  }

  async clear(userId: string, appName: string): Promise<void> {
    await executeWithLock(this.lockKey(userId, appName), async () => {
      await globalCache.del(this.key(userId, appName), {
        redisKey: this.redisKey(userId, appName)
      });
    }, { ttlMs: LOCK_TTL_MS, retryDelayMs: 50, maxRetries: 20 });
  }

  private key(userId: string, appName: string): string {
    return `confirmation:${appName}:${userId}`;
  }

  private redisKey(userId: string, appName: string): string {
    return `confirmation:${appName}:${userId}`;
  }

  private lockKey(userId: string, appName: string): string {
    return `confirmation:${appName}:${userId}`;
  }

  private deepMerge(base: Record<string, any>, patch: Record<string, any>): Record<string, any> {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        result[key] &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = this.deepMerge(result[key], value as Record<string, any>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

export const confirmationStateService = new ConfirmationStateService();
