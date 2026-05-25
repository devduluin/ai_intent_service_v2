import { workingMemoryService, type WorkingMemoryData } from '../../workingMemory.service';
import { toolResultCache } from '../../memories/toolResultCache.service';
import { intentRegistry } from '../../intent-registry.service';
import { queryDecompositionService } from '../../query-decomposition.service';
import { openAiService } from '../../openAi.service';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface ContinuationIntent {
  isContinuation: boolean;
  confidence: number;
  type?: 'export' | 'refine' | 'detail' | 'action' | 'clarify' | 'workflow' | 'new';
  targetHandler?: string;
  targetHandlers?: string[];
  extractedParams?: Record<string, unknown>;
  cachedData?: {
    result: unknown;
    entities: Record<string, unknown>;
    toolSlug: string;
    timestamp: number;
  };
  reasoning?: string;
}

export interface ContinuationContext {
  workingMemory: WorkingMemoryData | null;
  hasPreviousResult: boolean;
  availableContinuationTools: string[];
}

export interface ContinuationResult {
  shouldSkipPipeline: boolean;
  intent: ContinuationIntent;
  context: ContinuationContext;
  directResult?: unknown;
}

// ============================================================
// Patterns
// ============================================================

const CONTINUATION_PATTERNS = {
  export: [
    /export/i, /download/i, /unduh/i, /save.*excel/i, /save.*pdf/i,
    /simpan.*excel/i, /buat.*file/i, /download.*xlsx/i, /export.*csv/i,
    /export.*excel/i, /jadi.*excel/i, /simpan.*xlsx/i, /buat.*excel/i,
    /xls/i, /xlsx/i, /excel/i,
  ],
  refine: [
    /ubah/i, /ganti/i, /modify/i, /update/i, /revisi/i, /edit/i,
    /ganti.*yang.*baru/i,
    /kalau/i,  // C-009 FIX: "kalau bandung?" pattern
  ],
  detail: [
    /detail/i, /lebih.*lanjut/i, /lebih.*jelas/i, /tampilkan.*semua/i,
    /show.*all/i, /apa.*saja/i,
  ],
  action: [
    /lanjut/i, /proses/i, /submit/i, /konfirmasi/i, /setuju/i,
    /approve/i, /send/i, /kirim/i,
  ],
  clarify: [
    /kenapa/i, /mengapa/i, /bagaimana/i, /apa.*arti/i, /maksudnya/i, /explain/i,
  ],
};

// C-009 FIX: Common Indonesian city names for single-word follow-up detection
const COMMON_CITIES_PATTERN = /\b(bali|jakarta|bandung|surabaya|medan|semarang|makassar|palembang|denpasar|yogyakarta|lombok|batam|malang|padang|manado|pontianak|balikpapan|samarinda|jambi|pekanbaru|mataram|kupang|ambon|jayapura|gorontalo|kendari|ternate|palu|tasikmalaya|cirebon|banjarmasin|singkawang)\b/i;

// ============================================================
// Continuation Resolver
// ============================================================

export class ContinuationResolver {
  private readonly CONTINUATION_CONFIDENCE_THRESHOLD = 0.6;
  private readonly EXPORT_TOOLS_PATTERN = ['export', 'download', 'xls', 'pdf', 'csv', 'generate'];
  private readonly USE_LLM_THRESHOLD = 0.7;

