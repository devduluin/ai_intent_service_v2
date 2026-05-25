// services/continuationResolver.service.ts
import { workingMemoryService, type WorkingMemoryData } from './workingMemory.service';
import { toolResultCache } from './memories/toolResultCache.service';
import { toolService } from './tools.service';
import { intentRegistry } from './intent-registry.service';
import { queryDecompositionService } from './query-decomposition.service';
import { appLogger } from '../utils/logger.util';
import { openAiService } from './openAi.service';

// ============================================================
// TYPES
// ============================================================

export interface ContinuationIntent {
  /**
   * Apakah ini continuation dari previous context
   */
  isContinuation: boolean;

  /**
   * Confidence score (0-1)
   */
  confidence: number;

  /**
   * Tipe continuation:
   * - 'export': Export previous result (ke Excel, PDF, dll)
   * - 'refine': Refine/modify previous query
   * - 'detail': Minta detail lebih lanjut
   * - 'action': Lanjut ke action berikutnya dalam workflow
   * - 'clarify': Klarifikasi hasil sebelumnya
   * - 'workflow': Multi-handler workflow (NEW)
   * - 'new': Intent baru (bukan continuation)
   */
  type?: 'export' | 'refine' | 'detail' | 'action' | 'clarify' | 'workflow' | 'new';

  /**
   * Target handler untuk continuation (export, generate, dll)
   */
  targetHandler?: string;

  /**
   * Multiple target handlers for workflow (e.g., ['xls_generator', 'data_analyzer'])
   */
  targetHandlers?: string[];

  /**
   * Parameter yang diekstrak dari continuation
   */
  extractedParams?: Record<string, unknown>;

  /**
   * Cached result dari toolResultCache (sudah di-fetch di resolver)
   */
  cachedData?: {
    result: unknown;
    entities: Record<string, unknown>;
    toolSlug: string;
    timestamp: number;
  };

  /**
   * Reasoning mengapa ini dianggap continuation
   */
  reasoning?: string;
}

export interface ContinuationContext {
  /**
   * Working memory dari session sebelumnya
   */
  workingMemory: WorkingMemoryData | null;

  /**
   * Apakah ada previous result yang bisa di-reuse
   */
  hasPreviousResult: boolean;

  /**
   * Tools yang tersedia untuk continuation
   */
  availableContinuationTools: string[];
}

export interface ContinuationResult {
  /**
   * Apakah harus skip full pipeline dan langsung ke continuation
   */
  shouldSkipPipeline: boolean;

  /**
   * Continuation intent details
   */
  intent: ContinuationIntent;

  /**
   * Context yang akan digunakan
   */
  context: ContinuationContext;

  /**
   * Direct tool execution result (jika langsung dieksekusi)
   */
  directResult?: unknown;
}

// ============================================================
// CONTINUATION PATTERNS
// ============================================================

/**
 * Pattern kata-kata yang mengindikasikan continuation
 */
const CONTINUATION_PATTERNS = {
  export: [
    /export/i,
    /download/i,
    /unduh/i,
    /save.*excel/i,
    /save.*pdf/i,
    /simpan.*excel/i,
    /buat.*file/i,
    /download.*xlsx/i,
    /export.*csv/i,
    /export.*excel/i,        // ← NEW: "export ke excel"
    /jadi.*excel/i,          // ← NEW: "jadikan excel"
    /simpan.*xlsx/i,         // ← NEW: "simpan xlsx"
    /buat.*excel/i,          // ← NEW: "buat excel"
    /xls/i,                  // ← NEW: "xls" saja
    /xlsx/i,                 // ← NEW: "xlsx" saja
    /excel/i,                // ← NEW: "excel" saja (jika ada context sebelumnya)
  ],
  refine: [
    /ubah/i,
    /ganti/i,
    /modify/i,
    /update/i,
    /revisi/i,
    /edit/i,
    /ganti.*yang.*baru/i,
  ],
  detail: [
    /detail/i,
    /lebih.*lanjut/i,
    /lebih.*jelas/i,
    /tampilkan.*semua/i,
    /show.*all/i,
    /apa.*saja/i,
  ],
  action: [
    /lanjut/i,
    /proses/i,
    /submit/i,
    /konfirmasi/i,
    /setuju/i,
    /approve/i,
    /send/i,
    /kirim/i,
  ],
  clarify: [
    /kenapa/i,
    /mengapa/i,
    /bagaimana/i,
    /apa.*arti/i,
    /maksudnya/i,
    /explain/i,
  ],
};

