import { toolPlannerService } from '../../toolPlanner.service';
import { episodicMemoryService } from '../../episodic-memory.service';
import type { Intent, IntentMatch, PipelineInput } from '../../../types';
import type { PlannerOutput, PlannerTask } from '../../../types/planner.types';
import type { Agent } from '../../../types/agent.types';
import { appLogger } from '../../../utils/logger.util';
import { withTimeout } from '../../../utils/async-helpers.util';
import { config } from '../../../config';

const PLANNER_TIMEOUT = 20000;

// ============================================================
// Types
// ============================================================

export interface PlannerStageOptions {
  usePlan?: boolean;
  timeout?: number;
}

interface IntentCandidate {
  slug: string;
  name: string;
  description: string;
  intentSlug: string;
  intentName: string;
  handlerKey?: string;
}

// ============================================================
// PlannerStage
// ============================================================

/**
 * PlannerStage - Determines execution plan from matched intents
 * 
 * Responsibilities:
 * - Build candidate list from matches
 * - Call toolPlannerService for complex plans
 * - Handle fast-path for single candidates
 * - Return execution plan
 */
export class PlannerStage {
  /**
   * Execute planning
   * 
   * @param matches - Matched intents from vector search
   * @param input - Pipeline input with user context
   * @param agent - Agent context
   * @param options - Optional configuration
   * @returns PlannerOutput with execution plan
   */
  async execute(
    matches: IntentMatch[],
    input: PipelineInput,
    agent: Agent,
    options?: PlannerStageOptions
  ): Promise<PlannerOutput> {
    const usePlan = options?.usePlan ?? true;
    const timeout = options?.timeout ?? PLANNER_TIMEOUT;

    const hasMatches = matches && matches.length > 0;

    // Get recent usage from episodic memory
    const recentUsage = await episodicMemoryService.getToolUsageHints(
      input.user_id,
      input.app_name
    );

    const hasRecentUsage = recentUsage && (recentUsage.tasks?.length > 0);

    // Early exit: pure chat (no matches + no memory)
    if (!hasMatches && !hasRecentUsage) {
      appLogger.debug('PlannerStage: No matches & no memory → PURE CHAT');
      return this.buildChatOnlyPlan();
    }

    // Build candidate lists
    const candidates = this.buildCandidates(matches);

    const totalCandidates = 
      candidates.handlers.length + 
      candidates.tools.length + 
      candidates.knowledge.length;

    if (totalCandidates === 0) {
      return this.buildChatOnlyPlan();
    }

    // Fast path: single candidate (skip planner)
    const fastPathPlan = this.tryFastPath(candidates);
    if (fastPathPlan) {
      return fastPathPlan;
    }

    // Call LLM planner for multiple candidates
    if (!usePlan) {
      return this.buildRunAllPlan(candidates);
    }

    return await this.callPlanner(candidates, input, recentUsage, timeout);
  }

  // ============================================================
  // Candidate Building
  // ============================================================

  /**
   * Build candidate lists from matched intents
   */
  private buildCandidates(matches: IntentMatch[]): {
    handlers: IntentCandidate[];
    tools: IntentCandidate[];
    knowledge: IntentCandidate[];
  } {
    // C-009 FIX: Filter by score threshold from config to avoid low-confidence matches
    const SCORE_THRESHOLD = config.intent.similarityThreshold; // Default: 0.75
    const highConfidenceMatches = matches.filter(m => m.score >= SCORE_THRESHOLD);

    // Log if we filtered out low-confidence matches
    if (highConfidenceMatches.length < matches.length) {
      appLogger.debug('PlannerStage: Filtered low-confidence matches', {
        totalMatches: matches.length,
        highConfidenceMatches: highConfidenceMatches.length,
        threshold: SCORE_THRESHOLD,
        filteredOut: matches
          .filter(m => m.score < SCORE_THRESHOLD)
          .map(m => ({ slug: m.intent.slug, score: m.score }))
      });
    }

    // If no high-confidence matches, use the top match anyway (but log warning)
    const matchesToUse = highConfidenceMatches.length > 0 
      ? highConfidenceMatches 
      : (matches.length > 0 ? [matches[0]] : []);

    const matchedIntents = matchesToUse.map(m => m.intent);

    const handlerIntents = matchedIntents.filter(m => m.executionType === 'handler');
    const toolIntents = matchedIntents.filter(m => m.tools && m.tools.length > 0);
    const knowledgeIntents = matchedIntents.filter(m => m.knowledge && m.knowledge.length > 0);

    const handlers = handlerIntents.flatMap(intent => ({
      slug: intent.slug,
      name: intent.name,
      description: intent.description,
      intentSlug: intent.slug,
      intentName: intent.name,
      handlerKey: intent.handlerKey
    }));

    const tools = toolIntents.flatMap(intent => {
      return (intent.tools || []).map((t: any) => {
        const toolData = t.tool || t;
        return {
          slug: toolData.slug,
          name: toolData.name,
          description: toolData.description,
          intentSlug: intent.slug,
          intentName: intent.name,
          handlerKey: intent.handlerKey
        };
      });
    });

    const knowledge = knowledgeIntents.flatMap(intent => {
      return (intent.knowledge || []).map((k: any) => {
        const knowledgeData = k.knowledge || k;
        return {
          slug: knowledgeData.slug,
          name: knowledgeData.title || knowledgeData.slug,
          description: knowledgeData.description || knowledgeData.title || knowledgeData.slug,
          intentSlug: intent.slug,
          intentName: intent.name,
          handlerKey: intent.handlerKey
        };
      });
    });

    // Deduplicate
    const uniqueHandlers = this.deduplicateBySlug(handlers);
    const uniqueTools = this.deduplicateBySlug(tools);
    const uniqueKnowledge = this.deduplicateBySlug(knowledge);

    appLogger.debug('PlannerStage: Intent candidates', {
      handlers: uniqueHandlers.map(h => h.slug),
      tools: uniqueTools.map(t => t.slug),
      knowledge: uniqueKnowledge.map(k => k.slug)
    });

    return {
      handlers: uniqueHandlers,
      tools: uniqueTools,
      knowledge: uniqueKnowledge
    };
  }