  /**
   * Resolve whether input is a continuation of previous context
   */
  async resolve(
    userId: string,
    appName: string,
    userInput: string,
    workingMemory?: WorkingMemoryData | null,
    options?: { useLLM?: boolean }
  ): Promise<ContinuationResult> {
    const start = Date.now();

    try {
      // 1. Get working memory (use provided or fetch)
      const memory = workingMemory ?? await workingMemoryService.get(userId, appName);

      // 2. Check if there's previous context
      const hasPreviousContext = !!(
        memory?.activeIntent ||
        memory?.activeWorkflow ||
        memory?.activeTool
      );

      if (!hasPreviousContext) {
        appLogger.debug('[ContinuationResolver] No previous context, skip continuation check', {
          userId,
          appName,
          hasActiveIntent: !!memory?.activeIntent,
          hasActiveWorkflow: !!memory?.activeWorkflow,
          hasActiveTool: !!memory?.activeTool
        });

        return {
          shouldSkipPipeline: false,
          intent: {
            isContinuation: false,
            confidence: 0,
            type: 'new'
          },
          context: {
            workingMemory: null,
            hasPreviousResult: false,
            availableContinuationTools: []
          }
        };
      }

      // 3. Fetch cache ONCE at the beginning (reuse in all branches)
      const sessionKey = `${userId}:${appName}`;
      const cachedData = await toolResultCache.get(sessionKey, undefined, { skipRedis: false });

      // 4. Check continuation hints from working memory
      const canExport = memory?.continuationHints?.canExport;
      const canSummarize = memory?.continuationHints?.canSummarize;
      const hasExportPattern = /export|download|unduh|excel|xls|xlsx|pdf|csv/i.test(userInput);
      const hasSummarizePattern = /analisa|analyze|summary|summarize|ringkas|hitung/i.test(userInput);

      // 5. Detect multi-handler workflow
      const workflowHandlers = this.detectWorkflowHandlers(userInput, memory);

      if (workflowHandlers.length > 1) {
        appLogger.info('[ContinuationResolver] Multi-handler workflow detected', {
          userId,
          appName,
          handlers: workflowHandlers,
          userInput
        });

        // Validate handlers
        const validatedHandlers = await this.validateHandlers(workflowHandlers);

        if (validatedHandlers.length >= 2) {
          return {
            shouldSkipPipeline: true,
            intent: {
              isContinuation: true,
              confidence: 0.95,
              type: 'workflow',
              targetHandler: validatedHandlers[0],
              targetHandlers: validatedHandlers,
              cachedData: cachedData ? {
                result: cachedData.result,
                entities: cachedData.entities,
                toolSlug: cachedData.toolSlug,
                timestamp: cachedData.timestamp
              } : undefined,
              reasoning: `Multi-handler workflow: ${validatedHandlers.join(' → ')}`
            },
            context: {
              workingMemory: memory,
              hasPreviousResult: !!cachedData,
              availableContinuationTools: validatedHandlers
            }
          };
        }
      }

      // 6. Fast-track single handler (LLM-free)
      if (canExport && hasExportPattern) {
        const targetHandler = userInput.toLowerCase().includes('pdf') ? 'pdf_generator' : 'xls_generator';
        const handlerExists = await this.handlerExists(targetHandler);

        if (handlerExists) {
          appLogger.info('[ContinuationResolver] Quick match: canExport=true + export pattern', {
            userId,
            appName,
            userInput,
            canExport
          });

          return {
            shouldSkipPipeline: true,
            intent: {
              isContinuation: true,
              confidence: 0.9,
              type: 'export',
              targetHandler,
              cachedData: cachedData ? {
                result: cachedData.result,
                entities: cachedData.entities,
                toolSlug: cachedData.toolSlug,
                timestamp: cachedData.timestamp
              } : undefined,
              reasoning: 'Export pattern matched with canExport hint from working memory'
            },
            context: {
              workingMemory: memory,
              hasPreviousResult: !!cachedData,
              availableContinuationTools: [targetHandler]
            }
          };
        }
      }

      if (canSummarize && hasSummarizePattern) {
        const targetHandler = 'data_analyzer';
        const handlerExists = await this.handlerExists(targetHandler);

        if (handlerExists) {
          appLogger.info('[ContinuationResolver] Quick match: canSummarize=true + summarize pattern', {
            userId,
            appName,
            userInput,
            canSummarize
          });

          return {
            shouldSkipPipeline: true,
            intent: {
              isContinuation: true,
              confidence: 0.9,
              type: 'detail',
              targetHandler,
              cachedData: cachedData ? {
                result: cachedData.result,
                entities: cachedData.entities,
                toolSlug: cachedData.toolSlug,
                timestamp: cachedData.timestamp
              } : undefined,
              reasoning: 'Summarize pattern matched with canSummarize hint'
            },
            context: {
              workingMemory: memory,
              hasPreviousResult: !!cachedData,
              availableContinuationTools: [targetHandler]
            }
          };
        }
      }

      // 7. Pattern-based detection (without LLM)
      const patternMatch = this.detectContinuationPatterns(userInput);

      if (patternMatch.confidence >= this.CONTINUATION_CONFIDENCE_THRESHOLD) {
        appLogger.debug('[ContinuationResolver] Pattern-based continuation detected', {
          userId,
          appName,
          confidence: patternMatch.confidence,
          type: patternMatch.type
        });

        return {
          shouldSkipPipeline: true,
          intent: {
            isContinuation: true,
            confidence: patternMatch.confidence,
            type: patternMatch.type,
            targetHandler: this.inferTargetHandler(patternMatch.type, memory),
            cachedData: cachedData ? {
              result: cachedData.result,
              entities: cachedData.entities,
              toolSlug: cachedData.toolSlug,
              timestamp: cachedData.timestamp
            } : undefined,
            reasoning: `Pattern-based detection: ${patternMatch.type}`
          },
          context: {
            workingMemory: memory,
            hasPreviousResult: !!cachedData,
            availableContinuationTools: this.inferAvailableTools(patternMatch.type, memory)
          }
        };
      }

      // 8. No continuation detected
      appLogger.debug('[ContinuationResolver] No continuation detected', {
        userId,
        appName,
        patternConfidence: patternMatch.confidence
      });

      return {
        shouldSkipPipeline: false,
        intent: {
          isContinuation: false,
          confidence: 0,
          type: 'new'
        },
        context: {
          workingMemory: memory,
          hasPreviousResult: !!cachedData,
          availableContinuationTools: []
        }
      };

    } catch (error) {
      appLogger.error('[ContinuationResolver] Resolution failed', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName,
        duration: Date.now() - start
      });

      return {
        shouldSkipPipeline: false,
        intent: {
          isContinuation: false,
          confidence: 0,
          type: 'new'
        },
        context: {
          workingMemory: null,
          hasPreviousResult: false,
          availableContinuationTools: []
        }
      };
    }
  }

  // ============================================================
  // Pattern Detection
  // ============================================================

  /**
   * Detect continuation type from user input patterns
   */
  private detectContinuationPatterns(userInput: string): {
    confidence: number;
    type: ContinuationIntent['type'];
  } {
    const lowerInput = userInput.toLowerCase();
    const normalized = userInput.trim();

    // C-009 FIX: Detect single-word city names as "refine" continuation
    // e.g., "bali", "jakarta", "bandung" after a weather/time query
    if (COMMON_CITIES_PATTERN.test(normalized)) {
      const wordCount = normalized.split(' ').filter(Boolean).length;
      if (wordCount === 1 && normalized.length >= 3 && normalized.length <= 20) {
        appLogger.debug('[ContinuationResolver] Single-word city detected as continuation', {
          userInput,
          normalized,
          wordCount,
          matchesCityPattern: COMMON_CITIES_PATTERN.test(normalized)
        });
        return {
          confidence: 0.75,  // High confidence for single-word city follow-ups
          type: 'refine'
        };
      }
    }

    for (const [type, patterns] of Object.entries(CONTINUATION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(lowerInput)) {
          return {
            confidence: 0.8,
            type: type as ContinuationIntent['type']
          };
        }
      }
    }

    return {
      confidence: 0,
      type: 'new'
    };
  }

  /**
   * Detect workflow handlers from input
   */
  private detectWorkflowHandlers(
    userInput: string,
    memory: WorkingMemoryData | null
  ): string[] {
    const handlers: string[] = [];

    // Check for export-related keywords
    if (/export|download|xlsx|excel|xls/i.test(userInput)) {
      handlers.push('xls_generator');
    }

    // Check for analyze-related keywords
    if (/analisa|analyze|summary|ringkas|hitung/i.test(userInput)) {
      handlers.push('data_analyzer');
    }

    // Check for connectors like "lalu", "kemudian", "dan"
    if (/lalu|kemudian|dan|setelah/i.test(userInput)) {
      // Multi-step workflow detected
      if (handlers.length === 0) {
        // Infer from working memory
        if (memory?.activeTool) {
          handlers.push(memory.activeTool);
        }
      }
    }

    return handlers;
  }

  /**
   * Validate handlers exist in registry
   */
  private async validateHandlers(handlers: string[]): Promise<string[]> {
    const validated: string[] = [];

    for (const handler of handlers) {
      const exists = await this.handlerExists(handler);
      if (exists) {
        validated.push(handler);
      } else {
        appLogger.warn('[ContinuationResolver] Handler not found in registry', {
          handler
        });
      }
    }

    return validated;
  }

  /**
   * Check if handler exists in intent registry
   */
  private async handlerExists(handlerKey: string): Promise<boolean> {
    const intents = intentRegistry.getAll();
    return intents.some(intent => intent.handlerKey === handlerKey);
  }

  /**
   * Infer target handler from continuation type
   */
  private inferTargetHandler(
    type: ContinuationIntent['type'],
    memory: WorkingMemoryData | null
  ): string | undefined {
    switch (type) {
      case 'export':
        return 'xls_generator';
      case 'refine':
        return memory?.activeTool || undefined;
      case 'detail':
        return 'data_analyzer';
      default:
        return memory?.activeTool || undefined;
    }
  }

  /**
   * Infer available tools from continuation type
   */
  private inferAvailableTools(
    type: ContinuationIntent['type'],
    memory: WorkingMemoryData | null
  ): string[] {
    const tools: string[] = [];

    if (type === 'export' || type === 'refine') {
      tools.push('xls_generator');
    }

    if (type === 'detail' || type === 'clarify') {
      tools.push('data_analyzer');
    }

    if (memory?.activeTool && !tools.includes(memory.activeTool)) {
      tools.push(memory.activeTool);
    }

    return tools;
  }
}
