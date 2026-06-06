import { workingMemoryService } from '../../workingMemory.service';
import { toolResultCache } from '../../memories/toolResultCache.service';
import { appLogger } from '../../../utils/logger.util';
import { continuationAnalyzer } from '../continuation/continuation-analyzer';
import { toolRepository } from '../../toolRepository.service';
import { WorkingMemoryData } from '../../../types/working-memory.type'
import { queryDecompositionService } from '../../query-decomposition.service';
import { skillMatcher } from '../../skill-matcher.service';
import { skillsRegistry } from '../../skills-registry.service';
import { buildTemporalFollowUpResidue } from '../../../utils/text-intent-cleanup.util';

// ============================================================
// Types
// ============================================================

export interface ContinuationIntent {
  isContinuation: boolean;
  confidence: number;
  type?: 'export' | 'refine' | 'detail' | 'comparison' | 'action' | 'clarify' | 'workflow' | 'new';
  targetSkill?: string;
  targetTool?: string;
  targetSkills?: string[];
  extractedParams?: Record<string, unknown>;
  cachedData?: {
    result: unknown;
    entities: Record<string, unknown>;
    toolSlug?: string;
    timestamp: number;
  };
  reasoning?: string;
}

export interface ContinuationContext {
  workingMemory: WorkingMemoryData | null;
  hasPreviousResult: boolean;
  availableContinuationTools: string[];
  availableContinuationSkills: string[];
}

export interface ContinuationResult {
  shouldSkipPipeline: boolean;
  intent: ContinuationIntent;
  context: ContinuationContext;
  directResult?: unknown;
}

// ============================================================
// Constants
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
    /ganti.*yang.*baru/i, /kalau/i,
    /\bcari\b/i, /\bapakah\s+ada\b/i, /\bada\s+.+\?/i,
  ],
  detail: [
    /detail/i, /lebih.*lanjut/i, /lebih.*jelas/i, /tampilkan.*semua/i,
    /show.*all/i, /apa.*saja/i, /analisa/i, /analyze/i, /analisis/i,
    /summary/i, /ringkas/i, /rangkum/i, /coba.*analisa/i, /coba.*analyze/i,
  ],
  action: [
    /lanjut/i, /proses/i, /submit/i, /konfirmasi/i, /setuju/i,
    /approve/i, /send/i, /kirim/i, /coba/i, /cek/i, /check/i, /lihat/i,
  ],
  clarify: [
    /kenapa/i, /mengapa/i, /bagaimana/i, /apa.*arti/i, /maksudnya/i, /explain/i,
  ],
};

const COMMON_CITIES_PATTERN = /\b(bali|jakarta|bandung|surabaya|medan|semarang|makassar|palembang|denpasar|yogyakarta|lombok|batam|malang|padang|manado|pontianak|balikpapan|samarinda|jambi|pekanbaru|mataram|kupang|ambon|jayapura|gorontalo|kendari|ternate|palu|tasikmalaya|cirebon|banjarmasin|singkawang)\b/i;

// ============================================================
// Main Resolver
// ============================================================

export class ContinuationResolver {
  private readonly CONTINUATION_CONFIDENCE_THRESHOLD = 0.6;
  private readonly ANALYZER_CONFIDENCE_THRESHOLD = 0.70;
  private readonly MIN_SKILL_CONFIDENCE = 0.55;

