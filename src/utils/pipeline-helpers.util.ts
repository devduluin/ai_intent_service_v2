// utils/pipeline-helpers.util.ts
/**
 * Pipeline Helper Utilities
 * 
 * Reusable utility functions extracted from pipeline.service.ts
 * for better modularity, testability, and code organization.
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

export interface TimeoutConfig {
  timeoutMs: number;
  operationName: string;
}

export interface PipelineTiming {
  startTime: number;
  label: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelay: 500,
  maxDelay: 5000
};

export const DEFAULT_TIMEOUT_MS = 15000;

// ============================================================
// RETRY WITH EXPONENTIAL BACKOFF
// ============================================================

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
      const message = lastError.message.toLowerCase();
      const isRetryable =
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('econnreset') ||
        message.includes('503') ||
        message.includes('504');

      if (!isRetryable) {
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

// ============================================================
// TIMEOUT WRAPPER
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
// SLEEP HELPER
// ============================================================

/**
 * Sleep for specified milliseconds
 * 
 * @param ms - Milliseconds to sleep
 * @returns Promise<void>
 * 
 * @example
 * await sleep(1000); // Sleep for 1 second
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// TIMING UTILITIES
// ============================================================

/**
 * Start timing an operation
 * 
 * @param label - Label for the timing
 * @returns PipelineTiming object
 * 
 * @example
 * const timing = startTiming('database-query');
 * // ... operation
 * const duration = getTimingDuration(timing);
 */
export function startTiming(label: string): PipelineTiming {
  return {
    startTime: Date.now(),
    label
  };
}

/**
 * Get duration from timing object
 * 
 * @param timing - Timing object from startTiming
 * @returns Duration in milliseconds
 */
export function getTimingDuration(timing: PipelineTiming): number {
  return Date.now() - timing.startTime;
}

/**
 * Execute function with timing
 * 
 * @param fn - Async function to execute
 * @param label - Label for timing
 * @returns Promise<{ result: T, duration: number }>
 * 
 * @example
 * const { result, duration } = await executeWithTiming(
 *   () => fetchData(),
 *   'fetchData'
 * );
 */
export async function executeWithTiming<T>(
  fn: () => Promise<T>,
  label: string
): Promise<{ result: T; duration: number }> {
  const timing = startTiming(label);
  const result = await fn();
  const duration = getTimingDuration(timing);
  
  return { result, duration };
}

// ============================================================
// BATCH PROCESSING
// ============================================================

/**
 * Split array into chunks for batch processing
 * 
 * @param array - Array to chunk
 * @param size - Size of each chunk
 * @returns Array of chunks
 * 
 * @example
 * const chunks = chunkArray([1,2,3,4,5], 2);
 * // [[1,2], [3,4], [5]]
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process array in batches with concurrency limit
 * 
 * @param array - Array to process
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
  array: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number = 5
): Promise<R[]> {
  const results: R[] = [];
  const chunks = chunkArray(array, concurrency);

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((item, index) => processor(item, index))
    );
    results.push(...chunkResults);
  }

  return results;
}

// ============================================================
// NULL SAFETY
// ============================================================

/**
 * Safely get nested property with default value
 * 
 * @param obj - Object to query
 * @param path - Dot-notation path (e.g., 'user.address.city')
 * @param defaultValue - Default value if path doesn't exist
 * @returns Value at path or default
 * 
 * @example
 * const city = safeGet(user, 'address.city', 'Unknown');
 */
export function safeGet<T>(
  obj: any,
  path: string,
  defaultValue?: T
): T | undefined {
  try {
    const value = path.split('.').reduce((acc, part) => {
      return acc?.[part];
    }, obj);
    
    return value !== undefined ? value : (defaultValue as T);
  } catch {
    return defaultValue as T;
  }
}

/**
 * Check if value is defined (not null or undefined)
 * 
 * @param value - Value to check
 * @returns boolean
 * 
 * @example
 * if (isDefined(value)) { ... }
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

// ============================================================
// ARRAY UTILITIES
// ============================================================

/**
 * Remove duplicates from array using Set
 * 
 * @param array - Array to deduplicate
 * @returns Array with unique values
 * 
 * @example
 * const unique = uniqueArray([1,2,2,3,3,3]);
 * // [1,2,3]
 */
export function uniqueArray<T>(array: T[]): T[] {
  return Array.from(new Set(array));
}

/**
 * Compact array (remove null/undefined)
 * 
 * @param array - Array to compact
 * @returns Array with non-null values
 * 
 * @example
 * const compact = compactArray([1,null,2,undefined,3]);
 * // [1,2,3]
 */
export function compactArray<T>(array: (T | null | undefined)[]): T[] {
  return array.filter(isDefined) as T[];
}

/**
 * Flatten nested object keys with dot notation
 * 
 * @param obj - Object to flatten
 * @param prefix - Prefix for keys
 * @returns Flattened object
 * 
 * @example
 * flattenObject({ a: { b: 1 } });
 * // { 'a.b': 1 }
 */
export function flattenObject(obj: any, prefix = ''): Record<string, any> {
  return Object.keys(obj).reduce((acc, key) => {
    const value = obj[key];
    const newKey = prefix ? `${prefix}.${key}` : key;
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(acc, flattenObject(value, newKey));
    } else {
      acc[newKey] = value;
    }
    
    return acc;
  }, {} as Record<string, any>);
}

// ============================================================
// STRING UTILITIES
// ============================================================

/**
 * Truncate string with ellipsis
 * 
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @returns Truncated string
 * 
 * @example
 * truncate('Hello World', 8);
 * // 'Hello...'
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

/**
 * Generate hash from string
 * 
 * @param str - String to hash
 * @returns Hash string
 * 
 * @example
 * const hash = simpleHash('hello');
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
