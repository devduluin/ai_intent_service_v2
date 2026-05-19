import { ChromaClient, Collection, IncludeEnum } from 'chromadb';
import { config } from '../config';
import { ollamaService } from './ollamaRaw.service';
import { openAiService } from './openAi.service';
import { globalCache } from '../utils/cache-helper.util';
import { vectorLogger, embeddingLogger } from '../utils/logger.util';
import type { Agent } from '../types/agent.types';
import type { Intent, IntentMatch } from '../types';

// ============================================================
// Vector DB Service — Multi Agent Intent Search (Production Ready)
// ============================================================

// Constants
const DEFAULT_TIMEOUT = 10000; // 10 seconds
const INDEXING_TIMEOUT = 30000; // 30 seconds for indexing operations
const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 1000; // 1 second
const MAX_CONCURRENT_INDEXING = 5; // Limit concurrent indexing operations
const CACHE_TTL_EMBEDDING = config.cache?.embeddingTTL 
  ? config.cache.embeddingTTL * 1000 
  : 3600 * 1000; // Default 1 hour in ms

// ============================================================
// Retry Configuration
// ============================================================

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  shouldRetry: (error: Error) => boolean;
}

const defaultRetryConfig: RetryConfig = {
  maxRetries: MAX_RETRIES,
  baseDelay: BASE_RETRY_DELAY,
  maxDelay: 10000, // 10 seconds max delay
  shouldRetry: (error: Error) => {
    // Retry on network errors, timeouts, and 5xx errors
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
  },
};

// ============================================================
// Metrics Interface
// ============================================================

interface VectorServiceMetrics {
  totalQueries: number;
  totalIndexing: number;
  successfulQueries: number;
  failedQueries: number;
  successfulIndexing: number;
  failedIndexing: number;
  cacheHits: number;
  cacheMisses: number;
  averageQueryTime: number;
  averageIndexingTime: number;
  lastHealthCheck: number | null;
  isHealthy: boolean;
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Sleep for specified milliseconds
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Execute with retry logic and exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retryConfig: RetryConfig = defaultRetryConfig,
  operationName: string
): Promise<T> {
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt <= retryConfig.maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;

      if (attempt > retryConfig.maxRetries) {
        break;
      }

      if (!retryConfig.shouldRetry(lastError)) {
        throw lastError;
      }

      // Exponential backoff with jitter
      const delay = Math.min(
        retryConfig.baseDelay * Math.pow(2, attempt - 1) + Math.random() * 100,
        retryConfig.maxDelay
      );

      vectorLogger.warn(
        `Retry attempt ${attempt}/${retryConfig.maxRetries} for ${operationName} after ${delay.toFixed(0)}ms`,
        { error: lastError.message, attempt, maxRetries: retryConfig.maxRetries }
      );

      await sleep(delay);
    }
  }

  throw new Error(
    `${operationName} failed after ${attempt} attempts. Last error: ${lastError?.message}`
  );
}

/**
 * Execute promise with timeout
 */
async function withTimeout<T>(
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

/**
 * Split array into chunks for parallel processing
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Generate stable unique ID for example
 */
function generateExampleId(
  agentId: string,
  intentId: string,
  exampleText: string,
  index: number
): string {
  // Use hash of example text for stability
  const hash = simpleHash(exampleText);
  return `intent_${agentId}_${intentId}_ex_${hash}_${index}`;
}

/**
 * Simple hash function for strings
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Validate intent object before indexing
 */
function validateIntent(intent: Intent): void {
  if (!intent.id) {
    throw new Error('Intent ID is required');
  }
  if (!intent.agentId) {
    throw new Error(`Intent ${intent.id} missing agentId`);
  }
  if (!intent.slug) {
    throw new Error(`Intent ${intent.id} missing slug`);
  }
  if (!intent.name) {
    throw new Error(`Intent ${intent.id} missing name`);
  }
}

/**
 * Validate embedding vector
 */
function validateEmbedding(embedding: number[]): void {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Invalid embedding: must be non-empty array');
  }
  if (embedding.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new Error('Invalid embedding: contains non-finite numbers');
  }
}

