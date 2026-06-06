// ============================================================
// Query Snapshot Manager - Stores previous queries for context
// ============================================================
// Maintains history of user queries with embeddings for semantic comparison
// ============================================================

import { workingMemoryService } from '../../../workingMemory.service';
import { appLogger } from '../../../../utils/logger.util';
import { WorkingMemoryData } from '../../../../types/working-memory.type';

// ============================================================
// Types
// ============================================================

export interface QuerySnapshot {
  // Query info
  originalQuery: string;
  rewrittenQuery?: string;
  timestamp: number;

  // Intent info
  intentSlug: string;
  intentEmbedding?: number[];  // Store for semantic similarity
  confidence: number;

  // Entities extracted
  entities: Record<string, unknown>;

  // Execution info
  executionType: 'tool' | 'skill' | 'knowledge' | 'chat';
  toolSlug?: string;
  skillKey?: string;

  // Result summary
  resultSummary?: string;  // First 200 chars of result
  hasResult: boolean;
}

export interface SnapshotAnalysisResult {
  previousSnapshot: QuerySnapshot | null;
  snapshots: QuerySnapshot[];
  hasPreviousContext: boolean;
}

// ============================================================
// Query Snapshot Manager
// ============================================================

/**
 * QuerySnapshotManager - Manages query history for continuation detection
 *
 * Features:
 * - Stores last N queries per user/app
 * - Includes intent embeddings for semantic similarity
 * - Persists to working memory metadata
 * - In-memory cache for fast access
 */
export class QuerySnapshotManager {
  private readonly MAX_SNAPSHOTS = 5;
  private readonly CACHE_PREFIX = 'query_snapshot:';
  
  // In-memory cache: key = userId:appName, value = snapshots array
  private cache = new Map<string, QuerySnapshot[]>();

  /**
   * Store a query snapshot
   */
  async store(
    userId: string,
    appName: string,
    snapshot: QuerySnapshot
  ): Promise<void> {
    try {
      const key = this.getKey(userId, appName);

      // Get existing snapshots from cache
      let existing = this.cache.get(key) || [];

      // Add timestamp
      snapshot.timestamp = Date.now();

      // Add new snapshot at the end
      existing.push(snapshot);

      // Keep only last N snapshots
      if (existing.length > this.MAX_SNAPSHOTS) {
        existing = existing.slice(-this.MAX_SNAPSHOTS);
      }

      // Update cache
      this.cache.set(key, existing);

      // Persist to working memory metadata
      await this.persistToWorkingMemory(userId, appName, existing);

      appLogger.debug('[QuerySnapshot] Stored', {
        userId,
        appName,
        queryCount: existing.length,
        latestIntent: snapshot.intentSlug
      });
    } catch (error) {
      appLogger.error('[QuerySnapshot] Store failed', {
        userId,
        appName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Don't throw - snapshot storage failure should not break the pipeline
    }
  }

  /**
   * Get previous snapshots
   */
  getPrevious(
    userId: string,
    appName: string,
    count: number = 1
  ): QuerySnapshot[] {
    const key = this.getKey(userId, appName);
    const snapshots = this.cache.get(key) || [];

    // Return last N snapshots
    return snapshots.slice(-count);
  }

  /**
   * Get the most recent snapshot
   */
  getLatest(userId: string, appName: string): QuerySnapshot | null {
    const snapshots = this.getPrevious(userId, appName, 1);
    return snapshots.length > 0 ? snapshots[0] : null;
  }

  /**
   * Analyze snapshots for continuation context
   */
  async analyze(
    userId: string,
    appName: string
  ): Promise<SnapshotAnalysisResult> {
    const snapshots = this.getPrevious(userId, appName, this.MAX_SNAPSHOTS);
    const previousSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;

    return {
      previousSnapshot,
      snapshots,
      hasPreviousContext: snapshots.length > 0
    };
  }

  /**
   * Clear snapshots for a user/app
   */
  async clear(userId: string, appName: string): Promise<void> {
    const key = this.getKey(userId, appName);
    this.cache.delete(key);

    // Also clear from working memory
    try {
      const memory = await workingMemoryService.get(userId, appName);
      if (memory?.metadata?.querySnapshots) {
        await workingMemoryService.update(userId, appName, {
          metadata: {
            ...memory.metadata,
            querySnapshots: undefined
          }
        });
      }
    } catch (error) {
      appLogger.warn('[QuerySnapshot] Clear from WM failed', {
        userId,
        appName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    appLogger.debug('[QuerySnapshot] Cleared', { userId, appName });
  }

  /**
   * Load snapshots from working memory on initialization
   */
  async loadFromWorkingMemory(
    userId: string,
    appName: string,
    workingMemory: WorkingMemoryData | null
  ): Promise<void> {
    try {
      const key = this.getKey(userId, appName);

      // Check if we have cached snapshots
      if (this.cache.has(key)) {
        return;  // Already loaded
      }

      // Load from working memory metadata
      const snapshots = workingMemory?.metadata?.querySnapshots as QuerySnapshot[] | undefined;

      if (snapshots && snapshots.length > 0) {
        this.cache.set(key, snapshots);

        appLogger.debug('[QuerySnapshot] Loaded from working memory', {
          userId,
          appName,
          snapshotCount: snapshots.length
        });
      }
    } catch (error) {
      appLogger.warn('[QuerySnapshot] Load from WM failed', {
        userId,
        appName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get semantic similarity with previous query
   */
  async getSemanticSimilarity(
    userId: string,
    appName: string,
    currentEmbedding: number[]
  ): Promise<number> {
    const previousSnapshot = this.getLatest(userId, appName);

    if (!previousSnapshot?.intentEmbedding) {
      return 0;  // No previous embedding to compare
    }

    // Compute cosine similarity
    return this.cosineSimilarity(currentEmbedding, previousSnapshot.intentEmbedding);
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Persist snapshots to working memory metadata
   */
  private async persistToWorkingMemory(
    userId: string,
    appName: string,
    snapshots: QuerySnapshot[]
  ): Promise<void> {
    try {
      const memory = await workingMemoryService.get(userId, appName);

      await workingMemoryService.update(userId, appName, {
        metadata: {
          ...memory?.metadata,
          querySnapshots: snapshots,
          lastQueryAt: Date.now()
        }
      });
    } catch (error) {
      appLogger.warn('[QuerySnapshot] Persist to WM failed', {
        userId,
        appName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      // Continue silently - in-memory cache is still valid
    }
  }

  /**
   * Generate cache key
   */
  private getKey(userId: string, appName: string): string {
    return `${this.CACHE_PREFIX}${userId}:${appName}`;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalUsers: number;
    totalSnapshots: number;
    avgSnapshotsPerUser: number;
  } {
    const snapshots = Array.from(this.cache.values()).flat();
    return {
      totalUsers: this.cache.size,
      totalSnapshots: snapshots.length,
      avgSnapshotsPerUser: this.cache.size > 0 ? snapshots.length / this.cache.size : 0
    };
  }

  /**
   * Clear all cached snapshots (for testing/maintenance)
   */
  clearAll(): void {
    this.cache.clear();
    appLogger.info('[QuerySnapshot] All caches cleared');
  }
}

// Singleton instance
export const querySnapshotManager = new QuerySnapshotManager();