  async resolve(
    userId: string,
    appName: string,
    userInput: string,
    workingMemory?: WorkingMemoryData | null,
    options?: { useLLM?: boolean }
  ): Promise<ContinuationResult> {
    const start = Date.now();
    const normalizedInput = userInput.trim();
    
    if (!normalizedInput) {
      return this.createNonContinuationResult(null, 'Empty input');
    }

    try {
      const memory = workingMemory ?? await workingMemoryService.get(userId, appName);
      
      if (!this.hasPreviousContext(memory)) {
        appLogger.debug('[ContinuationResolver] No previous context', {
          userId,
          appName,
          hasActiveIntent: !!memory?.activeIntent,
          hasActiveWorkflow: !!memory?.activeWorkflow,
          hasActiveTool: !!memory?.activeTool,
          hasActiveSkill: !!memory?.activeSkill
        });
        return this.createNonContinuationResult(null, 'No previous context');
      }

      // Get analyzer result in parallel with cache fetch
      const [analysisResult, cachedData] = await Promise.all([
        continuationAnalyzer.analyze({
          userId,
          appName,
          userInput: normalizedInput,
          workingMemory: memory
        }),
        toolResultCache.get(`${userId}:${appName}`, undefined, { skipRedis: false })
      ]);

      appLogger.debug('[ContinuationResolver] Analyzer result', {
        userId,
        appName,
        isContinuation: analysisResult.isContinuation,
        finalConfidence: analysisResult.finalConfidence,
        continuationType: analysisResult.continuationType
      });

      // Check comparison signal
      const decomposition = queryDecompositionService.decompose(normalizedInput);
      const comparisonSignal = decomposition.signals.comparison;
      
      const comparisonResult = await this.handleComparisonSignal(
        normalizedInput,
        comparisonSignal,
        memory,
        cachedData,
        userId,
        appName
      );
      if (comparisonResult) return comparisonResult;

      // High confidence from analyzer
      if (analysisResult.isContinuation && 
          analysisResult.finalConfidence >= this.ANALYZER_CONFIDENCE_THRESHOLD) {
        return this.buildIntentFromAnalyzer(analysisResult, memory, cachedData);
      }

      // Fallback to pattern-based detection
      return await this.handlePatternBasedDetection(
        normalizedInput,
        memory,
        cachedData,
        userId,
        appName
      );

    } catch (error) {
      appLogger.error('[ContinuationResolver] Resolution failed', {
        error: error instanceof Error ? error.message : error,
        userId,
        appName,
        duration: Date.now() - start
      });
      return this.createNonContinuationResult(null, 'Resolution error');
    } finally {
      await this.storeQuerySnapshot(userId, appName, userInput, workingMemory);
    }
  }

  // ============================================================
  // Private Helper Methods
  // ============================================================

  private hasPreviousContext(memory: WorkingMemoryData | null): boolean {
    return !!(
      memory?.activeIntent ||
      memory?.activeWorkflow ||
      memory?.activeTool ||
      memory?.activeSkill
    );
  }

  private createNonContinuationResult(
    memory: WorkingMemoryData | null,
    reason: string
  ): ContinuationResult {
    return {
      shouldSkipPipeline: false,
      intent: {
        isContinuation: false,
        confidence: 0,
        type: 'new',
        reasoning: reason
      },
      context: {
        workingMemory: memory,
        hasPreviousResult: false,
        availableContinuationTools: [],
        availableContinuationSkills: []
      }
    };
  }

  private async handleComparisonSignal(
    normalizedInput: string,
    comparisonSignal: any,
    memory: WorkingMemoryData | null,
    cachedData: any,
    userId: string,
    appName: string
  ): Promise<ContinuationResult | null> {
    if (!comparisonSignal?.isComparison) return null;

    if (comparisonSignal.baseline?.source === 'current_query') {
      appLogger.info('[ContinuationResolver] Comparison belongs to current query, routing to main pipeline', {
        userId,
        appName,
        activeTool: memory?.activeTool,
        operator: comparisonSignal.operator
      });

      return this.createNonContinuationResult(memory, 'Comparison baseline is in current query');
    }

    if (memory?.activePlan && memory?.activeTool) {
      appLogger.info('[ContinuationResolver] Comparison continuation detected', {
        userId,
        appName,
        activeTool: memory.activeTool,
        operator: comparisonSignal.operator
      });

      const analysisSkill = await this.getBestSkillForAnalysis(normalizedInput, true);

      return {
        shouldSkipPipeline: true,
        intent: {
          isContinuation: true,
          confidence: 0.92,
          type: 'comparison',
          targetTool: memory.activeTool,
          targetSkill: analysisSkill?.skillSlug,
          cachedData: this.safeGetCachedData(cachedData),
          reasoning: `Comparison signal matched → ${analysisSkill?.skillSlug || 'analysis skill'}`
        },
        context: {
          workingMemory: memory,
          hasPreviousResult: !!cachedData,
          availableContinuationTools: [memory.activeTool],
          availableContinuationSkills: analysisSkill?.skillSlug ? [analysisSkill.skillSlug] : []
        }
      };
    }

    appLogger.info('[ContinuationResolver] Comparison signal without active plan', {
      userId,
      appName,
      operator: comparisonSignal.operator
    });

    return this.createNonContinuationResult(memory, 'Comparison requires active plan');
  }