// ============================================================
// CONTINUATION RESOLVER SERVICE
// ============================================================

class ContinuationResolverService {
  private readonly CONTINUATION_CONFIDENCE_THRESHOLD = 0.6;
  private readonly EXPORT_TOOLS_PATTERN = ['export', 'download', 'xls', 'pdf', 'csv', 'generate'];
  private readonly USE_LLM_THRESHOLD = 0.7; // If pattern confidence < 0.7, use LLM

  /**
   * RESOLVE - Cek apakah input adalah continuation
   * OPTIMIZED: Single cache fetch, handler validation, LLM-only when needed
   * @param userId - User identifier
   * @param appName - App name
   * @param userInput - User input text
   * @param workingMemory - Optional working memory from pipeline (to avoid double fetch)
   * @param options - Optional configuration
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

      // 3. OPTIMIZATION: Fetch cache ONCE at the beginning (reuse in all branches)
      const sessionKey = `${userId}:${appName}`;
      const cachedData = await toolResultCache.get(sessionKey, undefined, { skipRedis: false });

      // 4. Check continuation hints from working memory
      const canExport = memory?.continuationHints?.canExport;
      const canSummarize = memory?.continuationHints?.canSummarize;
      const hasExportPattern = /export|download|unduh|excel|xls|xlsx|pdf|csv/i.test(userInput);
      const hasSummarizePattern = /analisa|analyze|summary|summarize|ringkas|hitung/i.test(userInput);

      // 5. Detect multi-handler workflow (e.g., "export lalu analisa")
      const workflowHandlers = this.detectWorkflowHandlers(userInput, memory);

      if (workflowHandlers.length > 1) {
        appLogger.info('[ContinuationResolver] Multi-handler workflow detected', {
          userId,
          appName,
          handlers: workflowHandlers,
          userInput
        });

        // VALIDATE: Check if all handlers exist in registry
        const validatedHandlers = await this.validateHandlers(workflowHandlers);
        
        if (validatedHandlers.length < 2) {
          appLogger.warn('[ContinuationResolver] Workflow validation failed - some handlers not found', {
            requested: workflowHandlers,
            validated: validatedHandlers
          });
          // Fallback to single handler or continue to LLM
        } else {
          // Valid workflow with validated handlers
          return {
            shouldSkipPipeline: true,
            intent: {
              isContinuation: true,
              confidence: 0.95, // Very high confidence for explicit workflow
              type: 'workflow',
              targetHandler: validatedHandlers[0], // First handler
              targetHandlers: validatedHandlers,   // All validated handlers in order
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
        appLogger.info('[ContinuationResolver] Quick match: canExport=true + export pattern', {
          userId,
          appName,
          userInput,
          canExport
        });

        const targetHandler = userInput.toLowerCase().includes('pdf') ? 'pdf_generator' : 'xls_generator';
        
        // VALIDATE: Check if handler exists
        const handlerExists = await this.handlerExists(targetHandler);
        if (!handlerExists) {
          appLogger.warn('[ContinuationResolver] Handler not found, falling back', {
            targetHandler
          });
          // Continue to LLM or other fallback
        } else {
          // Fast-track export continuation
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
        appLogger.info('[ContinuationResolver] Quick match: canSummarize=true + summarize pattern', {
          userId,
          appName,
          userInput,
          canSummarize
        });

        const targetHandler = 'data_analyzer';
        
        // VALIDATE: Check if handler exists
        const handlerExists = await this.handlerExists(targetHandler);
        if (!handlerExists) {
          appLogger.warn('[ContinuationResolver] Handler not found, falling back', {
            targetHandler
          });
        } else {
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

      // 7. Use LLM only for ambiguous cases (optional)
      const useLLM = options?.useLLM !== false; // Default true
      if (useLLM) {
        return await this.resolveWithLLM(userId, appName, userInput, memory, cachedData, start);
      }

      // Fallback: not a continuation
      return {
        shouldSkipPipeline: false,
        intent: {
          isContinuation: false,
          confidence: 0.3,
          type: 'new',
          reasoning: 'No clear pattern matched and LLM disabled'
        },
        context: {
          workingMemory: memory,
          hasPreviousResult: !!cachedData,
          availableContinuationTools: []
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      appLogger.error('[ContinuationResolver] Resolution failed', {
        userId,
        appName,
        error: errorMessage
      });

      // Fallback: not a continuation on error
      return {
        shouldSkipPipeline: false,
        intent: {
          isContinuation: false,
          confidence: 0,
          type: 'new',
          reasoning: `Error during resolution: ${errorMessage}`
        },
        context: {
          workingMemory: null,
          hasPreviousResult: false,
          availableContinuationTools: []
        }
      };
    }
  }

  /**
   * VALIDATE HANDLERS - Check if handlers exist in intent registry
   * Returns only handlers that are registered and available
   */
  private async validateHandlers(handlers: string[]): Promise<string[]> {
    const validated: string[] = [];
    
    for (const handler of handlers) {
      const exists = await this.handlerExists(handler);
      if (exists) {
        validated.push(handler);
      } else {
        appLogger.warn('[ContinuationResolver] Handler not found in registry', {
          handler,
          availableHandlers: intentRegistry.getAll().map(i => i.slug)
        });
      }
    }
    
    return validated;
  }