// ============================================================
// Vector Service Class
// ============================================================

class VectorService {
  private client: ChromaClient | null = null;
  private collection: Collection | null = null;
  private isInitialized = false;
  private isInitializing = false;
  private metrics: VectorServiceMetrics = {
    totalQueries: 0,
    totalIndexing: 0,
    successfulQueries: 0,
    failedQueries: 0,
    successfulIndexing: 0,
    failedIndexing: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageQueryTime: 0,
    averageIndexingTime: 0,
    lastHealthCheck: null,
    isHealthy: false,
  };

  constructor() {
    // Client initialized on demand
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Initialize connection to ChromaDB
   */
  async init(): Promise<void> {
    if (this.isInitialized && this.collection) {
      vectorLogger.debug('Vector service already initialized');
      return;
    }

    if (this.isInitializing) {
      vectorLogger.debug('Vector service initialization in progress, waiting...');
      // Wait for initialization to complete
      let waitCount = 0;
      while (this.isInitializing && waitCount < 50) {
        await sleep(100);
        waitCount++;
      }
      if (this.isInitialized && this.collection) {
        return;
      }
    }

    this.isInitializing = true;

    try {
      vectorLogger.info('Initializing ChromaDB connection', {
        url: config.vectorDb.url,
        collection: config.vectorDb.collection,
      });

      this.client = new ChromaClient({ 
        path: config.vectorDb.url,
      });

      // Test connection
      await withTimeout(
        this.client.heartbeat(),
        DEFAULT_TIMEOUT,
        'ChromaDB heartbeat'
      );

      // Get or create collection
      this.collection = await withRetry(
        () =>
          this.client!.getOrCreateCollection({
            name: config.vectorDb.collection,
            metadata: {
              'hnsw:space': 'cosine',
            },
          }),
        defaultRetryConfig,
        'getOrCreateCollection'
      );

      this.isInitialized = true;
      this.metrics.isHealthy = true;
      this.metrics.lastHealthCheck = Date.now();

      vectorLogger.info('ChromaDB initialized successfully', {
        collection: config.vectorDb.collection,
      });
    } catch (error) {
      this.metrics.isHealthy = false;
      vectorLogger.error('Failed to initialize ChromaDB', { error });
      throw new Error(
        `VectorDB initialization failed: ${error instanceof Error ? error.message : error}`
      );
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Ensure collection is ready
   */
  private ensureCollection(): Collection {
    if (!this.collection) {
      throw new Error(
        'VectorDB not initialized. Call init() first or check service health.'
      );
    }
    return this.collection;
  }

  // ============================================================
  // TEXT NORMALIZATION
  // ============================================================

  /**
   * Normalize text for consistent embedding
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.,!?-]/g, ''); // Remove special characters
  }

  // ============================================================
  // EMBEDDING WITH CACHE
  // ============================================================

  /**
   * Generate embedding with caching
   */
  private async getEmbedding(text: string): Promise<number[]> {
    const cacheKey = `embedding:${simpleHash(text)}:${text.substring(0, 50)}`;

    // Try cache first
    if (config.cache?.enableEmbeddingCache) {
      const cached = await globalCache.get<number[]>(cacheKey);
      if (cached) {
        this.metrics.cacheHits++;
        embeddingLogger.debug('Embedding cache hit', { cacheKey });
        return cached;
      }
      this.metrics.cacheMisses++;
    }

    // Generate new embedding
    embeddingLogger.debug('Generating new embedding', { textLength: text.length });
    
    const embedding = await withRetry(
      () => ollamaService.embed(text),
      defaultRetryConfig,
      'ollamaService.embed'
    );

    validateEmbedding(embedding);

    // Cache the embedding
    if (config.cache?.enableEmbeddingCache) {
      await globalCache.set(cacheKey, embedding, { ttl: CACHE_TTL_EMBEDDING });
      embeddingLogger.debug('Embedding cached', { cacheKey, ttl: CACHE_TTL_EMBEDDING });
    }

    return embedding;
  }

  /**
   * Generate embeddings for batch with caching
   */
  private async getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    vectorLogger.debug('Processing batch embedding', { count: texts.length });
    
    // Process with concurrency limit
    const chunks = chunk(texts, MAX_CONCURRENT_INDEXING);
    const allEmbeddings: number[][] = [];

    for (const chunk of chunks) {
      const chunkEmbeddings = await Promise.all(
        chunk.map((text) => this.getEmbedding(text))
      );
      allEmbeddings.push(...chunkEmbeddings);
    }

    return allEmbeddings;
  }

  // ============================================================
  // INDEXING OPERATIONS
  // ============================================================

  /**
   * Index a single intent with validation and error handling
   */
  async indexIntent(intent: Intent): Promise<{ success: boolean; indexedCount: number; error?: string }> {
    const startTime = Date.now();
    this.metrics.totalIndexing++;

    try {
      // Validate intent
      validateIntent(intent);

      const col = this.ensureCollection();

      if (!intent.examples?.length) {
        vectorLogger.debug('Intent has no examples, skipping indexing', {
          intentId: intent.id,
          intentSlug: intent.slug,
        });
        return { success: true, indexedCount: 0 };
      }

      // Normalize examples
      const normalizedExamples = intent.examples.map((ex) => this.normalize(ex));

      // Generate embeddings with caching
      const embeddings = await withTimeout(
        this.getEmbeddingsBatch(normalizedExamples),
        INDEXING_TIMEOUT,
        `embedding generation for intent ${intent.id}`
      );

      // Generate stable IDs
      const ids = normalizedExamples.map((_, i) =>
        generateExampleId(intent.agentId!, intent.id, normalizedExamples[i], i)
      );

      // Prepare metadata
      const intentDescription = this.normalize(intent.description);
      const metadatas = normalizedExamples.map(() => ({
        agentId: intent.agentId,
        intentId: intent.id,
        intentSlug: intent.slug,
        intentName: intent.name,
        intentDescription,
        indexedAt: new Date().toISOString(),
      }));

      // Add to collection with retry
      await withRetry(
        () =>
          col.add({
            ids,
            embeddings,
            metadatas,
            documents: normalizedExamples,
          }),
        defaultRetryConfig,
        `add intent ${intent.id} to collection`
      );

      const duration = Date.now() - startTime;
      this.metrics.successfulIndexing++;
      this.updateAverageIndexingTime(duration);

      vectorLogger.info('Intent indexed successfully', {
        intentId: intent.id,
        intentSlug: intent.slug,
        exampleCount: normalizedExamples.length,
        durationMs: duration,
      });

      return {
        success: true,
        indexedCount: normalizedExamples.length,
      };
    } catch (error) {
      this.metrics.failedIndexing++;
      const duration = Date.now() - startTime;

      vectorLogger.error('Failed to index intent', {
        intentId: intent.id,
        intentSlug: intent.slug,
        error: error instanceof Error ? error.message : error,
        durationMs: duration,
      });

      return {
        success: false,
        indexedCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Index all intents with parallel processing and concurrency control
   */
  async indexAllIntents(
    intents: Intent[],
    options?: { concurrency?: number; skipFailed?: boolean }
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
    errors: Array<{ intentId: string; error: string }>;
    totalDurationMs: number;
  }> {
    const startTime = Date.now();
    const concurrency = options?.concurrency ?? MAX_CONCURRENT_INDEXING;
    const skipFailed = options?.skipFailed ?? false;

    vectorLogger.info('Starting batch indexing', {
      totalIntents: intents.length,
      concurrency,
    });

    const chunks = chunk(intents, concurrency);
    const errors: Array<{ intentId: string; error: string }> = [];
    let successfulCount = 0;

    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map((intent) => this.indexIntent(intent))
      );

      for (const result of results) {
        if (result.success) {
          successfulCount++;
        } else {
          errors.push({ intentId: result.error || 'Unknown error', error: result.error || 'Unknown' });
          if (!skipFailed) {
            // Continue on error by default
          }
        }
      }
    }

    const totalDuration = Date.now() - startTime;

    vectorLogger.info('Batch indexing completed', {
      total: intents.length,
      successful: successfulCount,
      failed: intents.length - successfulCount,
      totalDurationMs: totalDuration,
    });

    return {
      total: intents.length,
      successful: successfulCount,
      failed: intents.length - successfulCount,
      errors,
      totalDurationMs: totalDuration,
    };
  }

  // ============================================================
  // QUERY OPERATIONS
  // ============================================================

  /**
   * Find matching intents with agent isolation
   */
  async findIntent(
    queryEmbedding: number[],
    intents: Intent[],
    agent: Agent,
    topK = config.intent.topK
  ): Promise<IntentMatch[]> {
    const startTime = Date.now();
    this.metrics.totalQueries++;

    validateEmbedding(queryEmbedding);

    try {
      const col = this.ensureCollection();
      const agentId = agent?.id;

      if (!agentId) {
        vectorLogger.warn('findIntent called without agent ID');
        return [];
      }

      // vectorLogger.debug('Querying vector DB', {
      //   agentId,
      //   topK,
      //   queryEmbeddingLength: queryEmbedding.length,
      // });

      // Query with retry and timeout
      const results = await withTimeout(
        withRetry(
          () =>
            col.query({
              queryEmbeddings: [queryEmbedding],
              nResults: topK * 2, // Get more results to filter by threshold
              include: [IncludeEnum.Metadatas, IncludeEnum.Distances],
              where: {
                agentId: agentId,
              },
            }),
          defaultRetryConfig,
          'vector query'
        ),
        DEFAULT_TIMEOUT,
        'findIntent query'
      );

      if (!results.metadatas?.[0] || !results.metadatas[0].length) {
        vectorLogger.debug('No matches found in vector DB');
        this.metrics.successfulQueries++;
        return [];
      }

      // Process results
      const matches: IntentMatch[] = [];
      const seen = new Set<string>();
      const similarityThreshold = config.intent.similarityThreshold;

      for (let i = 0; i < results.metadatas[0].length; i++) {
        const meta = results.metadatas[0][i] as {
          intentId: string;
          agentId: string;
          intentSlug?: string;
          intentName?: string;
        };

        const distance = results.distances?.[0]?.[i] ?? 1;
        const score = 1 - distance;

        // Filter by threshold
        if (score < similarityThreshold) {
          // vectorLogger.debug('Match below threshold', {
          //   intentId: meta.intentId,
          //   intentSlug: meta.intentSlug,
          //   score,
          //   threshold: similarityThreshold,
          // });
          continue;
        }

        // Deduplicate
        if (seen.has(meta.intentId)) {
          continue;
        }
        seen.add(meta.intentId);

        // Find matching intent
        const intent = intents.find((i) => i.id === meta.intentId);
        if (!intent) {
          vectorLogger.warn('Found intent ID not in provided intents', {
            intentId: meta.intentId,
          });
          continue;
        }

        matches.push({
          intent,
          score,
        });
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);

      const duration = Date.now() - startTime;
      this.metrics.successfulQueries++;
      this.updateAverageQueryTime(duration);

      vectorLogger.info('Intent matching completed', {
        agentId,
        matchCount: matches.length,
        topScore: matches[0]?.score ?? 0,
        durationMs: duration,
      });

      // Log metrics
      if (matches.length > 0) {
        vectorLogger.metric('intent_match_score', matches[0].score, '', {
          agentId,
          intentId: matches[0].intent.id,
        });
      }

      return matches;
    } catch (error) {
      this.metrics.failedQueries++;
      const duration = Date.now() - startTime;

      vectorLogger.error('Intent matching failed', {
        agentId: agent?.id,
        error: error instanceof Error ? error.message : error,
        durationMs: duration,
      });

      throw error;
    }
  }

  // ============================================================
  // MAINTENANCE OPERATIONS
  // ============================================================

  /**
   * Reset collection (delete all data and recreate)
   */
  async resetCollection(): Promise<void> {
    vectorLogger.warn('Resetting vector collection - all data will be deleted');

    try {
      await withTimeout(
        withRetry(
          () => this.client!.deleteCollection({ name: config.vectorDb.collection }),
          defaultRetryConfig,
          'deleteCollection'
        ),
        DEFAULT_TIMEOUT,
        'resetCollection'
      );

      this.collection = null;
      this.isInitialized = false;

      await this.init();

      vectorLogger.info('Vector collection reset successfully');
    } catch (error) {
      vectorLogger.error('Failed to reset vector collection', { error });
      throw error;
    }
  }

  /**
   * Delete specific intent from collection
   */
  async deleteIntent(intentId: string, agentId: string): Promise<void> {
    const col = this.ensureCollection();

    try {
      // Get all documents for this intent
      const results = await col.get({
        where: {
          intentId,
          agentId,
        },
        include: [IncludeEnum.Distances],
      });

      if (results.ids && results.ids.length > 0) {
        await col.delete({
          ids: results.ids,
        });

        vectorLogger.info('Intent deleted from vector DB', {
          intentId,
          agentId,
          deletedCount: results.ids.length,
        });
      } else {
        vectorLogger.debug('No documents found for intent deletion', {
          intentId,
          agentId,
        });
      }
    } catch (error) {
      vectorLogger.error('Failed to delete intent from vector DB', {
        intentId,
        agentId,
        error,
      });
      throw error;
    }
  }

  // ============================================================
  // HEALTH CHECK & MONITORING
  // ============================================================

  /**
   * Comprehensive health check
   */
  async isHealthy(): Promise<boolean> {
    const startTime = Date.now();

    try {
      if (!this.client) {
        this.client = new ChromaClient({ path: config.vectorDb.url });
      }

      // Heartbeat with timeout
      await withTimeout(
        this.client.heartbeat(),
        5000, // 5 second timeout for health check
        'health check heartbeat'
      );

      // Verify collection exists
      if (!this.collection) {
        await this.init();
      }

      this.metrics.isHealthy = true;
      this.metrics.lastHealthCheck = Date.now();

      const duration = Date.now() - startTime;
      vectorLogger.debug('Health check passed', { durationMs: duration });

      return true;
    } catch (error) {
      this.metrics.isHealthy = false;
      vectorLogger.error('Health check failed', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Get service metrics
   */
  getMetrics(): VectorServiceMetrics {
    return { ...this.metrics };
  }

  /**
   * Get initialization status
   */
  isReady(): boolean {
    return this.isInitialized && !!this.collection && this.metrics.isHealthy;
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private updateAverageQueryTime(durationMs: number) {
    const totalQueries = this.metrics.successfulQueries + this.metrics.failedQueries;
    if (totalQueries === 0) {
      this.metrics.averageQueryTime = durationMs;
    } else {
      this.metrics.averageQueryTime =
        (this.metrics.averageQueryTime * (totalQueries - 1) + durationMs) /
        totalQueries;
    }
  }

  private updateAverageIndexingTime(durationMs: number) {
    const totalIndexing = this.metrics.successfulIndexing + this.metrics.failedIndexing;
    if (totalIndexing === 0) {
      this.metrics.averageIndexingTime = durationMs;
    } else {
      this.metrics.averageIndexingTime =
        (this.metrics.averageIndexingTime * (totalIndexing - 1) + durationMs) /
        totalIndexing;
    }
  }
}

// Singleton instance
export const vectorService = new VectorService();