  private buildIntentFromAnalyzer(
    analysisResult: any,
    memory: WorkingMemoryData | null,
    cachedData: any
  ): ContinuationResult {
    const targetSkill = analysisResult.recommendation?.targetSkill;
    
    // ✅ DYNAMIC: Check actual capabilities instead of string matching
    const skill = targetSkill ? skillsRegistry.getSkillBySlug(targetSkill) : null;
    const isGenerator = skill?.capabilities?.actionTypes?.includes('export') ?? false;
    const isAnalyzer = skill?.capabilities?.actionTypes?.includes('analyze') ?? false;

    return {
      shouldSkipPipeline: true,
      intent: {
        isContinuation: true,
        confidence: analysisResult.finalConfidence,
        type: analysisResult.continuationType as any,
        targetSkill: targetSkill,
        cachedData: this.safeGetCachedData(cachedData),
        reasoning: Array.isArray(analysisResult.reasoning) 
          ? analysisResult.reasoning.join('. ')
          : analysisResult.reasoning,
        extractedParams: analysisResult.entityResult?.detections?.reduce((acc: any, d: any) => {
          acc[d.type] = d.value;
          return acc;
        }, {})
      },
      context: {
        workingMemory: memory,
        hasPreviousResult: !!cachedData,
        availableContinuationTools: (targetSkill && !isGenerator && !isAnalyzer) ? [targetSkill] : [],
        availableContinuationSkills: (targetSkill && (isGenerator || isAnalyzer)) ? [targetSkill] : []
      }
    };
  }

