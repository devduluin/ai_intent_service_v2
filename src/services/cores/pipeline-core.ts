// ============================================================
// Pipeline Core - Main Orchestrator
// ============================================================

import { intentRegistry } from '../intent-registry.service';
import { queryRewriteService } from '../query-rewrite.service';
import { confidenceDecisionService } from '../confidence-decision.service';
import { vectorService } from '../vector.service';
import { withTimeout } from '../../utils/async-helpers.util';
import { appLogger } from '../../utils/logger.util';
import { buildTemporalFollowUpResidue } from '../../utils/text-intent-cleanup.util';
import { containsWriteSuccessClaim, hasWriteProof } from '../../utils/recovery-signal.util';

import { PlanValidator } from './validators/plan.validator';
import { TemporalInjector, EntityInjector } from './injectors';
import type { TemporalDetailWithDates } from './injectors/temporal.injector';

import {
  PreProcessingStage,
  EmbeddingStage,
  IntentMatchingStage,
  PlannerStage,
  ExecutionStage,
  NaturalizationStage,
  ComparisonStage,
  FallbackMatchesStage,
  PerceptionStage,
  SelfCorrectionStage
} from './stages';
import { OfferGenerationStage } from './stages/offer-generation.stage';
import { skillSignalService } from '../skill-signal.service';
import { perceptionDisambiguationService } from '../perception-disambiguation.service';
import { memoryTaskReplayService } from '../memory-task-replay.service';
import { emotionToneService } from '../emotion-tone.service';
import { selfCorrectionRecoveryService } from '../self-correction-recovery.service';

import type { Agent } from '../../types/agent.types';
import type { EpisodicMemory } from '../../types/episodic-memory.types';
import type { WorkingMemoryData } from '../../types/working-memory.type';
import type {
  PipelineInput,
  PipelineResult,
  Intent,
  IntentMatch,
  ToolMissingParams,
  ToolParam,
  ResourceMissingParams,
  ResourceParamOwner
} from '../../types';
import type { PlannerOutput } from '../../types/planner.types';
import type { UserMessageSignals, DecomposedQuery } from '../query-decomposition.service';

// ============================================================
// Types
// ============================================================

export interface PipelineCoreConfig {
  allowCrossIntent: boolean;
  maxIntentsPerQuery: number;
  defaultTimeout: number;
  plannerTimeout: number;
}

export interface PipelineExecutionContext {
  agent: Agent;
  input: PipelineInput;  // ✅ ADDED: For episodic memory lookup
  memoryContext: ContextMemory;
  startTotal: number;
}

export interface ContextMemory {
  workingMemory: WorkingMemoryData | null;
  episodicMemory: EpisodicMemory | null;
}

export interface PipelineBranchResult {
  matches: IntentMatch[];
  source: 'multi_intent' | 'single_intent' | 'memory_fallback' | 'planner_candidate_fallback' | 'general_chat_fallback';
}

interface ParamExtractionResult {
  params: Record<string, unknown>;
  missingResourceParams: ResourceMissingParams[];
  missingToolsParams: ToolMissingParams[];
  resourceParams: ResourceParamOwner[];
}

// ============================================================
// Constants
// ============================================================

const DEFAULT_CONFIG: PipelineCoreConfig = {
  allowCrossIntent: true,
  maxIntentsPerQuery: 3,
  defaultTimeout: 15000,
  plannerTimeout: 20000
};

// ============================================================
// Pipeline Core Class
// ============================================================

/**
 * PipelineCore - Main orchestrator for the AI intent pipeline
 * 
 * Coordinates all pipeline stages:
 * 1. Pre-processing (query decomposition)
 * 2. Embedding & Intent Matching
 * 3. Planning
 * 4. Confidence Decision
 * 5. Execution
 * 6. Naturalization
 */
export class PipelineCore {
  private config: PipelineCoreConfig;
  
  // Stages
  private preProcessingStage: PreProcessingStage;
  private embeddingStage: EmbeddingStage;
  private intentMatchingStage: IntentMatchingStage;
  private plannerStage: PlannerStage;
  private executionStage: ExecutionStage;
  private naturalizationStage: NaturalizationStage;
  private comparisonStage: ComparisonStage;
  private offerGenerationStage: OfferGenerationStage;
  private fallbackMatchesStage: FallbackMatchesStage;
  private perceptionStage: PerceptionStage;
  private selfCorrectionStage: SelfCorrectionStage;
  
  // Validators & Injectors
  private planValidator: PlanValidator;
  private temporalInjector: TemporalInjector;
  private entityInjector: EntityInjector;

  constructor(config?: Partial<PipelineCoreConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize stages
    this.preProcessingStage = new PreProcessingStage();
    this.embeddingStage = new EmbeddingStage();
    this.intentMatchingStage = new IntentMatchingStage();
    this.plannerStage = new PlannerStage();
    this.executionStage = new ExecutionStage();
    this.naturalizationStage = new NaturalizationStage();
    this.comparisonStage = new ComparisonStage();
    this.offerGenerationStage = new OfferGenerationStage();
    this.fallbackMatchesStage = new FallbackMatchesStage();
    this.perceptionStage = new PerceptionStage();
    this.selfCorrectionStage = new SelfCorrectionStage();
    
    // Initialize validators & injectors
    this.planValidator = new PlanValidator();
    this.temporalInjector = new TemporalInjector();
    this.entityInjector = new EntityInjector();
    
    appLogger.info('[PipelineCore] Initialized', {
      config: this.config
    });
  }

  // ============================================================
  // MAIN PIPELINE ENTRY POINT
  // ============================================================

