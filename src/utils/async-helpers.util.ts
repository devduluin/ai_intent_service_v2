// utils/async-helpers.util.ts
/**
 * Async Helper Utilities
 * 
 * Reusable async utilities for retry logic, timeouts, and delays.
 * Extracted from pipeline.service.ts for better modularity and testability.
 */

import { appLogger } from './logger.util';

// ============================================================
// TYPES
// ============================================================

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
}

// ============================================================
// CONSTANTS
// ============================================================

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 5000
};

// ============================================================
// SLEEP
// ============================================================

/**
 * Sleep for specified milliseconds
 * 
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after delay
 * 
 * @example
 * await sleep(1000); // Sleep for 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// WITH TIMEOUT
// ============================================================

/**
 * Execute promise with timeout
 * 
 * @param promise - Promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Name of operation for error message
 * @returns Promise<T>
 * 
 * @example
 * const result = await withTimeout(
 *   fetchData(),
 *   5000,
 *   'fetchData'
 * );
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return result;
  } catch (error) {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    throw error;
  }
}

// ============================================================
// WITH RETRY
// ============================================================

/**
 * Check if error is retryable
 */
function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  return (
    message.includes('timeout') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('503') ||
    message.includes('504') ||
    message.includes('500')
  );
}

/**
 * Execute async function with retry logic and exponential backoff
 * 
 * @param fn - Async function to execute
 * @param operationName - Name of operation for logging
 * @param config - Retry configuration
 * @returns Promise<T>
 * 
 * @example
 * const result = await withRetry(
 *   () => fetchData(),
 *   'fetchData',
 *   { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 }
 * );
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= config.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      if (attempt > config.maxRetries) {
        break;
      }

      // Check if retryable
      if (!isRetryableError(lastError)) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt - 1) + Math.random() * 100,
        config.maxDelay
      );

      appLogger.warn(`Retry attempt ${attempt}/${config.maxRetries} for ${operationName}`, {
        error: lastError.message,
        delayMs: delay
      });

      await sleep(delay);
    }
  }

  throw new Error(
    `${operationName} failed after ${attempt} attempts. Last error: ${lastError?.message}`
  );
}

/**
 * Execute with retry and return result object (no throw)
 * 
 * @param fn - Async function to execute
 * @param operationName - Name of operation for logging
 * @param config - Retry configuration
 * @returns RetryResult<T>
 * 
 * @example
 * const result = await withRetrySafe(
 *   () => fetchData(),
 *   'fetchData'
 * );
 * 
 * if (result.success) {
 *   console.log('Success:', result.result);
 * } else {
 *   console.error('Failed after', result.attempts, 'attempts');
 * }
 */
export async function withRetrySafe<T>(
  fn: () => Promise<T>,
  operationName: string,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<RetryResult<T>> {
  try {
    const result = await withRetry(fn, operationName, config);
    return {
      success: true,
      result,
      attempts: config.maxRetries + 1
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      attempts: config.maxRetries + 1
    };
  }
}

// ============================================================
// WITH RETRY AND TIMEOUT
// ============================================================

/**
 * Execute with both retry and timeout
 * 
 * @param fn - Async function to execute
 * @param operationName - Name of operation for logging
 * @param timeoutMs - Timeout per attempt
 * @param retryConfig - Retry configuration
 * @returns Promise<T>
 * 
 * @example
 * const result = await withRetryAndTimeout(
 *   () => fetchData(),
 *   'fetchData',
 *   5000,  // 5 second timeout per attempt
 *   { maxRetries: 3, baseDelay: 1000 }
 * );
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  operationName: string,
  timeoutMs: number,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  return withRetry(
    () => withTimeout(fn(), timeoutMs, operationName),
    operationName,
    retryConfig
  );
}

// ============================================================
// RACE UTILITIES
// ============================================================

/**
 * Race multiple promises and return the first successful one
 * 
 * @param promises - Array of promises to race
 * @param operationName - Name for logging
 * @returns Promise<T>
 * 
 * @example
 * const result = await raceToSuccess([
 *   fetchFromPrimary(),
 *   fetchFromBackup(),
 *   fetchFromCache()
 * ], 'fetchData');
 */
export async function raceToSuccess<T>(
  promises: Promise<T>[],
  operationName: string
): Promise<T> {
  const errors: Error[] = [];

  for (const promise of promises) {
    try {
      return await promise;
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
      appLogger.debug(`${operationName} attempt failed`, {
        error: errors[errors.length - 1].message
      });
    }
  }

  throw new Error(
    `${operationName} failed after ${promises.length} attempts: ${errors.map(e => e.message).join(', ')}`
  );
}

/**
 * Race with timeout - return first to complete or timeout
 * 
 * @param promises - Array of promises to race
 * @param timeoutMs - Maximum wait time
 * @param operationName - Name for logging
 * @returns Promise<T>
 * 
 * @example
 * const result = await raceWithTimeout([
 *   fetchFromPrimary(),
 *   fetchFromBackup()
 * ], 5000, 'fetchData');
 */
export async function raceWithTimeout<T>(
  promises: Promise<T>[],
  timeoutMs: number,
  operationName: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([...promises, timeoutPromise]);
}

// ============================================================
// BATCH PROCESSING
// ============================================================

/**
 * Process items in batches with concurrency limit
 * 
 * @param items - Items to process
 * @param processor - Async function to process each item
 * @param concurrency - Maximum concurrent operations
 * @returns Promise<T[]>
 * 
 * @example
 * const results = await processInBatches(
 *   items,
 *   async (item) => processItem(item),
 *   5 // 5 concurrent
 * );
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item, index) => processor(item, i + index))
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Process items with rate limiting
 * 
 * @param items - Items to process
 * @param processor - Async function to process each item
 * @param delayMs - Delay between each item
 * @returns Promise<T[]>
 * 
 * @example
 * const results = await processWithRateLimit(
 *   items,
 *   async (item) => processItem(item),
 *   100 // 100ms between each
 * );
 */
export async function processWithRateLimit<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  delayMs: number
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i++) {
    const result = await processor(items[i], i);
    results.push(result);
    
    if (i < items.length - 1) {
      await sleep(delayMs);
    }
  }

  return results;
}

// ============================================================
// CIRCUIT BREAKER (Simple)
// ============================================================

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
}

export class SimpleCircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = {
      failureThreshold: config.failureThreshold || 5,
      resetTimeout: config.resetTimeout || 60000
    };
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeout) {
        this.state = 'HALF_OPEN';
        appLogger.debug('Circuit breaker entering HALF_OPEN state');
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
        appLogger.debug('Circuit breaker reset to CLOSED');
      }
      
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      
      if (this.failures >= this.config.failureThreshold) {
        this.state = 'OPEN';
        appLogger.warn('Circuit breaker opened', {
          failures: this.failures,
          threshold: this.config.failureThreshold
        });
      }
      
      throw error;
    }
  }

  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.state;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureTime = 0;
    this.state = 'CLOSED';
    appLogger.debug('Circuit breaker manually reset');
  }
}