  private async handlePatternBasedDetection(
    userInput: string,
    memory: WorkingMemoryData | null,
    cachedData: any,
    userId: string,
    appName: string
  ): Promise<ContinuationResult> {
    const hasData = !!cachedData?.result;
    const canExport = memory?.continuationHints?.canExport;
    const canSummarize = memory?.continuationHints?.canSummarize;
    const hasExportPattern = /export|download|unduh|excel|xls|xlsx|pdf|csv/i.test(userInput);
    const hasSummarizePattern = /analisa|analyze|summary|summarize|ringkas|hitung/i.test(userInput);
    const decomposition = queryDecompositionService.decompose(userInput);
    const temporalDetails = decomposition.signals.temporalDetails || [];

    if (this.isTemporalRefineFollowUp(userInput, temporalDetails) && memory?.activePlan && memory?.activeTool) {
      appLogger.debug('[ContinuationResolver] Temporal refine continuation', {
        userId,
        appName,
        activeTool: memory.activeTool,
        temporalDetails: temporalDetails.map(detail => ({
          type: detail.type,
          value: detail.value,
          normalizedValue: detail.normalizedValue
        }))
      });

      return {
        shouldSkipPipeline: true,
        intent: {
          isContinuation: true,
          confidence: 0.82,
          type: 'refine',
          targetTool: memory.activeTool,
          cachedData: this.safeGetCachedData(cachedData),
          reasoning: `Temporal refine -> ${memory.activeTool}`
        },
        context: {
          workingMemory: memory,
          hasPreviousResult: !!cachedData,
          availableContinuationTools: [memory.activeTool],
          availableContinuationSkills: []
        }
      };
    }

    // Multi-skill workflow detection
    const workflowSkills = await this.detectWorkflowSkills(userInput, memory, hasData);
    if (workflowSkills.length > 1) {
      const validatedSkills = await this.validateSkills(workflowSkills);
      if (validatedSkills.length >= 2) {
        appLogger.info('[ContinuationResolver] Multi-skill workflow', {
          userId,
          appName,
          skills: workflowSkills
        });
        return {
          shouldSkipPipeline: true,
          intent: {
            isContinuation: true,
            confidence: 0.95,
            type: 'workflow',
            targetSkill: validatedSkills[0],
            targetSkills: validatedSkills,
            cachedData: this.safeGetCachedData(cachedData),
            reasoning: `Multi-skill workflow: ${validatedSkills.join(' → ')}`
          },
          context: {
            workingMemory: memory,
            hasPreviousResult: !!cachedData,
            availableContinuationTools: [],
            availableContinuationSkills: validatedSkills
          }
        };
      }
    }

    // Fast-track: Export pattern
    if (canExport && hasExportPattern) {
      const selectedSkill = await this.selectSkill('export', userInput, { hasData });
      if (selectedSkill) {
        appLogger.info('[ContinuationResolver] Export continuation', {
          userId,
          appName,
          selectedSkill: selectedSkill.skillSlug
        });
        return this.buildExportResult(selectedSkill.skillSlug, memory, cachedData);
      }
    }

    // Fast-track: Summarize pattern
    if (canSummarize && hasSummarizePattern) {
      const selectedSkill = await this.selectSkill('detail', userInput, { hasData });
      if (selectedSkill) {
        appLogger.info('[ContinuationResolver] Analyze continuation', {
          userId,
          appName,
          selectedSkill: selectedSkill.skillSlug
        });
        return this.buildDetailResult(selectedSkill.skillSlug, memory, cachedData);
      }
    }

    // Standard pattern detection
    const patternMatch = this.detectContinuationPatterns(userInput);
    if (patternMatch.confidence >= this.CONTINUATION_CONFIDENCE_THRESHOLD) {
      if (patternMatch.type === 'refine' && memory?.activePlan && memory?.activeTool) {
        appLogger.debug('[ContinuationResolver] Active tool refine continuation', {
          userId,
          appName,
          activeTool: memory.activeTool
        });

        return {
          shouldSkipPipeline: true,
          intent: {
            isContinuation: true,
            confidence: patternMatch.confidence,
            type: 'refine',
            targetTool: memory.activeTool,
            cachedData: this.safeGetCachedData(cachedData),
            reasoning: `Pattern: refine -> ${memory.activeTool}`
          },
          context: {
            workingMemory: memory,
            hasPreviousResult: !!cachedData,
            availableContinuationTools: [memory.activeTool],
            availableContinuationSkills: []
          }
        };
      }

      const selectedSkill = await this.selectSkill(patternMatch.type, userInput, { hasData });
      if (selectedSkill) {
        appLogger.debug('[ContinuationResolver] Pattern-based continuation', {
          userId,
          appName,
          patternType: patternMatch.type,
          selectedSkill: selectedSkill.skillSlug
        });
        return this.buildPatternResult(patternMatch, selectedSkill.skillSlug, memory, cachedData);
      }
    }

    return this.createNonContinuationResult(memory, 'No pattern matched');
  }

  private isTemporalRefineFollowUp(userInput: string, temporalDetails: any[]): boolean {
    if (!temporalDetails.length) return false;

    const normalized = userInput
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return false;

    const residue = buildTemporalFollowUpResidue(normalized);

    return residue.length === 0;
  }

  // ============================================================
  // Result Builders
  // ============================================================

  private buildExportResult(
    skillSlug: string,
    memory: WorkingMemoryData | null,
    cachedData: any
  ): ContinuationResult {
    return {
      shouldSkipPipeline: true,
      intent: {
        isContinuation: true,
        confidence: 0.9,
        type: 'export',
        targetSkill: skillSlug,
        cachedData: this.safeGetCachedData(cachedData),
        reasoning: `Export pattern → ${skillSlug}`
      },
      context: {
        workingMemory: memory,
        hasPreviousResult: !!cachedData,
        availableContinuationTools: [],
        availableContinuationSkills: [skillSlug]
      }
    };
  }

