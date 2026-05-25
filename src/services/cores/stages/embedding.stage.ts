import { ollamaService } from '../../ollama.service';
import { embeddingCache } from '../../embedding-cache.service';
import { circuitBreaker } from '../../../utils/circuit-breaker.util';
import { appLogger } from '../../../utils/logger.util';
import { config } from '../../../config';

// ============================================================
// Types
// ============================================================

export interface EmbeddingOptions {
  agentId?: string;
  useCache?: boolean;
  timeout?: number;
}

// ============================================================
// EmbeddingStage
// ============================================================

/**
 * EmbeddingStage - Generates text embeddings with caching
 * 
 * Responsibilities:
 * - Check embedding cache
 * - Generate embedding (Ollama)
 * - Cache result
 */
export class EmbeddingStage {
  /**
   * Execute embedding generation
   * 
   * @param text - The text to embed
   * @param options - Optional configuration
   * @returns Embedding vector as number array
   */
  async execute(
    text: string,
    options?: EmbeddingOptions
  ): Promise<number[]> {
    const agentId = options?.agentId;
    const useCache = options?.useCache ?? config.cache.enableEmbeddingCache;

    try {
      const normalizedText = text.toLowerCase().trim();

      // Quick path: cache disabled
      if (!useCache) {
        return await ollamaService.embed(normalizedText);
      }

      // Use cache with circuit breaker protection
      return await embeddingCache.getOrCompute(
        normalizedText,
        () => circuitBreaker.call(() => ollamaService.embed(normalizedText)),
        agentId,
        config.cache.embeddingTTL
      );

    } catch (error) {
      appLogger.error('EmbeddingStage: Embedding generation failed', {
        error: error instanceof Error ? error.message : error,
        textLength: text.length,
        agentId
      });
      throw error;
    }
  }
}