  private deduplicateBySlug(candidates: IntentCandidate[]): IntentCandidate[] {
    return [...new Map(candidates.map(c => [c.slug, c])).values()];
  }

  // ============================================================
  // Fast Path Detection
  // ============================================================

  /**
   * Try fast path for single candidates
   */
  private tryFastPath(candidates: {
    handlers: IntentCandidate[];
    tools: IntentCandidate[];
    knowledge: IntentCandidate[];
  }): PlannerOutput | null {
    const { handlers, tools, knowledge } = candidates;

    // Single handler
    if (handlers.length === 1 && tools.length === 0 && knowledge.length === 0) {
      appLogger.debug('PlannerStage: Single handler → skip planner');
      return {
        mode: 'single_step',
        chat: false,
        tasks: [this.buildTask('handler', handlers[0].slug, 1)]
      };
    }

    // Single tool
    if (tools.length === 1 && handlers.length === 0 && knowledge.length === 0) {
      appLogger.debug('PlannerStage: Single tool → skip planner');
      return {
        mode: 'single_step',
        chat: false,
        tasks: [this.buildTask('tool', tools[0].slug, 1)]
      };
    }

    // Single knowledge
    if (knowledge.length === 1 && handlers.length === 0 && tools.length === 0) {
      appLogger.debug('PlannerStage: Single knowledge → skip planner');
      return {
        mode: 'single_step',
        chat: false,
        tasks: [this.buildTask('knowledge', knowledge[0].slug, 1)]
      };
    }

    return null;
  }

  private buildTask(
    resource: 'handler' | 'tool' | 'knowledge',
    key: string,
    id: number
  ): PlannerTask {
    return {
      id: `${id}`,
      resource,
      key,
      depends_on: []
    };
  }

  // ============================================================
  // Plan Building
  // ============================================================

  private buildChatOnlyPlan(): PlannerOutput {
    return {
      mode: 'single_step',
      chat: true,
      tasks: []
    };
  }

  private buildRunAllPlan(candidates: {
    handlers: IntentCandidate[];
    tools: IntentCandidate[];
    knowledge: IntentCandidate[];
  }): PlannerOutput {
    const tasks: PlannerTask[] = [];
    let id = 1;

    for (const handler of candidates.handlers) {
      tasks.push(this.buildTask('handler', handler.slug, id++));
    }
    for (const tool of candidates.tools) {
      tasks.push(this.buildTask('tool', tool.slug, id++));
    }
    for (const knowledge of candidates.knowledge) {
      tasks.push(this.buildTask('knowledge', knowledge.slug, id++));
    }

    return {
      mode: 'multi_step',
      chat: tasks.length === 0,
      tasks
    };
  }

  // ============================================================
  // LLM Planner
  // ============================================================

  private async callPlanner(
    candidates: {
      handlers: IntentCandidate[];
      tools: IntentCandidate[];
      knowledge: IntentCandidate[];
    },
    input: PipelineInput,
    recentUsage: PlannerOutput,
    timeout: number
  ): Promise<PlannerOutput> {
    appLogger.debug('PlannerStage: Multiple candidates → calling planner');

    const plan = await withTimeout(
      toolPlannerService.plan({
        userText: input.text,
        candidates: {
          handlers: candidates.handlers.map(h => h.slug),
          tools: candidates.tools.map(t => t.slug),
          knowledge: candidates.knowledge.map(k => k.slug),
          handlerDetails: candidates.handlers,
          toolsDetails: candidates.tools,
          knowledgeDetails: candidates.knowledge
        },
        recentUsage,
        language: input.language
      }),
      timeout,
      'toolPlannerService.plan'
    );

    appLogger.debug('PlannerStage: Planner returned plan', { plan });

    return plan;
  }
}