  private buildDetailResult(
    skillSlug: string,
    memory: WorkingMemoryData | null,
    cachedData: any
  ): ContinuationResult {
    return {
      shouldSkipPipeline: true,
      intent: {
        isContinuation: true,
        confidence: 0.9,
        type: 'detail',
        targetSkill: skillSlug,
        cachedData: this.safeGetCachedData(cachedData),
        reasoning: `Analyze pattern → ${skillSlug}`
      },
      context: {
        workingMemory: memory,
        hasPreviousResult: !!cachedData,
        availableContinuationTools: [],
        availableContinuationSkills: [skillSlug]
      }
    };
  }

  private buildPatternResult(
    patternMatch: { confidence: number; type: ContinuationIntent['type'] },
    skillSlug: string,
    memory: WorkingMemoryData | null,
    cachedData: any
  ): ContinuationResult {
    const isSkill = skillsRegistry.hasSkill(skillSlug);
    
    return {
      shouldSkipPipeline: true,
      intent: {
        isContinuation: true,
        confidence: patternMatch.confidence,
        type: patternMatch.type,
        targetSkill: isSkill ? skillSlug : undefined,
        targetTool: !isSkill ? skillSlug : undefined,
        cachedData: this.safeGetCachedData(cachedData),
        reasoning: `Pattern: ${patternMatch.type} → ${skillSlug}`
      },
      context: {
        workingMemory: memory,
        hasPreviousResult: !!cachedData,
        availableContinuationTools: !isSkill ? [skillSlug] : [],
        availableContinuationSkills: isSkill ? [skillSlug] : []
      }
    };
  }

  // ============================================================
  // Core Logic Methods
  // ============================================================

  private detectContinuationPatterns(userInput: string): {
    confidence: number;
    type: ContinuationIntent['type'];
  } {
    const normalized = userInput.trim();
    const lowerInput = normalized.toLowerCase();

    // Single-word city detection
    if (COMMON_CITIES_PATTERN.test(normalized)) {
      const wordCount = normalized.split(/\s+/).length;
      if (wordCount === 1 && normalized.length >= 3 && normalized.length <= 20) {
        return { confidence: 0.75, type: 'refine' };
      }
    }

    // Pattern matching
    for (const [type, patterns] of Object.entries(CONTINUATION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(lowerInput)) {
          return { confidence: 0.8, type: type as ContinuationIntent['type'] };
        }
      }
    }

