// ============================================================
// Hash Utility
// ============================================================
// Provides hashing functions for parameter-based cache keys
// ============================================================

import * as crypto from 'crypto';

// ============================================================
// Types
// ============================================================

export interface HashOptions {
  algorithm?: string;  // Default: 'md5'
  length?: number;     // Default: 8 (characters)
}

// ============================================================
// Hash Functions
// ============================================================

/**
 * Create hash from string data
 *
 * @param data - String to hash
 * @param options - Hash options (algorithm, length)
 * @returns Hashed string
 */
export function createHash(data: string, options?: HashOptions): string {
  const algorithm = options?.algorithm || 'md5';
  const length = options?.length || 8;

  const hash = crypto.createHash(algorithm);
  hash.update(data);
  
  return hash.digest('hex').substring(0, length);
}

/**
 * Hash parameters for cache key generation
 * Creates consistent hash from parameter object
 *
 * @param params - Parameters to hash
 * @returns Short hash string (8 chars by default)
 *
 * Example:
 * hashParams({ city: 'jakarta', date: '2024-01-15' })
 *   → 'abc123ef'
 */
export function hashParams(params: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) {
    return 'empty';
  }

  // Sort keys for consistent hashing
  const sortedKeys = Object.keys(params).sort();
  
  // Create param string: key1=value1|key2=value2|...
  const paramStr = sortedKeys
    .map(key => {
      const value = params[key];
      // Handle null/undefined
      if (value === null || value === undefined) {
        return `${key}=null`;
      }
      // Handle objects (stringify)
      if (typeof value === 'object') {
        return `${key}=${JSON.stringify(value)}`;
      }
      // Handle primitives
      return `${key}=${value}`;
    })
    .join('|');

  // Hash the parameter string
  return createHash(paramStr, { length: 8 });
}

/**
 * Check if two parameter objects are equal (by hash)
 *
 * @param params1 - First parameter object
 * @param params2 - Second parameter object
 * @returns True if hashes match
 */
export function paramsEqual(
  params1: Record<string, unknown>,
  params2: Record<string, unknown>
): boolean {
  return hashParams(params1) === hashParams(params2);
}

/**
 * Get hash for specific entity type from params
 * Useful for entity-specific cache keys
 *
 * @param params - Parameters to hash
 * @param entityType - Entity type to extract (e.g., 'city', 'date')
 * @returns Hash of entity value or 'none'
 *
 * Example:
 * getEntityHash({ city: 'jakarta', date: '2024-01-15' }, 'city')
 *   → hash of 'jakarta'
 */
export function getEntityHash(
  params: Record<string, unknown>,
  entityType: string
): string {
  const entityValue = params[entityType];
  
  if (entityValue === null || entityValue === undefined) {
    return 'none';
  }

  return createHash(String(entityValue), { length: 8 });
}

// ============================================================
// Cache Key Generation
// ============================================================

/**
 * Generate cache key with parameters
 *
 * @param userId - User ID
 * @param appName - App name
 * @param toolSlug - Tool/handler slug
 * @param params - Parameters to include in key
 * @returns Full cache key
 *
 * Example:
 * generateCacheKey('user_1', 'hris', 'get_time', { city: 'jakarta' })
 *   → 'user_1:hris:get_time:abc123ef'
 */
export function generateCacheKey(
  userId: string,
  appName: string,
  toolSlug: string,
  params?: Record<string, unknown>
): string {
  const paramHash = params ? hashParams(params) : 'no-params';
  return `${userId}:${appName}:${toolSlug}:${paramHash}`;
}

/**
 * Generate cache key without parameters (legacy support)
 *
 * @deprecated Use generateCacheKey with params instead
 * @param userId - User ID
 * @param appName - App name
 * @returns Basic cache key
 */
export function generateBasicCacheKey(userId: string, appName: string): string {
  return `${userId}:${appName}`;
}

// ============================================================
// Entity Detection Helpers
// ============================================================

/**
 * Known Indonesian cities for entity detection
 */
export const KNOWN_CITIES = [
  'jakarta', 'bandung', 'surabaya', 'medan', 'semarang', 'makassar',
  'palembang', 'denpasar', 'yogyakarta', 'lombok', 'batam', 'malang',
  'padang', 'manado', 'pontianak', 'balikpapan', 'samarinda', 'jambi',
  'pekanbaru', 'mataram', 'kupang', 'ambon', 'jayapura', 'gorontalo',
  'kendari', 'ternate', 'palu', 'tasikmalaya', 'cirebon', 'banjarmasin',
  'singkawang', 'bali', 'solo', 'bogor', 'bekasi', 'depok', 'tangerang',
  'cimahi', 'sukabumi', 'tasik', 'purwokerto', 'magelang', 'pekalongan',
  'tegal', 'salatiga', 'blitar', 'probolinggo', 'pasuruan', 'madiun',
  'kediri', 'mojokerto', 'surakarta'
];

/**
 * Check if value is a known city
 *
 * @param value - Value to check
 * @returns True if known city
 */
export function isKnownCity(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return KNOWN_CITIES.includes(normalized);
}

/**
 * Known date/time references for entity detection
 */
export const KNOWN_DATE_REFS = [
  'hari ini', 'besok', 'lusa', 'kemarin', 'kemarin lusa',
  'minggu ini', 'minggu depan', 'minggu lalu',
  'bulan ini', 'bulan depan', 'bulan lalu',
  'tahun ini', 'tahun depan', 'tahun lalu',
  'today', 'tomorrow', 'yesterday', 'next week', 'last week',
  'next month', 'last month'
];

/**
 * Check if value is a known date reference
 *
 * @param value - Value to check
 * @returns True if known date reference
 */
export function isKnownDateRef(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return KNOWN_DATE_REFS.some(ref => ref.includes(normalized) || normalized.includes(ref));
}

/**
 * Known timezone references for entity detection
 */
export const KNOWN_TIMEZONES = [
  'wib', 'wita', 'wit',
  'utc', 'gmt',
  'asia/jakarta', 'asia/makassar', 'asia/jayapura'
];

/**
 * Check if value is a known timezone
 *
 * @param value - Value to check
 * @returns True if known timezone
 */
export function isKnownTimezone(value: string): boolean {
  const normalized = value.toLowerCase().trim();
  return KNOWN_TIMEZONES.includes(normalized);
}