  /**
   * HANDLER EXISTS - Check if single handler exists in intent registry
   */
  private async handlerExists(handlerSlug: string): Promise<boolean> {
    try {
      // Check in intentRegistry (handlers are registered as intents)
      const handler = await intentRegistry.getBySlugs([handlerSlug]);
      return handler.length > 0;
    } catch (error) {
      appLogger.debug('[ContinuationResolver] Handler check failed', {
        handlerSlug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * DETECT WORKFLOW HANDLERS - Detect multi-handler workflow from user input
   * Example: "export ke excel lalu analisa" → ['xls_generator', 'data_analyzer']
   * 
   * VALIDATION: Only detect workflow if:
   * 1. Multiple distinct actions detected (not just compound objects)
   * 2. Each part has clear handler pattern
   * 3. Confidence > threshold
   */
  private detectWorkflowHandlers(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): string[] {
    const handlers: string[] = [];
    const lowerInput = userInput.toLowerCase();

    // Use queryDecompositionService for intelligent splitting
    const parts = queryDecompositionService.splitByConnectors(lowerInput);

    // Need at least 2 parts for workflow
    if (parts.length < 2) {
      return [];
    }

    appLogger.debug('[ContinuationResolver] Detecting workflow from decomposition', {
      input: userInput,
      parts: parts
    });

    // Detect handler for each part with validation
    for (const part of parts) {
      const trimmedPart = part.trim();
      
      // Skip very short parts (likely not a complete action)
      if (trimmedPart.length < 3) {
        continue;
      }

      const handler = this.detectSingleHandler(trimmedPart, workingMemory);
      
      // Only add if handler detected AND part has action verb (not just object)
      if (handler && this.hasActionVerb(trimmedPart)) {
        // Avoid duplicates unless intentional (user explicitly said different actions)
        if (!handlers.includes(handler)) {
          handlers.push(handler);
        }
      }
    }

    // VALIDATION: Only return workflow if we have multiple DISTINCT handlers
    // "export data dan laporan" → 1 handler (export), should NOT be workflow
    // "export lalu analisa" → 2 handlers, IS workflow
    const uniqueHandlers = [...new Set(handlers)];
    
    if (uniqueHandlers.length >= 2) {
      appLogger.info('[ContinuationResolver] Multi-handler workflow validated', {
        handlers: uniqueHandlers,
        confidence: 'high'
      });
      return uniqueHandlers;
    }

    // Not a valid workflow (either 0 or 1 unique handler)
    appLogger.debug('[ContinuationResolver] Not a workflow (single handler)', {
      handlers,
      uniqueHandlers: uniqueHandlers.length
    });
    
    return [];
  }

  /**
   * HAS ACTION VERB - Check if text contains action verb (not just object)
   * Prevents false positive: "data dan laporan" (no action) vs "export dan analisa" (has action)
   */
  private hasActionVerb(text: string): boolean {
    const lower = text.toLowerCase();
    
    // Action verbs for handlers
    const actionPatterns = [
      /export|download|unduh|generate|buat|simpan/i,  // Export actions
      /analisa|analyze|summary|summarize|ringkas|hitung/i,  // Analysis actions
      /send|email|kirim|notify|notifikasi/i,  // Communication actions
      /modify|ubah|edit|update|revisi/i  // Modification actions
    ];

    return actionPatterns.some(pattern => pattern.test(lower));
  }

  /**
   * DETECT SINGLE HANDLER - Detect single handler from text
   */
  private detectSingleHandler(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): string | undefined {
    const lower = userInput.toLowerCase();

    // Export handlers
    if (/export|download|unduh|excel|xls|xlsx/i.test(lower)) {
      return lower.includes('pdf') ? 'pdf_generator' : 'xls_generator';
    }

    if (/csv/i.test(lower)) {
      return 'csv_generator';
    }

    // Summarize/Analyze handlers
    if (/analisa|analyze|summary|summarize|ringkas|hitung/i.test(lower)) {
      return 'data_analyzer';
    }

    // Send/Notify handlers
    if (/send|email|kirim|notify|notifikasi/i.test(lower)) {
      return 'email_sender';
    }

    return undefined;
  }

  /**
   * RESOLVE WITH LLM - Fallback to LLM for ambiguous cases
   */
  private async resolveWithLLM(
    userId: string,
    appName: string,
    userInput: string,
    memory: WorkingMemoryData | null,
    cachedData: any,  // Reuse cachedData from main resolve
    start: number
  ): Promise<ContinuationResult> {
    // Analyze input for continuation patterns
    const patternAnalysis = this.analyzePatterns(userInput);

    // Use LLM for semantic understanding
    const llmAnalysis = await this.analyzeWithLLM(userInput, memory);

    // Combine results
    const combinedConfidence = this.combineConfidenceScores(
      patternAnalysis,
      { type: llmAnalysis.type || 'new', confidence: llmAnalysis.confidence }
    );

    const isContinuation = combinedConfidence >= this.CONTINUATION_CONFIDENCE_THRESHOLD;

    appLogger.info('[ContinuationResolver] LLM analysis complete', {
      userId,
      appName,
      isContinuation,
      confidence: combinedConfidence,
      patternType: patternAnalysis.detectedType,
      llmType: llmAnalysis.type,
      duration: Date.now() - start
    });

    if (!isContinuation) {
      return {
        shouldSkipPipeline: false,
        intent: {
          isContinuation: false,
          confidence: combinedConfidence,
          type: 'new',
          reasoning: 'Confidence below threshold'
        },
        context: {
          workingMemory: memory,
          hasPreviousResult: !!cachedData,
          availableContinuationTools: []
        }
      };
    }

    // Determine target handler for continuation
    const targetHandler = await this.determineTargetHandler(
      patternAnalysis.detectedType,
      memory,
      userInput
    );

    // VALIDATE: Check if handler exists
    if (targetHandler && !(await this.handlerExists(targetHandler))) {
      appLogger.warn('[ContinuationResolver] LLM-suggested handler not found', {
        targetHandler
      });
      return {
        shouldSkipPipeline: false,
        intent: {
          isContinuation: false,
          confidence: combinedConfidence,
          type: 'new',
          reasoning: `Handler '${targetHandler}' not found in registry`
        },
        context: {
          workingMemory: memory,
          hasPreviousResult: !!cachedData,
          availableContinuationTools: []
        }
      };
    }

    // Extract params if needed
    const extractedParams = this.extractContinuationParams(
      patternAnalysis.detectedType,
      userInput,
      memory
    );

    // Check if we can execute directly (for simple exports)
    const canExecuteDirectly = patternAnalysis.detectedType === 'export' && !!targetHandler;

    return {
      shouldSkipPipeline: canExecuteDirectly,
      intent: {
        isContinuation: true,
        confidence: combinedConfidence,
        type: patternAnalysis.detectedType,
        targetHandler,
        extractedParams,
        cachedData: cachedData ? {
          result: cachedData.result,
          entities: cachedData.entities,
          toolSlug: cachedData.toolSlug,
          timestamp: cachedData.timestamp
        } : undefined,
        reasoning: llmAnalysis.reasoning
      },
      context: {
        workingMemory: memory,
        hasPreviousResult: !!cachedData,
        availableContinuationTools: targetHandler ? [targetHandler] : []
      }
    };
  }

  /**
   * ANALYZE PATTERNS - Rule-based pattern matching
   */
  private analyzePatterns(userInput: string): {
    detectedType: ContinuationIntent['type'];
    confidence: number;
    matchedPattern?: string;
  } {
    for (const [type, patterns] of Object.entries(CONTINUATION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(userInput)) {
          appLogger.debug('[ContinuationResolver] Pattern matched', {
            type,
            pattern: pattern.source
          });

          return {
            detectedType: type as ContinuationIntent['type'],
            confidence: 0.7, // Rule-based has decent confidence
            matchedPattern: pattern.source
          };
        }
      }
    }

    return {
      detectedType: 'new',
      confidence: 0
    };
  }

  /**
   * ANALYZE WITH LLM - Semantic understanding
   */
  private async analyzeWithLLM(
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): Promise<{
    type: ContinuationIntent['type'];
    confidence: number;
    reasoning: string;
  }> {
    try {
      const contextInfo = workingMemory
        ? `
Previous Context:
- Active Intent: ${workingMemory.activeIntent || 'none'}
- Active Workflow: ${workingMemory.activeWorkflow || 'none'}
- Active Tool: ${workingMemory.activeTool || 'none'}
- Entities: ${JSON.stringify(workingMemory.activeEntities || {})}
`
        : 'No previous context';

      const prompt = `
Analisis apakah input pengguna berikut adalah continuation dari konteks sebelumnya atau intent baru.

${contextInfo}

Input Pengguna: "${userInput}"

Klasifikasikan ke salah satu tipe:
- "export": User ingin export/download hasil sebelumnya (ke Excel, PDF, CSV, dll)
- "refine": User ingin mengubah/modifikasi query sebelumnya
- "detail": User ingin detail lebih lanjut dari hasil sebelumnya
- "action": User ingin lanjut ke action berikutnya dalam workflow
- "clarify": User ingin klarifikasi/penjelasan hasil sebelumnya
- "new": Intent benar-benar baru, tidak terkait konteks sebelumnya

Berikan juga confidence score (0-1) dan reasoning singkat.

Format output JSON:
{
  "type": "<tipe>",
  "confidence": <angka 0-1>,
  "reasoning": "<alasan singkat>"
}

Output:`.trim();

      const response = await openAiService.generateJson(prompt);
      const parsed = JSON.parse(response);

      return {
        type: parsed.type || 'new',
        confidence: parsed.confidence || 0.5,
        reasoning: parsed.reasoning || 'No reasoning provided'
      };
    } catch (error) {
      appLogger.warn('[ContinuationResolver] LLM analysis failed, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        type: 'new',
        confidence: 0.3,
        reasoning: 'LLM analysis failed'
      };
    }
  }

  /**
   * COMBINE CONFIDENCE SCORES - Weighted average
   */
  private combineConfidenceScores(
    patternAnalysis: { detectedType: string | undefined; confidence: number },
    llmAnalysis: { type: string; confidence: number }
  ): number {
    // If both agree, boost confidence
    if (patternAnalysis.detectedType && patternAnalysis.detectedType === llmAnalysis.type && patternAnalysis.detectedType !== 'new') {
      return Math.min((patternAnalysis.confidence + llmAnalysis.confidence) / 2 + 0.1, 1.0);
    }

    // Weighted average: LLM lebih penting (0.6) daripada pattern (0.4)
    const weighted =
      (patternAnalysis.detectedType ? patternAnalysis.confidence : 0) * 0.4 +
      llmAnalysis.confidence * 0.6;

    return weighted;
  }

  /**
   * DETERMINE TARGET HANDLER - Cari handler yang tepat untuk continuation
   */
  private async determineTargetHandler(
    type: ContinuationIntent['type'] | undefined,
    workingMemory: WorkingMemoryData | null,
    userInput: string
  ): Promise<string | undefined> {
    if (!type || type === 'new') {
      return undefined;
    }

    if (type === 'export') {
      // Export handler berdasarkan preferensi format di input
      return this.getExportHandler(userInput);

    }

    if (type === 'refine' || type === 'detail') {
      // Reuse previous handler dengan different params
      return workingMemory?.activeTool;
    }

    if (type === 'action') {
      // Next step in workflow
      // This would require workflow definition to know next step
      // For now, return undefined to let pipeline handle it
      return undefined;
    }

    return undefined;
  }

  private getExportHandler(userInput: string): string {
    const lower = userInput.toLowerCase();
    if (lower.includes('pdf')) return 'pdf_generator';
    return 'xls_generator';
  }

  /**
   * EXTRACT CONTINUATION PARAMS - Ekstrak param sederhana dari continuation
   */
  private extractContinuationParams(
    type: ContinuationIntent['type'],
    userInput: string,
    workingMemory: WorkingMemoryData | null
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {};

    if (type === 'export') {
      // Extract format preference
      const lower = userInput.toLowerCase();
      if (lower.includes('excel') || lower.includes('xls')) {
        params.format = 'xlsx';
      } else if (lower.includes('pdf')) {
        params.format = 'pdf';
      } else if (lower.includes('csv')) {
        params.format = 'csv';
      }
    }

    if (type === 'refine') {
      // Try to extract what to change
      // This is simplified - full extraction would use paramExtractorService
      const previousEntities = workingMemory?.activeEntities || {};
      params.previousEntities = previousEntities;
    }

    return params;
  }

  /**
   * UPDATE WORKING MEMORY - Update working memory berdasarkan continuation
   */
  async updateWorkingMemory(
    userId: string,
    appName: string,
    continuationIntent: ContinuationIntent
  ): Promise<void> {
    if (!continuationIntent.isContinuation) {
      return;
    }

    const updates: Partial<WorkingMemoryData> = {};

    if (continuationIntent.targetHandler) {
      updates.activeTool = continuationIntent.targetHandler;
    }

    if (continuationIntent.extractedParams && Object.keys(continuationIntent.extractedParams).length > 0) {
      updates.activeEntities = {
        ...(await workingMemoryService.get(userId, appName))?.activeEntities,
        ...continuationIntent.extractedParams
      };
    }

    if (continuationIntent.type === 'export') {
      updates.continuationHints = {
        canExport: false, // Already exported
        canSummarize: true
      };
    }

    await workingMemoryService.update(userId, appName, updates);
  }
}

// Singleton instance
export const continuationResolverService = new ContinuationResolverService();
