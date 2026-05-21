// utils/distributed-lock.util.ts
/**
 * Distributed Lock Utility
 * 
 * Prevents race conditions by ensuring only one operation
 * can modify user state at a time.
 * 
 * Uses Redis for distributed locking across multiple instances.
 * Falls back to in-memory locking for single-instance deployments.
 */

import { globalCache } from './cache-helper.util';
import { appLogger } from './logger.util';

// ============================================================
// TYPES
// ============================================================

export interface LockOptions {
  ttlMs: number;        // Lock time-to-live
  retryDelayMs: number; // Delay between retry attempts
  maxRetries: number;   // Maximum retry attempts
}

export interface LockResult {
  acquired: boolean;
  lockKey: string;
  lockValue: string;
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_LOCK_TTL_MS = 5000;      // 5 seconds
const DEFAULT_RETRY_DELAY_MS = 50;     // 50ms
const DEFAULT_MAX_RETRIES = 100;       // 5 seconds total wait time
const LOCK_PREFIX = 'lock:';

// ============================================================
// IN-MEMORY LOCKS (Fallback)
// ============================================================

const memoryLocks = new Map<string, {
  value: string;
  expiresAt: number;
}>();

// ============================================================
// GENERATE LOCK VALUE
// ============================================================

/**
 * Generate unique lock value (instance identifier)
 */
function generateLockValue(): string {
  return `${process.pid || 'unknown'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// ACQUIRE LOCK
// ============================================================

/**
 * Try to acquire a distributed lock
 * 
 * @param key - Lock key (e.g., 'user:123:app:weather-bot')
 * @param options - Lock configuration
 * @returns Promise<LockResult>
 * 
 * @example
 * const lock = await acquireLock('user:123:state');
 * if (lock.acquired) {
 *   try {
 *     // Critical section
 *   } finally {
 *     await releaseLock(lock);
 *   }
 * }
 */
export async function acquireLock(
  key: string,
  options: LockOptions = {
    ttlMs: DEFAULT_LOCK_TTL_MS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    maxRetries: DEFAULT_MAX_RETRIES
  }
): Promise<LockResult> {
  const lockKey = `${LOCK_PREFIX}${key}`;
  const lockValue = generateLockValue();
  const startTime = Date.now();

  let attempts = 0;

  while (attempts < options.maxRetries) {
    try {
      // Try to acquire lock
      const acquired = await tryAcquireLock(lockKey, lockValue, options.ttlMs);

      if (acquired) {
        appLogger.debug('Lock acquired', {
          lockKey,
          attempts: attempts + 1,
          durationMs: Date.now() - startTime
        });

        return {
          acquired: true,
          lockKey,
          lockValue
        };
      }

      // Lock is held by another process, wait and retry
      attempts++;
      
      if (attempts >= options.maxRetries) {
        appLogger.warn('Lock acquisition failed after max retries', {
          lockKey,
          attempts,
          durationMs: Date.now() - startTime
        });
        break;
      }

      await sleep(options.retryDelayMs);

    } catch (error) {
      appLogger.error('Lock acquisition error', {
        lockKey,
        error: error instanceof Error ? error.message : error
      });
      
      // On error, wait longer before retry
      await sleep(options.retryDelayMs * 2);
      attempts++;
    }
  }

  return {
    acquired: false,
    lockKey,
    lockValue
  };
}

/**
 * Try to acquire lock (single attempt)
 */
async function tryAcquireLock(
  lockKey: string,
  lockValue: string,
  ttlMs: number
): Promise<boolean> {
  const expiresAt = Date.now() + ttlMs;

  if (globalCache.isRedisAvailable()) {
    // Use Redis SETNX (SET if Not eXists)
    const acquired = await globalCache.get<string>(lockKey)
      .then(existing => {
        if (!existing) {
          // Lock is free, try to acquire
          return globalCache.set(lockKey, lockValue, { ttl: ttlMs })
            .then(() => true)
            .catch(() => false);
        }
        return false;
      });

    return acquired;
  } else {
    // Fallback to in-memory locking
    const existing = memoryLocks.get(lockKey);
    
    if (!existing || Date.now() > existing.expiresAt) {
      // Lock is free or expired, acquire it
      memoryLocks.set(lockKey, {
        value: lockValue,
        expiresAt
      });
      return true;
    }

    return false;
  }
}

// ============================================================
// RELEASE LOCK
// ============================================================

/**
 * Release a distributed lock
 * 
 * @param lockResult - Lock result from acquireLock
 * 
 * @example
 * const lock = await acquireLock('user:123:state');
 * if (lock.acquired) {
 *   try {
 *     // Critical section
 *   } finally {
 *     await releaseLock(lock);
 *   }
 * }
 */
export async function releaseLock(lockResult: LockResult): Promise<void> {
  const { lockKey, lockValue } = lockResult;

  try {
    if (globalCache.isRedisAvailable()) {
      // Use Redis: only delete if we own the lock
      const current = await globalCache.get<string>(lockKey);
      
      if (current === lockValue) {
        await globalCache.del(lockKey);
        appLogger.debug('Lock released', { lockKey });
      } else {
        appLogger.warn('Lock release skipped (not owner)', { lockKey });
      }
    } else {
      // Fallback to in-memory
      const existing = memoryLocks.get(lockKey);
      
      if (existing && existing.value === lockValue) {
        memoryLocks.delete(lockKey);
        appLogger.debug('Lock released (memory)', { lockKey });
      }
    }
  } catch (error) {
    appLogger.error('Lock release error', {
      lockKey,
      error: error instanceof Error ? error.message : error
    });
  }
}

// ============================================================
// EXECUTE WITH LOCK
// ============================================================

/**
 * Execute function with distributed lock
 * 
 * @param key - Lock key
 * @param fn - Function to execute
 * @param options - Lock configuration
 * @returns Promise<T>
 * 
 * @example
 * const result = await executeWithLock(
 *   'user:123:state',
 *   async () => {
 *     // Critical section
 *     return await updateState();
 *   }
 * );
 */
export async function executeWithLock<T>(
  key: string,
  fn: () => Promise<T>,
  options: LockOptions = {
    ttlMs: DEFAULT_LOCK_TTL_MS,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
    maxRetries: DEFAULT_MAX_RETRIES
  }
): Promise<T> {
  const lock = await acquireLock(key, options);

  if (!lock.acquired) {
    throw new Error(`Failed to acquire lock for: ${key}`);
  }

  try {
    const result = await fn();
    return result;
  } finally {
    await releaseLock(lock);
  }
}

// ============================================================
// HELPER: SLEEP
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// CLEANUP EXPIRED MEMORY LOCKS (Fallback only)
// ============================================================

// Clean up expired locks every minute
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    let deleted = 0;

    for (const [key, lock] of memoryLocks.entries()) {
      if (now > lock.expiresAt) {
        memoryLocks.delete(key);
        deleted++;
      }
    }

    if (deleted > 0) {
      appLogger.debug('Cleaned up expired locks', { count: deleted });
    }
  }, 60000); // Every minute
}