    return { confidence: 0, type: 'new' };
  }

  private async detectWorkflowSkills(
    userInput: string,
    memory: WorkingMemoryData | null,
    hasData: boolean
  ): Promise<string[]> {
    const skills: string[] = [];
    const added = new Set<string>();

    // Export-related
    if (/export|download|xlsx|excel|xls|csv/i.test(userInput)) {
      const exportSkill = await this.selectSkill('export', userInput, { hasData });
      if (exportSkill && !added.has(exportSkill.skillSlug)) {
        skills.push(exportSkill.skillSlug);
        added.add(exportSkill.skillSlug);
      }
    }

    // Analyze-related
    if (/analisa|analyze|analisis|summary|ringkas|rangkum|hitung/i.test(userInput)) {
      const analyzeSkill = await this.selectSkill('detail', userInput, { hasData });
      if (analyzeSkill && !added.has(analyzeSkill.skillSlug)) {
        skills.push(analyzeSkill.skillSlug);
        added.add(analyzeSkill.skillSlug);
      }
    }

    // Connector detection (lalu, kemudian, dan)
    if (/lalu|kemudian|dan|setelah/i.test(userInput) && skills.length === 0 && memory?.activeTool) {
      skills.push(memory.activeTool);
    }

    return skills;
  }

  private async validateSkills(skills: string[], agentId?: string): Promise<string[]> {
    const validated: string[] = [];

    for (const skill of skills) {
      if (skillsRegistry.hasSkill(skill)) {
        validated.push(skill);
      } else if (agentId && await toolRepository.toolExists(agentId, skill)) {
        validated.push(skill);
      } else {
        appLogger.warn('[ContinuationResolver] Skill not found', { skill, agentId });
      }
    }

    return validated;
  }

  /**
   * ✅ DYNAMIC: Select skill using skillMatcher (no hardcode!)
   */
  private async selectSkill(
    continuationType: ContinuationIntent['type'],
    userQuery: string,
    context: { hasData?: boolean; previousSkill?: string; previousTool?: string }
  ): Promise<{ skillSlug: string; confidence: number } | null> {
    
    if (!continuationType || continuationType === 'new') {
      appLogger.debug('[ContinuationResolver] Skipping skill selection', {
        continuationType,
        reason: 'Invalid continuation type'
      });
      return null;
    }
    
    if (!userQuery || userQuery.trim().length === 0) {
      return null;
    }

    const match = skillMatcher.matchByContinuationType(
      continuationType,
      userQuery,
      {
        hasData: context.hasData ?? false,
        previousSkill: context.previousSkill,
        previousTool: context.previousTool
      }
    );

    if (match && match.score >= this.MIN_SKILL_CONFIDENCE) {
      return {
        skillSlug: match.skill.slug,
        confidence: match.score
      };
    }

    // Fallback to default skill
    const defaultSkill = skillMatcher.getDefaultSkill(continuationType);
    if (defaultSkill) {
      appLogger.debug('[ContinuationResolver] Using default skill', {
        continuationType,
        defaultSkill: defaultSkill.slug
      });
      return {
        skillSlug: defaultSkill.slug,
        confidence: 0.5
      };
    }

    return null;
  }

  private safeGetCachedData(cachedData: any): any {
    if (!cachedData) return undefined;
    
    return {
      result: cachedData.result,
      entities: cachedData.entities,
      toolSlug: cachedData.toolSlug,
      timestamp: cachedData.timestamp || Date.now()
    };
  }

  private async storeQuerySnapshot(
    userId: string,
    appName: string,
    userInput: string,
    workingMemory?: WorkingMemoryData | null
  ): Promise<void> {
    try {
      const memory = workingMemory ?? await workingMemoryService.get(userId, appName);
      
      if (memory?.activeIntent) {
        await continuationAnalyzer.storeSnapshot(userId, appName, {
          originalQuery: userInput,
          intentSlug: memory.activeIntent,
          intentEmbedding: undefined,
          confidence: memory.continuationHints ? 0.8 : 0.5,
          entities: memory.activeEntities || {},
          executionType: memory.activeSkill ? 'skill' : memory.activeTool ? 'tool' : 'chat',
          skillKey: memory.activeSkill,
          toolSlug: memory.activeTool,
          hasResult: true
        });
      }
    } catch (error) {
      appLogger.warn('[ContinuationResolver] Failed to store snapshot', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  /**
   * Get the best skill for analysis/comparison operations
   * Prioritizes skills with 'analyze' or 'comparison' action types
   */
  private async getBestSkillForAnalysis(
    userQuery: string,
    requireData: boolean = true
  ): Promise<{ skillSlug: string; confidence: number } | null> {
    // Try 'comparison' action type first
    const comparisonSkill = await this.selectSkill('comparison', userQuery, { hasData: requireData });
    if (comparisonSkill) return comparisonSkill;
    
    // Fallback to 'detail' (analyze)
    const analyzeSkill = await this.selectSkill('detail', userQuery, { hasData: requireData });
    if (analyzeSkill) return analyzeSkill;
    
    // Last resort: any skill with 'analyze' capability
    const anyAnalyzeSkill = await this.selectAnySkillWithCapability('analyze', userQuery, requireData);
    if (anyAnalyzeSkill) return anyAnalyzeSkill;
    
    return null;
  }

  private async selectAnySkillWithCapability(
    capability: string,
    userQuery: string,
    requireData: boolean
  ): Promise<{ skillSlug: string; confidence: number } | null> {
    const allSkills = skillsRegistry.getAllSkills();
    const matchingSkills = allSkills.filter(skill => 
      skill.capabilities?.actionTypes?.includes(capability)
    );
    
    for (const skill of matchingSkills) {
      const match = skillMatcher.matchByContinuationType('detail', userQuery, {
        hasData: requireData,
        previousSkill: undefined,
        previousTool: undefined
      });
      if (match && match.score >= this.MIN_SKILL_CONFIDENCE) {
        return { skillSlug: skill.slug, confidence: match.score };
      }
    }
    
    return null;
  }
}

export const continuationResolver = new ContinuationResolver();