  /**
   * Execute the main pipeline flow
   *
   * @param input - Pipeline input with user query
   * @param context - Execution context with agent, memory, etc.
   * @returns Pipeline result with natural language response
   * @throws Error if agent context is invalid
   */
  async execute(
    context: PipelineExecutionContext
  ): Promise<PipelineResult> {
    
    const { agent, input, memoryContext, startTotal } = context;

    const { workingMemory, episodicMemory } = memoryContext;

    // C-001: Agent Context Validation
    if (!context) {
      const error = new Error('[PipelineCore] Execution context is null or undefined');
      appLogger.error('Pipeline execution failed: null context', {
        userId: input?.user_id,
        appName: input?.app_name
      });
      throw error;
    }

    // Validate agent exists
    if (!agent) {
      const error = new Error('[PipelineCore] Agent is null or undefined');
      appLogger.error('Pipeline execution failed: null agent', {
        userId: input.user_id,
        appName: input.app_name
      });
      throw error;
    }

    // Validate agent has valid id
    if (!agent.id) {
      const error = new Error('[PipelineCore] Agent ID is missing');
      appLogger.error('Pipeline execution failed: missing agent.id', {
        userId: input.user_id,
        appName: input.app_name,
        agentName: agent.name,
        agentSlug: agent.slug
      });
      throw error;
    }

    // C-009: Variables for memory cleanup in finally block
    let decompositionResult: any = null;
    let branchResult: any = null;
    let finalVectorHints: IntentMatch[] = [];
    let plannerOutput: PlannerOutput | null = null;
    let safePlan: PlannerOutput | null = null;
    let safeParams: Record<string, unknown> = {};
    let executionResult: any = null;
    let perceptionFrame: any = null;
    let selfCorrectionResult: import('../../types/self-correction.types').SelfCorrectionResult | null = null;

    try {
      // ============================================================
      // STAGE 0: GET INTENTS
      // ============================================================
      const intents = intentRegistry.getAll({
        agentId: agent?.id
      });

      // ============================================================
      // STAGE 1: QUERY REWRITE (with memory context) - C-006 Timeout
      // ============================================================
      const enrichedUserQuery = await withTimeout(
        this.rewriteQuery(agent, episodicMemory, input),
        this.config.defaultTimeout,
        'rewriteQuery'
      );

      const orchestrationInput: PipelineInput = {
        ...input,
        text: enrichedUserQuery
      };

      // ============================================================
      // STAGE 2: PRE-PROCESSING (query decomposition) - C-006 Timeout
      // ============================================================
      decompositionResult = await withTimeout(
        this.preProcessingStage.execute(enrichedUserQuery),
        this.config.defaultTimeout,
        'preProcessingStage.execute'
      );

      const { text: preprocessedText, hasMultipleIntents, signals } = decompositionResult;
      signals.skill = skillSignalService.detect(preprocessedText);

      appLogger.debug('[PipelineCore] Query decomposition completed', {
        originalText: input.text,
        preprocessedText,
        hasMultipleIntents,
        signals
      });
      

      // ============================================================
      // STAGE 2.5: PERCEPTION (intent frame detection) — NEW
      // ============================================================
      let perceptionResult: {
        frame: import('../../types/perception.types').PerceptionFrame;
        skipEmbedding?: boolean;
      };
      try {
        perceptionResult = await withTimeout(
          this.perceptionStage.execute({
            text: preprocessedText,
            decomposition: decompositionResult,
            workingMemory,
            episodicMemory
          }),
          this.config.defaultTimeout,
          'perceptionStage.execute'
        );
      } catch (perceptionError) {
        appLogger.warn('[PipelineCore] Perception stage failed, defaulting to direct_task', {
          error: perceptionError instanceof Error ? perceptionError.message : perceptionError
        });
        perceptionResult = {
          frame: {
            type: 'direct_task',
            operations: ['execute'],
            confidence: 0.65,
            reasoning: ['Perception stage failed, defaulting to direct_task']
          },
          skipEmbedding: false
        };
      }

      perceptionFrame = perceptionResult.frame;

      appLogger.debug('[PipelineCore] Perception completed', {
        frameType: perceptionFrame.type,
        confidence: perceptionFrame.confidence,
        operations: perceptionFrame.operations,
        skipEmbedding: perceptionResult.skipEmbedding
      });

      const disambiguationResult = await perceptionDisambiguationService.refine({
        text: preprocessedText,
        skillSignal: signals.skill,
        perceptionFrame,
        signals
      });

      if (disambiguationResult.skillSignal) {
        signals.skill = disambiguationResult.skillSignal;
      }

      if (disambiguationResult.perceptionFrame) {
        perceptionFrame = disambiguationResult.perceptionFrame;
      }

      if (disambiguationResult.usedLlm) {
        appLogger.info('[PipelineCore] Perception disambiguation applied', {
          selectedSkill: disambiguationResult.selectedSkill,
          selectedFrameType: disambiguationResult.selectedFrameType,
          confidence: disambiguationResult.confidence,
          reason: disambiguationResult.reason
        });
      }

      // ============================================================
      // STAGE 2.6: MEMORY TASK REPLAY BRANCH (Option B)
      // ============================================================
      if (perceptionFrame.type === 'memory_task_replay' && perceptionFrame.confidence >= 0.65) {
        appLogger.info('[PipelineCore] Branching to MemoryTaskReplayService', {
          userId: input.user_id,
          appName: input.app_name
        });

        const replayResult = await memoryTaskReplayService.recallAndSelect({
          frame: perceptionFrame,
          input: orchestrationInput
        });

        if (replayResult.decision === 'auto_execute') {
          const replayedPlan = {
            mode: replayResult.task.taskPlan.mode || 'single_step',
            chat: false,
            tasks: replayResult.task.taskPlan.tasks || [],
            reasoning: 'Memory replay: ' + replayResult.reasoning,
            confidence: perceptionFrame.confidence
          };
          const replayParams = this.buildReplayParams(orchestrationInput, replayResult.task.memoryItem);

          const replayedExecution = await withTimeout(
            this.executionStage.execute(replayedPlan, orchestrationInput, replayParams),
            this.config.defaultTimeout,
            'replayExecutionStage.execute'
          );

          const naturalResponse = await withTimeout(
            this.naturalizationStage.execute(replayedExecution.results, orchestrationInput, agent, {
              contextCache: {
                workingMemory: workingMemory || undefined,
                originalQuery: input.text,
                emotion: perceptionFrame.emotion
              }
            }),
            this.config.defaultTimeout,
            'replayNaturalizationStage.execute'
          );

          return {
            intent: replayResult.task.memoryItem.intent || 'memory_replay',
            score: perceptionFrame.confidence,
            apiResult: replayedExecution.results,
            naturalResponse: naturalResponse || replayResult.reasoning,
            metadata: {
              executedTasks: replayedExecution.metrics.executedTasks,
              totalTasks: replayedExecution.metrics.totalTasks,
              executedTasksDetails: replayedExecution.metrics.executedTasksDetails || replayedPlan.tasks.map(function(t) { return { key: t.key, resource: t.resource }; }),
              resolvedParams: replayParams,
              flowStage: 'memory_replay',
              originalPerceptionFrame: perceptionFrame
            }
          };
        }

        if (replayResult.decision === 'clarify_multiple') {
          const candidates = replayResult.candidates.map(function(c, i) {
            return (i + 1) + '. "' + (c.memoryItem.topicLabel || c.memoryItem.summary) + '"';
          }).join('\n');

          return {
            intent: 'memory_replay_clarify',
            score: perceptionFrame.confidence,
            apiResult: replayResult,
            naturalResponse: replayResult.reasoning + '\n\n' + candidates + '\n\nSilakan pilih nomor tugas yang ingin dijalankan ulang.',
            metadata: {
              flowStage: 'memory_replay_clarify',
              originalPerceptionFrame: perceptionFrame
            }
          };
        }

        // no_rerunnable
        return {
          intent: 'memory_replay_none',
          score: perceptionFrame.confidence,
          apiResult: replayResult,
          naturalResponse: replayResult.reasoning,
          metadata: {
            flowStage: 'memory_replay_none',
            originalPerceptionFrame: perceptionFrame
          }
        };
      }

      // ============================================================
      // STAGE 3: EMBEDDING & INTENT MATCHING (skip if perception is confident)
      // ============================================================
      if (perceptionResult.skipEmbedding) {
        appLogger.info('[PipelineCore] Skipping embedding — perception frame is confident', {
          frameType: perceptionFrame.type,
          frameConfidence: perceptionFrame.confidence
        });
        finalVectorHints = [];
        branchResult = { matches: [], source: 'perception_skip' };
      } else {
        branchResult = await withTimeout(
          this.executeMatchingBranch(
            hasMultipleIntents,
            decompositionResult,
            intents,
            agent,
            orchestrationInput,
            workingMemory
          ),
          this.config.defaultTimeout,
          'executeMatchingBranch'
        );

        finalVectorHints = branchResult.matches;

        appLogger.debug('[PipelineCore] Intent matching completed', {
          matchCount: finalVectorHints.length,
          topScore: finalVectorHints[0]?.score ?? 0,
          source: branchResult.source
        });
      }

      // ============================================================
      // STAGE 4: PLANNING - C-006 Timeout
      // ============================================================
      plannerOutput = await withTimeout(
        this.plannerStage.execute(
          finalVectorHints,
          orchestrationInput,
          agent,
          { usePlan: true, timeout: this.config.plannerTimeout, skillSignal: signals.skill, perceptionFrame },
          memoryContext
        ),
        this.config.plannerTimeout,
        'plannerStage.execute'
      );

      safePlan = {
        mode: plannerOutput.mode || 'single_step',
        tasks: plannerOutput.tasks || [],
        chat: plannerOutput.chat === true
      };

      appLogger.debug('[PipelineCore] Planner output', { plan: safePlan });

      // ============================================================
      // STAGE 5: CONFIDENCE DECISION
      // ============================================================
      const decision = confidenceDecisionService.evaluate({
        plan: plannerOutput,
        userText: enrichedUserQuery,
        signals: this.normalizeSignals(signals)
      });

      // C-009 FIX: Log resource breakdown and recommendation for planner feedback
      appLogger.debug('[PipelineCore] Confidence decision', {
        action: decision.action,
        confidence: decision.confidence,
        resourceBreakdown: decision.resourceBreakdown,
        recommendedResource: decision.recommendedResource,
        planTaskCount: safePlan.tasks?.length || 0
      });

      // Log if recommended resource differs from plan for debugging
      if (decision.recommendedResource) {
        const planHasTools = safePlan.tasks?.some(t => t.resource === 'tool')
        const planHasSkills = safePlan.tasks?.some(t => t.resource === 'skill')
        const planHasKnowledge = safePlan.tasks?.some(t => t.resource === 'knowledge')

        const planResourceType = planHasTools ? 'tool' : planHasSkills ? 'skill' : planHasKnowledge ? 'knowledge' : 'none'

        if (decision.recommendedResource !== planResourceType && decision.confidence >= 0.70) {
          appLogger.warn('[PipelineCore] Resource mismatch detected - Planner may need adjustment', {
            userId: input.user_id,
            appName: input.app_name,
            planResourceType,
            recommendedResource: decision.recommendedResource,
            confidence: decision.confidence,
            resourceBreakdown: decision.resourceBreakdown
          })
        }
      }

      // ============================================================
      // STAGE 6: VALIDATE PLAN & DECISION (C-005: Type Validation)
      // ============================================================
      
      // C-005: Validate shouldFallbackToChat is boolean
      const shouldFallbackToChat = this.planValidator.shouldFallbackToChat(safePlan, decision);
      
      if (typeof shouldFallbackToChat !== 'boolean') {
        const error = new Error('[PipelineCore] shouldFallbackToChat returned non-boolean value');
        appLogger.error('Pipeline validation failed: invalid fallback decision', {
          userId: input.user_id,
          appName: input.app_name,
          fallbackType: typeof shouldFallbackToChat,
          fallbackValue: shouldFallbackToChat
        });
        throw error;
      }

      appLogger.debug('[PipelineCore] Normalized signals', {
        actionHints: signals.actionHints,
        formatHints: signals.formatHints,
        temporalHints: signals.temporalHints,
        temporalDetailsCount: signals.temporalDetails?.length || 0,
        entityHintsCount: signals.entityHints?.length || 0,
        asksForFile: signals.asksForFile,
        asksForRealtimeData: signals.asksForRealtimeData,
        comparison: signals.comparison
      });

      const hasStandaloneComparisonTemporalPair = (signals.temporalDetails?.length || 0) >= 2;
      if (
        signals.comparison?.isComparison &&
        (signals.comparison.baseline?.source === 'current_query' || hasStandaloneComparisonTemporalPair)
      ) {
        appLogger.info('[PipelineCore] Standalone comparison candidate detected', {
          userId: input.user_id,
          appName: input.app_name,
          baselineSource: signals.comparison.baseline?.source,
          temporalCount: signals.temporalDetails?.length || 0,
          planTaskCount: safePlan.tasks?.length || 0
        });

        const comparisonResult = await withTimeout(
          this.comparisonStage.tryExecuteStandalone({
            input,
            agent,
            plan: safePlan,
            decompositionResult,
            startTotal,
            score: decision.confidence,
            analyzerSkill: 'trend_analyzer'
          }),
          this.config.plannerTimeout * 2, // Comparison needs 2x timeout (baseline + target + analyzer)
          'comparisonStage.tryExecuteStandalone'
        );

        if (comparisonResult.handled && comparisonResult.result) {
          return comparisonResult.result;
        }

        appLogger.debug('[PipelineCore] Standalone comparison not handled, continuing normal pipeline', {
          userId: input.user_id,
          appName: input.app_name,
          reason: comparisonResult.reason
        });
      }

      if (shouldFallbackToChat) {
        // PerceptionFrame override: high-confidence perception frames bypass
        // the normal confidence fallback — the frame itself is the authority.
        const isPerceptionRouted =
          perceptionFrame &&
          perceptionFrame.confidence >= 0.65 &&
          (perceptionFrame.type === 'memory_question' ||
           perceptionFrame.type === 'memory_task_replay' ||
           perceptionFrame.type === 'automation_request' ||
           perceptionFrame.type === 'small_talk');

        if (!isPerceptionRouted) {
          if (plannerOutput.needsClarification || decision.action === 'clarify') {
            const clarificationQuestion = plannerOutput.clarificationQuestion
              || 'Saya belum yakin permintaan mana yang Anda maksud. Bisa jelaskan sedikit lebih spesifik?';

            appLogger.info('[PipelineCore] Planner clarification requested', {
              userId: input.user_id,
              appName: input.app_name,
              confidence: decision.confidence,
              planTaskCount: safePlan.tasks?.length || 0,
              needsClarification: plannerOutput.needsClarification,
              strategy: plannerOutput.strategy
            });

            return {
              intent: 'clarification',
              score: decision.confidence,
              apiResult: null,
              naturalResponse: clarificationQuestion,
              metadata: {
                totalTime: Date.now() - startTotal,
                // needsClarification: true,
                // clarificationQuestion,
                // activePlan: safePlan
              }
            };
          }

          appLogger.info('[PipelineCore] Fallback to chat decision', {
            userId: input.user_id,
            appName: input.app_name
          });
          return {
            intent: 'general_chat',
            score: decision.confidence,
            apiResult: null,
            naturalResponse: '',
            metadata: {
              totalTime: Date.now() - startTotal,
              // fallbackToChat: 1
            }
          };
        }

        appLogger.info('[PipelineCore] Perception frame overrides shouldFallbackToChat', {
          frameType: perceptionFrame!.type,
          frameConfidence: perceptionFrame!.confidence,
          decisionAction: decision.action
        });
      }

      // ============================================================
      // STAGE 7: PARAM EXTRACTION & INJECTION
      // ============================================================
      // C-009: Assign to declared variable for memory cleanup
      const paramExtraction = await this.extractAndInjectParams(
        enrichedUserQuery,
        safePlan,
        input,
        signals,
        decompositionResult  // NEW: Pass decomposition result
      );
      safeParams = paramExtraction.params;

      // Check for missing params (slot filling trigger)
      const missingParamsResult = await this.checkMissingParams(input, agent, paramExtraction);
      if (missingParamsResult.hasMissing) {
        // Get intent slugs for slot filling context
        const intentSlugsForSlotFilling = finalVectorHints
          .filter(match => match.intent.tools && match.intent.tools.length > 0)
          .map(match => match.intent.slug);
        const fallbackResourceSlugs = safePlan.tasks
          .filter(task => task.resource === 'tool' || task.resource === 'skill')
          .map(task => task.key);
        const slotFillingSlugs = intentSlugsForSlotFilling.length > 0
          ? intentSlugsForSlotFilling
          : fallbackResourceSlugs;

        return {
          intent: 'slot_filling',
          score: 1,
          apiResult: null,
          naturalResponse: emotionToneService.adaptShortMessage(
            missingParamsResult.question || '',
            perceptionFrame?.emotion
          ),
          metadata: {
            totalTime: Date.now() - startTotal,
            // missingParams: missingParamsResult.missingParams,
            // missingResourceParams: missingParamsResult.missingResourceParams,
            // resourceParams: paramExtraction.resourceParams,
            // collectedParams: safeParams,
            // intentSlugs: slotFillingSlugs,
            // // C-009 FIX: Include the actual plan with tasks for execution after slot filling
            // originalPlan: safePlan
          }
        };
      }

      appLogger.info('[PipelineCore] No missing params detected', {
        userId: input.user_id,
        appName: input.app_name,
        missingParamsResult
      });

      // ============================================================
      // STAGE 8: EXECUTION - C-006 Timeout
      // ============================================================
      executionResult = await withTimeout(
        this.executionStage.execute(
          safePlan,
          orchestrationInput,
          safeParams,
          {
            cacheResults: true,
            userId: input.user_id,
            appName: input.app_name
          }
        ),
        this.config.defaultTimeout,
        'executionStage.execute'
      );

      const apiResults = executionResult.results;

      // ============================================================
      // STAGE 8.5: SELF-CORRECTION & RECOVERY
      // ============================================================
      selfCorrectionResult = await withTimeout(
        this.selfCorrectionStage.execute({
          input: orchestrationInput,
          perceptionFrame,
          plan: safePlan,
          params: safeParams,
          executionResult,
          decompositionResult,
          workingMemory,
          recoveryAttempt: 0
        }),
        this.config.defaultTimeout,
        'selfCorrectionStage.execute'
      );

      if (selfCorrectionResult.shouldRecover) {
        selfCorrectionResult = await withTimeout(
          selfCorrectionRecoveryService.recover({
            input: orchestrationInput,
            agent,
            plan: safePlan,
            params: safeParams,
            decompositionResult,
            correction: selfCorrectionResult,
            startTotal
          }),
          this.config.plannerTimeout * 2,
          'selfCorrectionRecoveryService.recover'
        );

        if (selfCorrectionResult.recoveredPipelineResult) {
          return selfCorrectionResult.recoveredPipelineResult;
        }

        if (selfCorrectionResult.recoveredExecutionResult) {
          executionResult = selfCorrectionResult.recoveredExecutionResult;
        }
      }

      const correctedApiResults = executionResult.results;

      if (selfCorrectionResult.action === 'ask_clarification') {
        const clarificationQuestion = selfCorrectionResult.clarificationQuestion
          || 'Saya menemukan bagian yang belum konsisten dengan permintaan Anda. Bisa beri detail yang lebih spesifik?';

        return {
          intent: 'self_correction_clarification',
          score: selfCorrectionResult.confidence,
          apiResult: correctedApiResults,
          naturalResponse: emotionToneService.adaptShortMessage(
            clarificationQuestion,
            perceptionFrame?.emotion
          ),
          metadata: {
            totalTime: Date.now() - startTotal,
            // recovery: selfCorrectionResult.recoveryContext,
            // recoveryTrace: selfCorrectionResult.trace,
            // activePlan: safePlan,
            // resolvedParams: safeParams,
            // executedTasks: executionResult.metrics.executedTasks,
            // totalTasks: executionResult.metrics.totalTasks,
            // executedTasksDetails: executionResult.metrics.executedTasksDetails || []
          }
        };
      }

      //  appLogger.info('[PipelineCore] Execution result', {
      //   userId: input.user_id,
      //   appName: input.app_name,
      //   apiResults
      // });

      const offerResult = await this.offerGenerationStage.execute({
        input,
        plan: safePlan,
        params: safeParams,
        results: correctedApiResults,
        executedTasks: executionResult.metrics.executedTasksDetails || [],
        workingMemory
      });

      const selectedOffer = offerResult.selectedOffer;

      // ============================================================
      // STAGE 9: NATURALIZATION - C-006 Timeout
      // ============================================================
      const naturalResponse = await withTimeout(
        this.naturalizationStage.execute(
          correctedApiResults,
          { ...input, text: enrichedUserQuery },
          agent,
          {
            contextCache: {
              workingMemory: workingMemory || undefined,
              entities: safeParams,
              originalQuery: input.text,
              allowedOffer: selectedOffer
                ? {
                    label: selectedOffer.label,
                    reason: selectedOffer.reason,
                    suggestedText: selectedOffer.suggestedText || selectedOffer.label
                  }
                : undefined,
              emotion: perceptionFrame?.emotion,
              recoveryContext: selfCorrectionResult?.recoveryContext
            }
          }
        ),
        this.config.defaultTimeout,
        'naturalizationStage.execute'
      );

      const guardedNaturalResponse = containsWriteSuccessClaim(naturalResponse) && !hasWriteProof(executionResult)
        ? emotionToneService.adaptShortMessage(
            'Saya belum punya bukti bahwa aksi tersebut benar-benar berhasil dijalankan. Saya bisa lanjutkan setelah konfirmasi atau data eksekusinya lengkap.',
            perceptionFrame?.emotion
          )
        : naturalResponse;
      const blockedUnsafeSuccessClaim = guardedNaturalResponse !== naturalResponse;

      // ============================================================
      // BUILD RESULT
      // ============================================================
      const intentLabel = finalVectorHints[0]?.intent.slug || 'unknown';
      const intentScore = finalVectorHints[0]?.score ?? 0;

      // Log if intent is unknown for debugging
      if (intentLabel === 'unknown' || intentScore === 0) {
        appLogger.warn('[PipelineCore] Unknown or zero-confidence intent', {
          userId: input.user_id,
          appName: input.app_name,
          query: input.text,
          matchCount: finalVectorHints.length,
          topScore: intentScore,
          source: branchResult.source
        });
      }

      return {
        intent: intentLabel,
        score: intentScore,
        apiResult: correctedApiResults,
        naturalResponse: guardedNaturalResponse,
        metadata: {
          totalTime: Date.now() - startTotal,
          // executedTasks: executionResult.metrics.executedTasks,
          // totalTasks: executionResult.metrics.totalTasks,
          // executedTasksDetails: executionResult.metrics.executedTasksDetails || [],
          // activePlan: safePlan,
          // resolvedParams: safeParams,
          // activeOffer: selectedOffer,
          // recovery: selfCorrectionResult?.recoveryContext,
          // recoveryTrace: selfCorrectionResult?.trace || [],
          // blockedUnsafeSuccessClaim
        }
      };

    } catch (error) {
      appLogger.error('[PipelineCore] Execution failed', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        userId: input.user_id,
        appName: input.app_name
      });

      throw error;

    } finally {
      // ============================================================
      // C-009: MEMORY CLEANUP
      // ============================================================
      // Cleanup large objects to prevent memory leaks
      decompositionResult = null;
      branchResult = null;
      finalVectorHints = [];
      plannerOutput = null;
      safePlan = null;
      safeParams = {};
      executionResult = null;
      selfCorrectionResult = null;

      // Force garbage collection if available
      // Note: This requires Node.js to be run with --expose-gc flag
      if (global.gc) {
        global.gc();
      }

      appLogger.debug('[PipelineCore] Memory cleanup completed');
    }
  }

  // ============================================================
  // STAGE 1: Query Rewrite
  // ============================================================

  private async rewriteQuery(
    agent: Agent,
    episodicMemory: EpisodicMemory | null,
    input: PipelineInput
  ): Promise<string> {
    const rewrittenQuery = await queryRewriteService.rewriteWithMemory(
      agent,
      episodicMemory?.summary || null,
      input
    );

    appLogger.debug('[PipelineCore] Query rewritten', {
      originalLength: input.text.length,
      enrichedQuery: rewrittenQuery
    });

    return rewrittenQuery;
  }

  // ============================================================
  // STAGE 3: Matching Branch Logic
  // ============================================================

  private async executeMatchingBranch(
    hasMultipleIntents: boolean,
    decompositionResult: {
      text: string;
      hasMultipleIntents: boolean;
      subQueries: string[];
      connectors: string[];
      signals: UserMessageSignals;
    },
    intents: Intent[],
    agent: Agent,
    input: PipelineInput,
    workingMemory: WorkingMemoryData | null
  ): Promise<PipelineBranchResult> {
    const { text: preprocessedText, subQueries, signals } = decompositionResult;

    if (this.isTemporalOnlyFollowUp(preprocessedText, signals) && workingMemory?.activeIntent) {
      try {
        const memoryMatches = await vectorService.getIntentBySlug(
          intents,
          workingMemory.activeIntent
        );

        if (memoryMatches && memoryMatches.length > 0) {
          appLogger.info('[PipelineCore] Temporal-only follow-up routed to active intent', {
            userId: input.user_id,
            appName: input.app_name,
            activeIntent: workingMemory.activeIntent,
            activeTool: workingMemory.activeTool,
            temporalDetails: signals.temporalDetails || []
          });

          return {
            matches: memoryMatches,
            source: 'memory_fallback'
          };
        }
      } catch (memoryError) {
        appLogger.warn('[PipelineCore] Temporal-only active intent fallback failed', {
          userId: input.user_id,
          appName: input.app_name,
          activeIntent: workingMemory.activeIntent,
          error: memoryError instanceof Error ? memoryError.message : memoryError
        });
      }
    }

    // BRANCH 1: Multi-intent mode
    if (hasMultipleIntents && this.config.allowCrossIntent && subQueries.length > 0) {
      appLogger.info('[PipelineCore] Multi-intent mode: Processing sub-queries', {
        subQueriesCount: subQueries.length
      });

      const allMatches = await this.processMultiIntentQueries(
        subQueries,
        intents,
        agent,
        workingMemory
      );

      const boostedMatches = this.applySignalBoost(allMatches, signals);

      return {
        matches: boostedMatches,
        source: 'multi_intent'
      };
    }

    // BRANCH 2: Single intent mode
    appLogger.debug('[PipelineCore] Single-intent mode: Using vector matching');

    const queryForMatching = preprocessedText !== input.text && preprocessedText.length > 0
      ? preprocessedText
      : input.text;

    try {
      // Generate embedding
      const queryEmbedding = await this.embeddingStage.execute(
        queryForMatching,
        { agentId: agent.id }
      );

      // Vector matching
      const matches = await this.intentMatchingStage.execute(
        queryEmbedding,
        intents,
        agent,
        { signals },
        workingMemory?.activeIntent
      );

      // C-002: Error Recovery - Memory fallback with proper error handling
      if (!matches || matches.length === 0) {
        if (!this.hasOperationalSignalForFallback(signals)) {
          appLogger.info('[PipelineCore] No matches and no operational signal, using general chat fallback', {
            userId: input.user_id,
            appName: input.app_name,
            queryLength: queryForMatching.length
          });

          return {
            matches: [this.buildGeneralChatMatch(input.text, 'non_operational_no_matches')],
            source: 'general_chat_fallback'
          };
        }

        appLogger.warn('[PipelineCore] No intent matches found, building planner fallback candidates', {
          userId: input.user_id,
          appName: input.app_name,
          hasWorkingMemory: !!workingMemory,
          intentCount: intents.length
        });

        const fallbackMatches = this.fallbackMatchesStage.execute({
          intents,
          agent,
          userText: queryForMatching,
          signals
        });

        if (fallbackMatches.length > 0) {
          return {
            matches: fallbackMatches,
            source: 'planner_candidate_fallback'
          };
        }

        if (workingMemory?.activeIntent) {
          try {
            const memoryMatches = await vectorService.getIntentBySlug(
              intents,
              workingMemory.activeIntent
            );
            if (memoryMatches && memoryMatches.length > 0) {
              appLogger.info('[PipelineCore] Memory fallback successful', {
                matchCount: memoryMatches.length
              });
              return {
                matches: memoryMatches,
                source: 'memory_fallback'
              };
            }
          } catch (memoryError) {
            appLogger.error('[PipelineCore] Memory fallback failed', {
              error: memoryError instanceof Error ? memoryError.message : 'Unknown error'
            });
            // Continue to throw error for no matches
          }
        }

        // No matches and no fallback - FALLBACK TO GENERAL CHAT!
        appLogger.info('[PipelineCore] No intent matches, falling back to general chat', {
          userId: input.user_id,
          appName: input.app_name,
          queryLength: queryForMatching.length
        });

        return {
          matches: [this.buildGeneralChatMatch(input.text, 'no_intent_matches')],
          source: 'general_chat_fallback'
        };
      }

      // Apply limit if cross-intent disabled
      let finalMatches = matches;
      if (!this.config.allowCrossIntent) {
        finalMatches = matches.slice(0, 3);
      }

      return {
        matches: finalMatches,
        source: 'single_intent'
      };

    } catch (error) {
      // Re-throw with context
      if (error instanceof Error && error.message.includes('No intent matches')) {
        throw error;
      }
      appLogger.error('[PipelineCore] Vector matching failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: input.user_id,
        appName: input.app_name
      });
      throw error;
    }
  }

  // ============================================================
  // Multi-Intent Processing (C-004: Concurrent Processing)
  // ============================================================

  // C-004: Concurrency limit for batch processing
  private readonly MAX_CONCURRENT_QUERIES = 5;

  private async processMultiIntentQueries(
    subQueries: string[],
    intents: Intent[],
    agent: Agent,
    workingMemory: WorkingMemoryData | null
  ): Promise<IntentMatch[]> {
    const allMatches: IntentMatch[] = [];
    const processedIntents = new Set<string>();
    const startTime = Date.now();

    // C-004: Process queries concurrently with limit
    const batchSize = this.MAX_CONCURRENT_QUERIES;
    
    for (let i = 0; i < subQueries.length; i += batchSize) {
      const batch = subQueries.slice(i, i + batchSize);
      const batchStartTime = Date.now();
      
      appLogger.debug('[PipelineCore] Processing batch of sub-queries', {
        batchIndex: Math.floor(i / batchSize) + 1,
        batchSize: batch.length,
        totalBatches: Math.ceil(subQueries.length / batchSize)
      });

      // Process batch concurrently with Promise.allSettled
      const batchPromises = batch.map(async (query) => {
        try {
          const embedding = await this.embeddingStage.execute(
            query,
            { agentId: agent.id }
          );

          const matches = await this.intentMatchingStage.execute(
            embedding,
            intents,
            agent,
            { topK: 3 },
            workingMemory?.activeIntent
          );

          return { query, matches, success: true };
        } catch (error) {
          appLogger.warn('[PipelineCore] Sub-query processing failed', {
            query,
            error: error instanceof Error ? error.message : error
          });
          return { query, matches: [] as IntentMatch[], success: false, error };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Process results
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value.success) {
          const { matches } = result.value;
          for (const match of matches) {
            const intentId = match.intent.id;
            if (!processedIntents.has(intentId)) {
              processedIntents.add(intentId);
              allMatches.push(match);
            }
          }

          // Stop if we have enough intents
          if (allMatches.length >= this.config.maxIntentsPerQuery) {
            break;
          }
        }
      }

      // Log batch performance
      const batchDuration = Date.now() - batchStartTime;
      appLogger.debug('[PipelineCore] Batch completed', {
        batchIndex: Math.floor(i / batchSize) + 1,
        durationMs: batchDuration,
        matchesFound: allMatches.length
      });

      // Stop if we have enough intents
      if (allMatches.length >= this.config.maxIntentsPerQuery) {
        break;
      }
    }

    // Sort by score
    allMatches.sort((a, b) => b.score - a.score);

    const totalDuration = Date.now() - startTime;
    appLogger.info('[PipelineCore] Multi-intent processing completed', {
      subQueriesCount: subQueries.length,
      totalMatches: allMatches.length,
      returnedMatches: Math.min(allMatches.length, this.config.maxIntentsPerQuery),
      durationMs: totalDuration,
      avgTimePerQuery: totalDuration / subQueries.length
    });

    return allMatches.slice(0, this.config.maxIntentsPerQuery);
  }

  // ============================================================
  // Signal Boost (C-007: Validation, C-010: Factor Capping)
  // ============================================================

  // C-010: Boost factor constants
  private readonly BOOST_MULTIPLIER = 1.15;
  private readonly MAX_BOOST_FACTOR = 1.5;
  private readonly MAX_SCORE = 1.0;
  private readonly MIN_SCORE = 0.0;

  private applySignalBoost(
    matches: IntentMatch[],
    signals: UserMessageSignals
  ): IntentMatch[] {
    // C-007: Validate input matches
    if (!matches || !Array.isArray(matches)) {
      appLogger.warn('[PipelineCore] applySignalBoost: invalid matches input');
      return [];
    }

    const actionHints = signals.actionHints || [];
    const formatHints = signals.formatHints || [];

    return matches.map(match => {
      // C-007: Validate match structure
      if (!match || !match.intent || typeof match.intent.slug !== 'string') {
        appLogger.warn('[PipelineCore] Signal boost: skipping invalid match');
        return match;
      }

      let boostFactor = 1.0;
      const appliedBoosts: string[] = [];
      let cumulativeBoost = 0;

      const intentSlug = match.intent.slug.toLowerCase();

      // Format-based boosts
      if (formatHints.length > 0 && (formatHints.includes('xlsx') || formatHints.includes('csv'))) {
        if (intentSlug.includes('xls') || intentSlug.includes('excel') || intentSlug.includes('export')) {
          cumulativeBoost += (this.BOOST_MULTIPLIER - 1);
          appliedBoosts.push(`format:${formatHints.join(',')}`);
        }
      }

      // File-related boosts
      if (signals.asksForFile) {
        if (intentSlug.includes('xls') || intentSlug.includes('export') || intentSlug.includes('download')) {
          cumulativeBoost += (this.BOOST_MULTIPLIER - 1);
          appliedBoosts.push('asksForFile');
        }
      }

      // Action-based boosts
      if (actionHints.includes('buat') || actionHints.includes('generate')) {
        if (intentSlug.includes('xls') || intentSlug.includes('generator') || intentSlug.includes('export')) {
          cumulativeBoost += (this.BOOST_MULTIPLIER - 1);
          appliedBoosts.push('action:generate');
        }
      }

      // C-010: Cap cumulative boost factor
      const cappedBoostFactor = Math.min(1 + cumulativeBoost, this.MAX_BOOST_FACTOR);
      boostFactor = cappedBoostFactor;

      // Calculate boosted score with clamping
      const boostedScore = match.score * boostFactor;
      
      // C-010: Clamp score to valid range [MIN_SCORE, MAX_SCORE]
      const finalScore = Math.max(this.MIN_SCORE, Math.min(this.MAX_SCORE, boostedScore));

      if (appliedBoosts.length > 0) {
        appLogger.debug('[PipelineCore] Signal boost applied', {
          intentSlug,
          originalScore: match.score,
          boostFactor: cappedBoostFactor,
          cumulativeBoost,
          finalScore,
          appliedBoosts
        });
      }

      return {
        ...match,
        score: finalScore
      };
    });
  }

  // ============================================================
  // Param Extraction & Injection
  // ============================================================

  private async extractAndInjectParams(
    enrichedUserQuery: string,
    safePlan: PlannerOutput,
    input: PipelineInput,
    signals: UserMessageSignals,
    decompositionResult: DecomposedQuery  // UPDATED: Use DecomposedQuery type
  ): Promise<ParamExtractionResult> {
    let safeParams: Record<string, unknown> = {};
    let missingResourceParams: ResourceMissingParams[] = [];
    let missingToolsParams: ToolMissingParams[] = [];
    let resourceParams: ResourceParamOwner[] = [];

    // C-003: Type-Safe Param Injection - Validate input structure
    if (!input) {
      appLogger.error('[PipelineCore] Input is null/undefined in extractAndInjectParams');
      return { params: safeParams, missingResourceParams, missingToolsParams, resourceParams };
    }

    // Inject temporal details with type validation
    // When there's a comparison with 2+ temporal details, skip injection.
    // The comparison stage handles baseline/target execution separately,
    // and injecting both into the same param would cause the last value to win.
    const temporalDetails = signals.temporalDetails || [];
    const isComparisonWithMultipleTemporals =
      signals.comparison?.isComparison && temporalDetails.length >= 2;

    if (temporalDetails.length > 0 && !isComparisonWithMultipleTemporals) {
      try {
        // Validate and initialize attributes
        if (!input.attributes) {
          input.attributes = {};
        }
        if (!input.attributes.params) {
          input.attributes.params = {} as Record<string, unknown>;
        }

        // Type-safe cast with validation
        const paramsObj = input.attributes.params as Record<string, unknown>;
        
        // Validate temporal details before injection
        const validTemporalDetails = temporalDetails.filter(t => t && t.type && t.normalizedValue);
        if (validTemporalDetails.length > 0) {
          this.temporalInjector.inject(paramsObj, validTemporalDetails as TemporalDetailWithDates[]);
        }
      } catch (injectionError) {
        appLogger.error('[PipelineCore] Temporal injection failed', {
          error: injectionError instanceof Error ? injectionError.message : 'Unknown error',
          temporalDetailsCount: temporalDetails.length
        });
        // Continue without temporal injection
      }
    }

    // Inject entity hints with validation
    try {
      const entityHints = (signals as any).entityHints || [];
      if (entityHints.length > 0 && Array.isArray(entityHints)) {
        this.entityInjector.inject(input, entityHints);
      }
    } catch (entityError) {
      appLogger.error('[PipelineCore] Entity injection failed', {
        error: entityError instanceof Error ? entityError.message : 'Unknown error'
      });
      // Continue without entity injection
    }

    // ============================================================
    // PARAM RESOLUTION - unified tool/skill approach
    // ============================================================
    const paramTasks = safePlan.tasks.filter(t => t.resource === 'tool' || t.resource === 'skill');
    if (paramTasks.length > 0) {
      try {
        const { paramResolutionService } = await import('../param-resolution.service');

        appLogger.debug('[PipelineCore] Resolving params', {
          resourceTasks: paramTasks.map(t => ({ resource: t.resource, key: t.key })),
          hasDecomposition: !!decompositionResult
        });

        // Resolve params from all sources
        const resolutionResult = await paramResolutionService.resolve(
          input,
          safePlan,
          decompositionResult
        );

        // Use resolved params
        safeParams = resolutionResult.availableParams;
        missingResourceParams = resolutionResult.missingResourceParams || [];
        missingToolsParams = resolutionResult.missingToolsParams || [];
        resourceParams = resolutionResult.resourceParams || [];

        appLogger.info('[PipelineCore] Param resolution completed', {
          totalParams: Object.keys(safeParams).length,
          missingResourceCount: missingResourceParams.length,
          missingToolCount: missingToolsParams.length,
          sources: resolutionResult.sources
        });

      } catch (resolutionError) {
        appLogger.error('[PipelineCore] Param resolution failed', {
          error: resolutionError instanceof Error ? resolutionError.message : 'Unknown error',
          resourceTasks: paramTasks.map(t => ({ resource: t.resource, key: t.key }))
        });
        // Continue with existing safeParams on error
      }
    }

    return { params: safeParams, missingResourceParams, missingToolsParams, resourceParams };
  }

  // ============================================================
  // Missing Params Check
  // ============================================================

  private async checkMissingParams(
    input: PipelineInput,
    agent: Agent,
    paramExtraction: ParamExtractionResult
  ): Promise<{
    hasMissing: boolean;
    missingParams?: ToolMissingParams[];
    missingResourceParams?: ResourceMissingParams[];
    question?: string;
  }> {
    const missingResourceParams = paramExtraction.missingResourceParams || [];
    const missingToolsParams = paramExtraction.missingToolsParams || [];

    // Filter: only flag truly required params (no defaultValue available)
    const trulyMissing = missingResourceParams
      .map(item => {
        const requiredMissing = (item.params || []).filter(p => {
          // If param has a defaultValue, it's auto-resolvable — don't block
          if (p.defaultValue !== undefined && p.defaultValue !== null && p.defaultValue !== '') return false;
          // If param is not required, skip it
          if (p.isRequired === false) return false;
          return true;
        });

        if (requiredMissing.length === 0) return null;

        return {
          ...item,
          missing: requiredMissing.map(p => p.name),
          params: requiredMissing
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    // Also check tool missing params (these were previously ignored!)
    const trulyMissingTools = missingToolsParams
      .filter(toolMissing => {
        if (!toolMissing.tool?.parameters) return true; // No param detail → assume truly missing
        const toolParams = toolMissing.tool.parameters || [];
        return toolMissing.missing.some(paramName => {
          const param = toolParams.find(p => p.name === paramName);
          if (!param) return true; // Param not found in definition → assume required
          if (param.defaultValue !== undefined && param.defaultValue !== null && param.defaultValue !== '') return false;
          if (param.isRequired === false) return false;
          return true;
        });
      });

    if (trulyMissing.length === 0 && trulyMissingTools.length === 0) {
      return { hasMissing: false };
    }

      const automationMissing = trulyMissing.find(item =>
        item.resource === 'skill' && item.key === 'automation_manager'
      );
      if (automationMissing) {
        const { automationClarificationService } = await import('../automation/automation-clarification.service');
        return {
          hasMissing: true,
          missingParams: trulyMissingTools.length > 0 ? trulyMissingTools : missingToolsParams,
          missingResourceParams: trulyMissing,
          question: automationClarificationService.buildQuestion(
            [...new Set(trulyMissing.flatMap(item => item.missing))],
            paramExtraction.params
          )
        };
      }

      const { clarificationService } = await import('../clarification.service');

      const question = trulyMissing.length > 0
        ? await clarificationService.askForMultipleParametersFromResources(
            agent,
            input,
            trulyMissing,
            'Indonesia'
          )
        : `Mohon lengkapi parameter berikut: ${trulyMissingTools.flatMap(t => t.missing).join(', ')}`;

    return {
      hasMissing: true,
      missingParams: trulyMissingTools.length > 0 ? trulyMissingTools : missingToolsParams,
      missingResourceParams: trulyMissing,
      question
    };
  }

  // ============================================================
  // Utilities
  // ============================================================

  private buildReplayParams(
    input: PipelineInput,
    memoryItem: {
      flowTrace?: Array<{ params?: Record<string, unknown> | null }> | null
    }
  ): Record<string, unknown> {
    const params: Record<string, unknown> = {
      ...((input.attributes?.params || {}) as Record<string, unknown>)
    };

    for (const trace of memoryItem.flowTrace || []) {
      if (!trace?.params || typeof trace.params !== 'object' || Array.isArray(trace.params)) {
        continue;
      }
      Object.assign(params, trace.params);
    }

    return params;
  }

  private normalizeSignals(signals: UserMessageSignals): {
    actionHints: string[];
    formatHints: string[];
    temporalHints: string[];
    temporalDetails: any[];
    entityHints: string[];
    asksForFile: boolean;
    asksForRealtimeData: boolean;
    isQuestion: boolean;
    language: 'id' | 'en' | 'unknown';
  } {
    return {
      actionHints: signals.actionHints || [],
      formatHints: signals.formatHints || [],
      temporalHints: signals.temporalHints || [],
      temporalDetails: signals.temporalDetails || [],
      entityHints: (signals as any).entityHints || [],
      asksForFile: signals.asksForFile,
      asksForRealtimeData: signals.asksForRealtimeData,
      isQuestion: (signals as any).isQuestion || false,
      language: signals.language || 'id'
    };
  }

  private hasOperationalSignalForFallback(signals: UserMessageSignals): boolean {
    return Boolean(
      signals.actionHints?.length ||
      signals.formatHints?.length ||
      signals.temporalHints?.length ||
      signals.temporalDetails?.length ||
      signals.entityHints?.length ||
      signals.asksForFile ||
      signals.asksForRealtimeData ||
      signals.comparison?.isComparison ||
      (signals as any).skill?.hasStrongSignal
    );
  }

  private buildGeneralChatMatch(originalQuery: string, fallbackReason: string): IntentMatch {
    return {
      intent: {
        slug: 'general_chat',
        name: 'General Chat',
        description: 'General conversation fallback',
        examples: [],
        handlers: [],
        tools: [],
        enabled: true,
        isFallback: true
      } as any,
      score: 1.0,
      metadata: {
        fallbackReason,
        originalQuery
      }
    };
  }

  private isTemporalOnlyFollowUp(text: string, signals: UserMessageSignals): boolean {
    if (!signals.temporalDetails?.length) return false;

    const normalized = String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return false;

    const residue = buildTemporalFollowUpResidue(normalized);

    return residue.length === 0;
  }
}
