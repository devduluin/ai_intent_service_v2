// ============================================================
// Semantic Analyzer - Embedding-based similarity detection
// ============================================================
// Computes semantic similarity between current and previous queries
// ============================================================

import { EmbeddingStage } from '../../stages/embedding.stage';
import { querySnapshotManager } from '../memory/query-snapshot';
import { appLogger } from '../../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface SemanticAnalysisResult {
  similarityScore: number;      // 0-1 cosine similarity
  isSimilar: boolean;           // True if >= threshold
  previousQuery?: string;       // The matched previous query
  previousIntent?: string;      // The matched previous intent
}

export interface SemanticAnalyzerConfig {
  similarityThreshold: number;  // Default: 0.70
}

// ============================================================
// Semantic Analyzer
// ============================================================

/**
 * SemanticAnalyzer - Computes semantic similarity using embeddings
 *
 * Features:
 * - Generates embedding for current query
 * - Retrieves previous query embedding from snapshot
 * - Computes cosine similarity
 * - Returns similarity score and matched query info
 */
export class SemanticAnalyzer {
  private readonly DEFAULT_CONFIG: SemanticAnalyzerConfig = {
    similarityThreshold: 0.70,
  };

  private config = { ...this.DEFAULT_CONFIG };
  private embeddingStage: EmbeddingStage;

  constructor() {
    this.embeddingStage = new EmbeddingStage();
  }

  /**
   * Analyze semantic similarity with previous queries
   */
  async analyze(
    userId: string,
    appName: string,
    currentQuery: string
  ): Promise<SemanticAnalysisResult> {
    try {
      // Get previous snapshot
      const previousSnapshot = querySnapshotManager.getLatest(userId, appName);

      if (!previousSnapshot?.intentEmbedding) {
        return {
          similarityScore: 0,
          isSimilar: false
        };
      }

      // Generate embedding for current query
      const currentEmbedding = await this.generateEmbedding(currentQuery);

      if (!currentEmbedding || currentEmbedding.length === 0) {
        appLogger.warn('[SemanticAnalyzer] Failed to generate embedding', {
          userId,
          appName,
          queryLength: currentQuery.length
        });
        return {
          similarityScore: 0,
          isSimilar: false
        };
      }

      // Compute cosine similarity
      const similarityScore = this.cosineSimilarity(
        currentEmbedding,
        previousSnapshot.intentEmbedding
      );

      // Check if similar
      const isSimilar = similarityScore >= this.config.similarityThreshold;

      appLogger.debug('[SemanticAnalyzer] Similarity computed', {
        userId,
        appName,
        similarityScore,
        isSimilar,
        previousIntent: previousSnapshot.intentSlug
      });

      return {
        similarityScore: Math.round(similarityScore * 100) / 100,
        isSimilar,
        previousQuery: previousSnapshot.originalQuery,
        previousIntent: previousSnapshot.intentSlug
      };
    } catch (error) {
      appLogger.error('[SemanticAnalyzer] Analysis failed', {
        userId,
        appName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        similarityScore: 0,
        isSimilar: false
      };
    }
  }

  /**
   * Generate embedding for text
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const result = await this.embeddingStage.execute(text, {
        agentId: undefined,  // Not needed for continuation
        useCache: true
      });

      return result;
    } catch (error) {
      appLogger.error('[SemanticAnalyzer] Embedding generation failed', {
        textLength: text.length,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
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
   * Compute similarity between two arbitrary texts
   */
  async computeSimilarity(text1: string, text2: string): Promise<number> {
    try {
      const [embedding1, embedding2] = await Promise.all([
        this.generateEmbedding(text1),
        this.generateEmbedding(text2)
      ]);

      if (embedding1.length === 0 || embedding2.length === 0) {
        return 0;
      }

      return this.cosineSimilarity(embedding1, embedding2);
    } catch (error) {
      appLogger.error('[SemanticAnalyzer] Similarity computation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Update similarity threshold
   */
  updateThreshold(threshold: number): void {
    this.config.similarityThreshold = threshold;
    appLogger.info('[SemanticAnalyzer] Threshold updated', {
      similarityThreshold: threshold
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): SemanticAnalyzerConfig {
    return { ...this.config };
  }
}

// Singleton instance
export const semanticAnalyzer = new SemanticAnalyzer();
