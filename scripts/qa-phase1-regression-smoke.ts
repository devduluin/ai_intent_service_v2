import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config';
import { paramExtractorService } from '../src/services/paramExtractor.service';
import { conversationStateService } from '../src/services/conversationState.service';
import type { ToolParam } from '../src/types';

type TestCase = {
  name: string;
  run: () => Promise<void> | void;
};

const repoRoot = process.cwd();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function readSource(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

const statusParam: ToolParam = {
  name: 'status',
  type: 'select',
  description: 'Vehicle assignment status',
  isRequired: true,
  config: {
    options: [
      { label: 'Aktif', value: 'active' },
      { label: 'Cuti/Izin', value: 'leave' },
      { label: 'Keluar', value: 'exit' }
    ]
  }
};

const tests: TestCase[] = [
  {
    name: 'status answer "aktif" normalizes to active',
    run: async () => {
      const result = await paramExtractorService.extractAll('aktif', [statusParam]);
      assert(result.params.status === 'active', `Expected active, got ${String(result.params.status)}`);
      assert(result.confidences.status >= 0.9, `Expected high confidence, got ${result.confidences.status}`);
    }
  },
  {
    name: 'status answer "keluar" normalizes to exit',
    run: async () => {
      const result = await paramExtractorService.extractAll('keluar', [statusParam]);
      assert(result.params.status === 'exit', `Expected exit, got ${String(result.params.status)}`);
      assert(result.confidences.status >= 0.9, `Expected high confidence, got ${result.confidences.status}`);
    }
  },
  {
    name: 'slot filling maxRetry default comes from config',
    run: () => {
      assert(config.slotFilling.maxRetry === 2, `Expected maxRetry=2, got ${config.slotFilling.maxRetry}`);
    }
  },
  {
    name: 'conversation state persists non-empty intentSlugs and retry count',
    run: async () => {
      const userId = `qa_phase1_${Date.now()}`;
      const appName = 'hris';

      await conversationStateService.set(userId, appName, {
        intentSlugs: ['vehicles'],
        missingToolsParams: [
          { toolSlug: 'get_vehicle_assignment', toolName: 'Vehicle Assignment', missing: ['status'] }
        ],
        collectedParams: { company_id: 'company-1', date: '2026-05-30' },
        maxRetry: config.slotFilling.maxRetry,
        lastUserMessage: 'coba cek kendaraan hari ini',
        originalPlan: {
          mode: 'single_step',
          chat: false,
          tasks: [
            {
              id: '1',
              resource: 'tool',
              key: 'get_vehicle_assignment',
              depends_on: [],
              confidence: 0.95
            }
          ]
        }
      });

      const state = conversationStateService.get(userId, appName);
      assert(state?.intentSlugs?.[0] === 'vehicles', 'Expected pending state intentSlugs to be vehicles');
      assert(state?.missingToolsParams?.[0]?.missing.includes('status'), 'Expected missing status to be persisted');

      const retryCount = await conversationStateService.incrementRetry(userId, appName);
      assert(retryCount === 1, `Expected retry count 1, got ${retryCount}`);

      await conversationStateService.clear(userId, appName);
      assert(conversationStateService.get(userId, appName) === null, 'Expected state to be cleared');
    }
  },
  {
    name: 'PipelineResult metadata uses PipelineMetadata contract',
    run: () => {
      const source = readSource('src/types/index.ts');
      assert(source.includes('export interface PipelineMetadata'), 'PipelineMetadata interface not found');
      assert(source.includes('metadata: PipelineMetadata'), 'PipelineResult.metadata is not PipelineMetadata');
      assert(!source.includes('metadata: Record<string, number>'), 'Legacy metadata Record<string, number> still present');
    }
  },
  {
    name: 'pending slot filling branch re-enters main pipeline after retry failure',
    run: () => {
      const source = readSource('src/services/pipeline.service.ts');
      assert(
        !source.includes("Slot filling retry exceeded, falling back to chat"),
        'Retry exceeded still logs fallback to chat'
      );
      assert(source.includes('if (result.retryExceeded)'), 'Expected explicit retryExceeded branch');
      assert(
        source.includes('return await this.run(input);'),
        'Expected slot filling failure to rerun the full pipeline'
      );
    }
  },
  {
    name: 'unresolved slot filling answer increments retry even for short answers',
    run: () => {
      const source = readSource('src/services/cores/stages/slot-filling.stage.ts');
      assert(
        source.includes('const shouldCountAsFailedAttempt = !hasAnyHighConfidenceParam'),
        'Expected unresolved answers to be counted when no high-confidence param is found'
      );
      assert(
        source.includes('if (shouldCountAsFailedAttempt)'),
        'Expected retry increment branch for unresolved answers'
      );
      assert(
        source.includes('Missing params unresolved after user answer'),
        'Expected diagnostic log for unresolved slot filling answers'
      );
    }
  },
  {
    name: 'executeMainPipeline no longer writes working memory',
    run: () => {
      const source = readSource('src/services/pipeline.service.ts');
      const start = source.indexOf('private async executeMainPipeline');
      const end = source.indexOf('private async executeContinuation');
      assert(start > -1 && end > start, 'Could not locate executeMainPipeline body');
      const body = source.slice(start, end);
      assert(!body.includes('workingMemoryUpdater.update'), 'executeMainPipeline still updates working memory');
    }
  },
  {
    name: 'continuation fallback and error share fallback path',
    run: () => {
      const source = readSource('src/services/pipeline.service.ts');
      assert(source.includes("result.intent === 'continuation_fallback' || result.intent === 'continuation_error'"), 'Continuation fallback/error guard not found');
      assert(source.includes('return null;'), 'Continuation helper should return null so main pipeline can continue');
    }
  },
  {
    name: 'optional semantic params are resolved and stale continuation search can clear',
    run: () => {
      const resolver = readSource('src/services/param-resolution.service.ts');
      const continuation = readSource('src/services/cores/stages/continuation.stage.ts');

      assert(resolver.includes("'llm_optional'"), 'Expected llm_optional param source');
      assert(resolver.includes('shouldExtractOptionalSemanticParam'), 'Expected optional semantic candidate detection');
      assert(resolver.includes('normalizeSemanticStringValue'), 'Expected semantic value cleanup');
      assert(resolver.includes("'cari', 'apakah', 'ada'"), 'Expected search question terms to be removed from semantic residue');
      assert(resolver.includes('clearStaleOptionalSemanticParams'), 'Expected stale optional semantic clear option');
      assert(continuation.includes('clearStaleOptionalSemanticParams: true'), 'Continuation must clear stale optional semantic params');
    }
  },
  {
    name: 'search follow-up refines active tool instead of falling back to chat',
    run: () => {
      const resolver = readSource('src/services/cores/resolvers/continuation.resolver.ts');
      const chat = readSource('src/services/generalChat.service.ts');

      assert(resolver.includes('\\bcari\\b'), 'Expected cari pattern for refine continuation');
      assert(resolver.includes('Active tool refine continuation'), 'Expected active tool refine branch');
      assert(resolver.includes("targetTool: memory.activeTool"), 'Expected refine continuation to target active tool');
      assert(chat.includes('hasActiveOperationalTool'), 'Expected general chat operational guard to use active tool context');
      assert(chat.includes("'apakah ada'"), 'Expected general chat guard to detect existence questions');
    }
  },
  {
    name: 'temporal-only follow-up refines active tool instead of falling back to chat',
    run: () => {
      const resolver = readSource('src/services/cores/resolvers/continuation.resolver.ts');
      const decomposition = readSource('src/services/query-decomposition.service.ts');

      assert(resolver.includes('isTemporalRefineFollowUp'), 'Expected temporal follow-up classifier');
      assert(resolver.includes('Temporal refine continuation'), 'Expected temporal refine continuation branch');
      assert(resolver.includes("reasoning: `Temporal refine -> ${memory.activeTool}`"), 'Expected temporal refine to target active tool');
      assert(resolver.includes('buildTemporalFollowUpResidue'), 'Expected domain-agnostic temporal follow-up residue classifier');
      assert(!resolver.includes('hasExplicitNewTopic'), 'Temporal follow-up guard must not use hardcoded topic keywords');
      assert(decomposition.includes('resolveDayOfMonth'), 'Expected numeric day-of-month temporal resolver');
      assert(decomposition.includes('(?:tanggal|tgl)'), 'Expected tanggal/tgl temporal pattern');
    }
  },
  {
    name: 'planner clarification returns clarification result instead of general chat',
    run: () => {
      const source = readSource('src/services/cores/pipeline-core.ts');
      const planner = readSource('src/services/cores/stages/planner.stage.ts');
      const greetingDetector = readSource('src/utils/greeting-detector.util.ts');
      const greetingSkill = readSource('src/skills/greeting.skill.ts');

      assert(source.includes('Planner clarification requested'), 'Expected planner clarification branch log');
      assert(source.includes("intent: 'clarification'"), 'Expected clarification intent result');
      assert(source.includes('needsClarification: true'), 'Expected clarification metadata');
      assert(source.indexOf('Planner clarification requested') < source.indexOf('Fallback to chat decision'), 'Expected clarification before chat fallback');
      assert(planner.includes('plan.chat === true && (!plan.tasks || plan.tasks.length === 0)'), 'Expected planner chat-only result to bypass confidence clarification');
      assert(greetingDetector.includes('(?:(?:ok|oke|okay|baik)'), 'Expected thanks with ok/oke prefix to be treated as greeting');
      assert(greetingSkill.includes('(?:(?:ok|oke|okay|baik|alright)'), 'Expected greeting skill to handle ok/oke thanks');
    }
  },
  {
    name: 'planner receives recent assistant context for offer-aware clarification',
    run: () => {
      const source = readSource('src/services/toolPlanner.service.ts');

      assert(source.includes('recentAssistantMessages'), 'Expected planner to collect assistant history');
      assert(source.includes("filterRole: 'assistant'"), 'Expected assistant history filter');
      assert(source.includes('recent_assistant_msgs='), 'Expected assistant context in planner prompt');
    }
  },
  {
    name: 'temporal-only query bypasses vector noise via active intent fallback',
    run: () => {
      const source = readSource('src/services/cores/pipeline-core.ts');

      assert(source.includes('isTemporalOnlyFollowUp'), 'Expected PipelineCore temporal-only fallback guard');
      assert(source.includes('buildTemporalFollowUpResidue'), 'Expected PipelineCore to use domain-agnostic temporal residue classifier');
      assert(!source.includes('hasExplicitTopic'), 'Temporal-only fallback must not use hardcoded topic keywords');
      assert(source.includes('Temporal-only follow-up routed to active intent'), 'Expected temporal-only active intent diagnostic log');
      assert(source.includes('workingMemory?.activeIntent'), 'Expected fallback to require active intent');
      assert(source.includes("source: 'memory_fallback'"), 'Expected temporal-only query to use memory_fallback source');
    }
  },
  {
    name: 'vector miss expands agent intents for planner before general chat fallback',
    run: () => {
      const source = readSource('src/services/cores/pipeline-core.ts');
      const stage = readSource('src/services/cores/stages/fallback-matches.stage.ts');
      const barrel = readSource('src/services/cores/stages/index.ts');

      assert(source.includes('FallbackMatchesStage'), 'Expected PipelineCore to use fallback matches stage');
      assert(source.includes('planner_candidate_fallback'), 'Expected planner candidate fallback source');
      assert(
        source.indexOf('building planner fallback candidates') < source.indexOf('No intent matches, falling back to general chat'),
        'Expected planner candidate fallback before general chat fallback'
      );
      assert(stage.includes('vector_no_matches'), 'Expected fallback stage to mark vector miss reason');
      assert(stage.includes('DEFAULT_MAX_MATCHES'), 'Expected fallback stage to bound candidate count');
      assert(barrel.includes('fallback-matches.stage'), 'Expected fallback stage barrel export');
    }
  },
  {
    name: 'vector intent matching behaves as capability filter, not hard execution gate',
    run: () => {
      const vector = readSource('src/services/vector.service.ts');
      const planner = readSource('src/services/cores/stages/planner.stage.ts');

      assert(vector.includes('MIN_CAPABILITY_QUERY_RESULTS'), 'Expected wider capability retrieval floor');
      assert(vector.includes('Math.max(topK * 8, MIN_CAPABILITY_QUERY_RESULTS)'), 'Expected vector to query broader than topK');
      assert(vector.includes("matchingMode: 'capability_filter'"), 'Expected vector matches to be marked as capability filter');
      assert(vector.includes('MIN_CAPABILITY_DOMAIN_SCORE'), 'Expected lowered domain capability threshold');
      assert(planner.includes('isCapabilityFilter'), 'Expected planner to detect capability filter matches');
      assert(planner.includes("match.metadata?.matchingMode === 'capability_filter'"), 'Expected planner threshold logic to use match metadata');
      assert(planner.includes('? 0.40'), 'Expected capability filter threshold to be lower than strict similarity threshold');
    }
  },
  {
    name: 'clarification state stores ambiguity and resumes next user answer',
    run: () => {
      const service = readSource('src/services/clarificationState.service.ts');
      const pipeline = readSource('src/services/pipeline.service.ts');

      assert(service.includes('export const clarificationStateService'), 'Expected clarification state service export');
      assert(service.includes('ClarificationState'), 'Expected ClarificationState type usage');
      assert(service.includes('incrementRetry'), 'Expected clarification retry tracking');
      assert(pipeline.includes('clarificationStateService.get'), 'Expected pipeline to read pending clarification state');
      assert(pipeline.includes('buildClarifiedQuery'), 'Expected pipeline to rewrite query with clarification answer');
      assert(pipeline.includes("result.intent === 'clarification'"), 'Expected pipeline to store clarification result state');
      assert(pipeline.includes('Clarification state stored'), 'Expected diagnostic log for stored clarification state');
    }
  },
  {
    name: 'temporal question retry is bounded and removes temporal filters',
    run: () => {
      const source = readSource('src/services/cores/stages/execution.stage.ts');

      assert(source.includes('MAX_TEMPORAL_RETRY = 1'), 'Expected max one temporal retry');
      assert(source.includes('getTemporalQuestionType'), 'Expected temporal question detection');
      assert(source.includes('removeTemporalFilterParams'), 'Expected temporal filter removal');
      assert(source.includes('Temporal question empty result, retrying without temporal filters'), 'Expected temporal retry diagnostic log');
    }
  },
  {
    name: 'temporal questions clear filters before execution and preserve date-blind marker',
    run: () => {
      const resolver = readSource('src/services/param-resolution.service.ts');
      const execution = readSource('src/services/cores/stages/execution.stage.ts');
      const memoryUpdater = readSource('src/services/cores/memory/working-memory-updater.ts');

      assert(resolver.includes('Temporal question detected, clearing temporal filters'), 'Expected pre-execution temporal cleanup log');
      assert(resolver.includes('__dateBlind: true'), 'Expected date-blind marker in resolved params');
      assert(resolver.includes('findMissingRequired'), 'Expected final missing validation after cleanup');
      assert(execution.includes('Skipping required temporal param because query is date-blind'), 'Expected execution validation to allow date-blind required temporal params');
      assert(memoryUpdater.includes('shouldClearTemporalEntities'), 'Expected working memory to clear stale temporal entities for date-blind queries');
    }
  },
  {
    name: 'tool result cache supports strict param mode without legacy/latest fallback',
    run: () => {
      const cache = readSource('src/services/memories/toolResultCache.service.ts');
      const continuation = readSource('src/services/cores/stages/continuation.stage.ts');

      assert(cache.includes('strictParams?: boolean'), 'Expected strictParams cache option');
      assert(cache.includes('allowLegacyFallback?: boolean'), 'Expected legacy fallback control');
      assert(cache.includes('allowLatestFallback?: boolean'), 'Expected latest fallback control');
      assert(cache.includes('Strict param cache miss'), 'Expected strict cache miss diagnostic log');
      assert(cache.includes('normalizeCacheParams'), 'Expected cache param normalization');
      assert(continuation.includes('strictParams: true'), 'Expected continuation cache lookup to use strict params');
      assert(continuation.includes('allowLegacyFallback: false'), 'Expected continuation to disable legacy fallback for param lookup');
      assert(continuation.includes('allowLatestFallback: false'), 'Expected continuation to disable latest fallback for param lookup');
    }
  },
  {
    name: 'general chat data fallback blocks name hallucination without record arrays',
    run: () => {
      const source = readSource('src/services/generalChat.service.ts');

      assert(source.includes('buildOperationalDataGuardResponse'), 'Expected operational data guard before LLM');
      assert(source.includes('isNameListQuestion'), 'Expected name/list question detection');
      assert(source.includes('hasRecordArray'), 'Expected record-array validation');
      assert(source.includes('tidak berisi daftar record/nama'), 'Expected grounded fallback message when record data is unavailable');
      assert(source.includes('Riwayat chat, episodic memory, Active Entities, dan jumlah summary bukan bukti'), 'Expected strict operational-data grounding instruction');
      assert(source.includes('!isOperationalDataQuestion && contextCache?.episodicMemories'), 'Expected episodic memories to be omitted for operational data questions');
    }
  },
  {
    name: 'comparison v1 is exact-tool continuation with dynamic temporal mapping',
    run: () => {
      const decomposition = readSource('src/services/query-decomposition.service.ts');
      const resolver = readSource('src/services/cores/resolvers/continuation.resolver.ts');
      const stage = readSource('src/services/cores/stages/continuation.stage.ts');
      const temporalAdapter = readSource('src/services/temporal-param-adapter.service.ts');
      const compatibility = readSource('src/services/comparison-compatibility.service.ts');
      const comparisonPlan = readSource('src/services/comparison-plan.service.ts');
      const comparisonStage = readSource('src/services/cores/stages/comparison.stage.ts');
      const pipelineCore = readSource('src/services/cores/pipeline-core.ts');

      assert(decomposition.includes('comparison?:'), 'Expected decomposition comparison signal type');
      assert(decomposition.includes('extractComparisonSignal'), 'Expected comparison signal extraction');
      assert(resolver.includes("type: 'comparison'"), 'Expected resolver to return comparison continuation type');
      assert(resolver.includes("baseline?.source === 'current_query'"), 'Expected current-query comparisons to route to main pipeline');
      assert(stage.includes('executeComparisonContinuation'), 'Expected continuation comparison executor');
      assert(stage.includes("intent: 'continuation_fallback'"), 'Expected unavailable comparison context to re-enter main pipeline');
      assert(stage.includes('strictParams: true'), 'Expected strict cache use in comparison target lookup');
      assert(temporalAdapter.includes('mapTemporalToToolParams'), 'Expected dynamic temporal param adapter');
      assert(temporalAdapter.includes('month_year'), 'Expected month/year temporal mapping support');
      assert(temporalAdapter.includes('start_date') && temporalAdapter.includes('end_date'), 'Expected range temporal mapping support');
      assert(compatibility.includes('EXACT_TOOL'), 'Expected exact-tool compatibility level');
      assert(comparisonPlan.includes('detectExactToolComparison'), 'Expected V1 exact-tool comparison plan service');
      assert(comparisonStage.includes('tryExecuteStandalone'), 'Expected standalone comparison stage');
      assert(comparisonStage.includes('baselineResult') && comparisonStage.includes('targetResult'), 'Expected baseline and target comparison execution');
      assert(pipelineCore.includes('comparisonStage.tryExecuteStandalone'), 'Expected PipelineCore standalone comparison integration');
    }
  },
  {
    name: 'internal skills are first-class planner and execution resources',
    run: () => {
      const plannerTypes = readSource('src/types/planner.types.ts');
      const plannerStage = readSource('src/services/cores/stages/planner.stage.ts');
      const toolPlanner = readSource('src/services/toolPlanner.service.ts');
      const executionStage = readSource('src/services/cores/stages/execution.stage.ts');
      const executionContext = readSource('src/utils/strategies/execution-context.ts');
      const skillStrategy = readSource('src/utils/strategies/skill-execution.strategy.ts');
      const continuationStage = readSource('src/services/cores/stages/continuation.stage.ts');
      const continuationResolver = readSource('src/services/cores/resolvers/continuation.resolver.ts');
      const workingMemory = readSource('src/types/working-memory.type.ts');

      assert(plannerTypes.includes('"skill"'), 'Expected PlannerTask resource to include skill');
      assert(!plannerTypes.includes('"handler"'), 'PlannerTask resource must not include legacy handler');
      assert(plannerStage.includes('selectSkillCandidates'), 'Expected PlannerStage skill candidate selector');
      assert(plannerStage.includes('skillsRegistry.getAllSkills'), 'Expected PlannerStage to load skills from registry');
      assert(toolPlanner.includes('skills:'), 'Expected planner prompt skills section');
      assert(toolPlanner.includes('validSkillKeys'), 'Expected planner safeParse skill validation');
      assert(!toolPlanner.includes('validHandlerKeys'), 'Tool planner must not validate legacy handlers');
      assert(!toolPlanner.includes('"handler"'), 'Tool planner prompt/parser must not expose handler resource');
      assert(executionStage.includes("case 'skill'"), 'Expected ExecutionStage skill resource branch');
      assert(!executionStage.includes("case 'handler'"), 'ExecutionStage must not execute legacy handler tasks');
      assert(executionStage.includes('executeSkillTasks'), 'Expected ExecutionStage batch skill execution');
      assert(executionContext.includes('skill: new SkillExecutionStrategy()'), 'Expected execution context skill strategy registration');
      assert(!executionContext.includes('handler:'), 'Execution context must not register legacy handler strategy');
      assert(skillStrategy.includes('skillsRegistry.getSkillBySlug'), 'Expected SkillExecutionStrategy to resolve skill metadata');
      assert(skillStrategy.includes('skillsRegistry.hasHandler'), 'Expected SkillExecutionStrategy to validate registered handlerKey before lookup');
      assert(skillStrategy.includes('skillsRegistry.getHandler'), 'Expected SkillExecutionStrategy to resolve skill handler');
      assert(!continuationStage.includes('getHandlerResource'), 'Continuation stage must not keep handler resource compatibility');
      assert(!continuationStage.includes("resource === 'handler'"), 'Continuation stage must not select handler tasks');
      assert(continuationResolver.includes('skillsRegistry.hasSkill'), 'Expected continuation resolver skill-first handler validation');
      assert(workingMemory.includes('activeSkill?: string'), 'Expected working memory activeSkill field');
      assert(!workingMemory.includes('activeHandler'), 'Working memory must not keep legacy activeHandler field');
      assert(workingMemory.includes('lastSkillSlug'), 'Expected working memory lastSkillSlug hint');
    }
  }
];

async function main() {
  let failed = 0;

  for (const test of tests) {
    try {
      await test.run();
      console.log(`[PASS] ${test.name}`);
    } catch (error) {
      failed += 1;
      console.error(`[FAIL] ${test.name}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  console.log(`\nPhase 1 smoke tests: ${tests.length - failed}/${tests.length} passed`);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
