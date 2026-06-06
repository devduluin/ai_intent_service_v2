import { toolPlannerService } from '../../toolPlanner.service';
import { episodicMemoryService } from '../../episodic-memory.service';
import { conversationStateService } from '../../conversationState.service';  // ✅ NEW: Check pending slots (correct camelCase)
import { toolService } from '../../tools.service';  // ✅ CORRECT: toolService (singular)
import { intentRepository } from '../../../repositories/intent.repository';
import { greetingDetector } from '../../../utils/greeting-detector.util';  // ✅ NEW: Greeting detection
import type { IntentMatch, PipelineInput } from '../../../types';
import type { PlannerOutput, PlannerTask, RecentUsageHints } from '../../../types/planner.types';  // ✅ ADDED RecentUsageHints
import type { Agent } from '../../../types/agent.types';
import type { InternalSkillMetadata } from '../../../types/internal-skill.types';
import { appLogger } from '../../../utils/logger.util';
import { withTimeout } from '../../../utils/async-helpers.util';
import { config } from '../../../config';
import { ContextMemory } from '../pipeline-core';
import type { EpisodicMemory } from '../../../types/episodic-memory.types';
import { skillsRegistry } from '../../skills-registry.service';
import type { SkillSignal } from '../../skill-signal.service';
import { isUserProfileQuestionText } from '../../../utils/user-profile-statement.util';

const PLANNER_TIMEOUT = 20000;

// ============================================================
// Confidence Thresholds
// ============================================================

// Task confidence thresholds
export const TASK_CONFIDENCE_HIGH = 0.80;      // Direct execution
export const TASK_CONFIDENCE_MEDIUM = 0.60;    // Execute with context boost

// Plan confidence thresholds
const PLAN_CONFIDENCE_HIGH = 0.75;      // Plan-level high confidence
const PLAN_CONFIDENCE_LOW = 0.30;       // Plan-level low confidence

// ============================================================
// Types
// ============================================================

export interface PlannerStageOptions {
  usePlan?: boolean;
  timeout?: number;
  allowedFastPathResources?: string[];  // ✅ NEW: Configurable fast path resources
  skillSignal?: SkillSignal;
  perceptionFrame?: import('../../../types/perception.types').PerceptionFrame | null;
}

interface SkillCandidate {
  slug: string;
  name: string;
  description: string;
  handlerKey?: string;  // ✅ Optional (from skill metadata)
  category?: string;
  tags?: string[];
  capabilities?: InternalSkillMetadata['capabilities'];
}

// ✅ NEW: Generic candidate interface for tools/knowledge (no handlerKey)
interface ResourceCandidate {
  slug: string;
  name: string;
  description: string;
  intentSlug: string;
  intentName: string;
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
    options: PlannerStageOptions,
    memoryContext: ContextMemory
  ): Promise<PlannerOutput> {
    // ✅ QA FIX #1: Input validation
    if (!matches || matches.length === 0) {
      appLogger.warn('[PlannerStage] No matches provided, checking pre-planner gates');
      matches = [];
    }

    if (!input?.text || input.text.trim().length === 0) {
      appLogger.warn('[PlannerStage] Empty input text, using chat-only');
      return this.buildChatOnlyPlan();
    }

    if (!agent) {
      appLogger.error('[PlannerStage] Agent is null');
      throw new Error('Agent is required for planning');
    }

    const usePlan = options?.usePlan ?? true;
    const timeout = options?.timeout ?? PLANNER_TIMEOUT;
    
    const allowedFastPathResources = this.validateAllowedResources(
      options?.allowedFastPathResources ?? ['knowledge']
    );

    const hasMatches = matches && matches.length > 0;

    // const recentUsage = await episodicMemoryService.getToolUsageHints(
    //   input.user_id,
    //   input.app_name
    // );

    // const hasRecentUsage = recentUsage && (recentUsage.tasks?.length > 0);

    // ============================================================
    // PRE-PLANNER GATE: Early greeting/small talk detection
    // (ONLY if NO pending slot/confirmation)
    // ============================================================
    const hasPendingSlot = conversationStateService.get(input.user_id, input.app_name) != null;
    
    if (!hasPendingSlot) {
      const prePlannerGateResult = await this.prePlannerGate(input, agent, options);
      if (prePlannerGateResult) {
        appLogger.info('[PlannerStage] Pre-planner gate selected resource', {
          userId: input.user_id,
          appName: input.app_name,
          query: input.text,
          resource: prePlannerGateResult.tasks[0]?.resource,
          key: prePlannerGateResult.tasks[0]?.key
        });
        return prePlannerGateResult;
      }
    } else {
      appLogger.debug('[PlannerStage] Pending slot detected, skipping greeting gate', {
        userId: input.user_id,
        appName: input.app_name
      });
    }

    // PerceptionFrame-based skill routing (replaces tryOrchestrationSkillGate)
    const perceptionFrame = options?.perceptionFrame;
    if (perceptionFrame && perceptionFrame.confidence >= 0.65) {
      const routedPlan = this.routePerceptionFrame(perceptionFrame, input, agent);
      if (routedPlan) {
        appLogger.info('[PlannerStage] Perception frame routed to resource', {
          userId: input.user_id,
          appName: input.app_name,
          query: input.text,
          frameType: perceptionFrame.type,
          key: routedPlan.tasks[0]?.key,
          confidence: routedPlan.confidence
        });
        return routedPlan;
      }
    }

    if (!hasMatches && options?.skillSignal?.hasStrongSignal) {
      const signalOnlyPlan = this.buildPlanFromStrongSkillSignal(options.skillSignal, {
        skills: [],
        tools: [],
        knowledge: []
      });
      if (signalOnlyPlan) return signalOnlyPlan;
    }

    // Early exit after pre-planner gates: pure chat (no matches + no gate hit)
    if (!hasMatches) {
      appLogger.debug('PlannerStage: No matches & no gate hit -> PURE CHAT');
      return this.buildChatOnlyPlan();
    }

    // Build candidate lists
    const candidates = this.buildCandidates(matches, input, memoryContext, options?.perceptionFrame);

    const totalCandidates = 
      candidates.skills.length +
      candidates.tools.length + 
      candidates.knowledge.length;

    if (totalCandidates === 0) {
      return this.buildChatOnlyPlan();
    }

    const skillSignalPlan = this.buildPlanFromStrongSkillSignal(options?.skillSignal, candidates);
    if (skillSignalPlan) {
      appLogger.info('[PlannerStage] Strong skill signal fast path', {
        skill: skillSignalPlan.tasks[0]?.key,
        reason: 'orchestration_or_no_resource_dependency'
      });
      return skillSignalPlan;
    }

    // Fast path: single candidate (skip planner)
    const fastPathPlan = this.tryFastPath(candidates, allowedFastPathResources);
    if (fastPathPlan) {
      appLogger.info('[PlannerStage] Fast path executed', {
        resourceType: fastPathPlan.tasks[0]?.resource,
        resourceSlug: fastPathPlan.tasks[0]?.key,
        allowedFastPathResources,
        totalCandidates: candidates.skills.length + candidates.tools.length + candidates.knowledge.length,
        bypassed: false
      });
      return fastPathPlan;
    }
    
    // Log fast path bypass
    appLogger.info('[PlannerStage] Fast path bypassed', {
      reason: 'multiple_candidates_or_not_allowed',
      allowedFastPathResources,
      candidates: {
        skills: candidates.skills.length,
        tools: candidates.tools.length,
        knowledge: candidates.knowledge.length
      },
      willCallPlanner: usePlan
    });

    // Call LLM planner for multiple candidates
    if (!usePlan) {
      return this.buildRunAllPlan(candidates);
    }

    return await this.callPlanner(candidates, 
      input, 
      memoryContext, 
      timeout,
      options?.skillSignal,
      options?.perceptionFrame
    );
  }

  // ============================================================
  // PERCEPTION FRAME ROUTING (replaces tryOrchestrationSkillGate)
  // ============================================================

  /**
   * Dynamic mapping from PerceptionIntentType → skill search criteria.
   *
   * Skills are discovered at runtime from skillsRegistry, so new skills
   * with matching category/context/actionType will be picked up automatically.
   *
   * Fallback: if no dynamic match, uses hardcoded slug map below.
   */
  private static readonly FRAME_SKILL_SEARCH: Record<
    string,
    { category?: string; context?: string; actionType?: string; fallbackSlug: string }
  > = {
    memory_question: {
      category: 'memory',
      context: 'memory_retrieval',
      fallbackSlug: 'memory_recall'
    },
    memory_task_replay: {
      category: 'memory',
      context: 'memory_retrieval',
      fallbackSlug: 'memory_recall'
    },
    user_profile_question: {
      category: 'memory',
      context: 'user_profile',
      fallbackSlug: 'user_profile_recall'
    },
    automation_request: {
      category: 'automation',
      context: 'future_task',
      fallbackSlug: 'automation_manager'
    },
    small_talk: {
      category: undefined,
      context: undefined,
      fallbackSlug: 'greeting'
    },
    comparison: {
      actionType: 'compare',
      fallbackSlug: ''
    },
    continuation_refine: {
      context: 'current_context',
      fallbackSlug: ''
    }
  };

  /** Cache: frame type → best matching skill slug */
  private _frameSkillCache: Map<string, string> = new Map();

  /**
   * Resolve the best skill slug for a given frame type.
   * Searches skillsRegistry dynamically, falls back to hardcoded slug.
   */
  private resolveSkillForFrame(frameType: string, agent?: Agent): string | null {
    const cacheKey = `${agent?.id || 'global'}:${frameType}`;

    // Cache hit
    const cached = this._frameSkillCache.get(cacheKey);
    if (cached !== undefined) return cached || null;

    const search = PlannerStage.FRAME_SKILL_SEARCH[frameType];

    const allSkills = skillsRegistry.getAllSkills({ includeHidden: false });

    // Score each skill by how many criteria it matches
    let bestMatch: { slug: string; score: number } | null = null;

    for (const skill of allSkills) {
      let score = 0;

      if (search) {
        // Known frame type: use defined search criteria
        if (search.category && skill.category === search.category) {
          score += 3;
        }
        if (search.context && skill.capabilities?.context?.includes(search.context)) {
          score += 2;
        }
        if (search.actionType && skill.capabilities?.actionTypes?.includes(search.actionType)) {
          score += 2;
        }
      } else {
        // Unknown frame type: try to match by frame type name in skill context
        // e.g., a skill with context: ['memory_task_replay'] auto-matches that frame
        if (skill.capabilities?.context?.includes(frameType)) {
          score += 5;
        }
      }

      // Priority boost — only if skill matched at least one criterion
      if (score > 0) {
        score += (skill.capabilities?.priority || 5) * 0.1;
      }

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { slug: skill.slug, score };
      }
    }

    // Fallback to hardcoded slug
    const result = bestMatch?.slug || search?.fallbackSlug || null;
    this._frameSkillCache.set(cacheKey, result || '');

    if (bestMatch) {
      const isDynamic = !search || bestMatch.slug !== search.fallbackSlug;
      if (isDynamic) {
        appLogger.info('[PlannerStage] Dynamic skill resolved for frame', {
          frameType,
          resolvedSkill: bestMatch.slug,
          score: bestMatch.score,
          hadSearchEntry: !!search
        });
      }
    }

    return result;
  }

  /**
   * Route perception frame to the appropriate skill.
   * Uses dynamic skill discovery via skillsRegistry.
   */
  private routePerceptionFrame(
    frame: import('../../../types/perception.types').PerceptionFrame,
    input: PipelineInput,
    agent?: Agent
  ): PlannerOutput | null {
    const skillSlug = this.resolveSkillForFrame(frame.type, agent);
    if (!skillSlug) return null;

    const skillMeta = skillsRegistry.getSkillBySlug(skillSlug);
    if (!skillMeta) {
      appLogger.warn('[PlannerStage] Resolved skill not found in registry', {
        frameType: frame.type,
        resolvedSkill: skillSlug
      });
      return null;
    }

    // Guard: skills that require tool data must go through the planner
    // to set up proper depends_on relationships. Routing directly would
    // execute the skill without data, producing garbage results.
    if (skillMeta.capabilities?.requiresData) {
      appLogger.info('[PlannerStage] Skill requires data, deferring to planner for dependency setup', {
        frameType: frame.type,
        skillSlug,
        requiresData: true
      });
      return null; // Let planner build the tool → skill chain
    }

    return {
      mode: 'single_step',
      chat: false,
      tasks: [this.buildTask('skill', skillSlug, 1)],
      reasoning: `PerceptionFrame: ${frame.type} → ${skillSlug}`,
      confidence: frame.confidence,
      meta: {
        preFilterConfidence: frame.confidence,
        postFilterConfidence: frame.confidence,
        ambiguityReasons: ['perception_frame_routing']
      }
    };
  }

  // ============================================================
  // PRE-PLANNER GATE LOGIC
  // ============================================================

  /**
   * Pre-planner gate: Detect early greetings/small talk
   * 
   * ⚠️ ONLY RUNS IF NO PENDING SLOT/CONFIRMATION
   * 
   * Returns PlannerOutput if greeting detected (skill:greeting, chat:false)
   * Returns null if not greeting (continue to normal planner flow)
   * 
   * Excluded queries:
   * - Time queries ("jam berapa", "what time") = use tool/skill
   * - Context queries ("siapa", "siapa nama") = use tool/skill
   * - Action-oriented queries ("cek", "buat", "analisis") = use planner
   * - Yes/No answers = use confirmationDetector for pending slots
   * 
   * Key safeguards:
   * - Short sentences only (max 15 words)
   * - No action keywords
   * - Pattern-based or structure-based detection
   */
  private async prePlannerGate(
    input: PipelineInput,
    agent: Agent,
    options?: PlannerStageOptions
  ): Promise<PlannerOutput | null> {
    try {
      if (this.isUserProfileQuestion(input.text)) {
        return {
          mode: 'single_step',
          chat: false,
          tasks: [this.buildTask('skill', 'user_profile_recall', 0.92)],
          reasoning: 'Pre-planner gate: explicit user profile question',
          confidence: 0.92,
          meta: {
            preFilterConfidence: 0.92,
            postFilterConfidence: 0.92,
            ambiguityReasons: ['user_profile_question_gate']
          }
        };
      }

      // Detect if this is a greeting
      const detection = greetingDetector.detect(input.text);
      
      appLogger.debug('[PlannerStage] Greeting detection result', {
        userId: input.user_id,
        query: input.text,
        isGreeting: detection.isGreeting,
        type: detection.type,
        confidence: detection.confidence,
        reason: detection.reason
      });
      
      // If greeting detected, return greeting skill plan
	      if (detection.isGreeting && detection.confidence >= 0.6) {
	        return {
          mode: 'single_step',
          chat: false,  // ✅ Execute skill, not chat
          tasks: [
            {
              id: '1',
              resource: 'skill',
              key: 'greeting',  // ✅ Special greeting skill
              depends_on: [],
              confidence: detection.confidence
            }
          ],
          reasoning: `Greeting detected: ${detection.type}`,
          confidence: detection.confidence,
          meta: {
            preFilterConfidence: detection.confidence,
            postFilterConfidence: detection.confidence,
            ambiguityReasons: [detection.reason]
          }
	        };
	      }

	      // Not a greeting, continue to normal planner flow
	      return null;
      
    } catch (error) {
      appLogger.error('[PlannerStage] Pre-planner gate error', {
        error: error instanceof Error ? error.message : error,
        query: input.text
      });
      // On error, skip gate and continue to normal flow
      return null;
    }
	  }

	  private buildPlanFromStrongSkillSignal(
	    skillSignal: SkillSignal | undefined,
	    candidates: {
	      skills: SkillCandidate[];
	      tools: ResourceCandidate[];
	      knowledge: ResourceCandidate[];
	    }
	  ): PlannerOutput | null {
	    if (!skillSignal?.hasStrongSignal || !skillSignal.recommendedSkill) {
	      return null;
	    }

	    const skillMetadata = skillsRegistry.getSkillBySlug(skillSignal.recommendedSkill);
	    const isOrchestrationSkill = this.isOrchestrationSkill(skillMetadata);
	    const candidate = skillSignal.candidates.find(item => item.slug === skillSignal.recommendedSkill);
	    const isExplicitSkillInvocation = candidate?.matchedBy?.some(item =>
	      item === 'skill_name' || item === 'skill_slug'
	    ) === true;
	    const requiresData = skillMetadata?.capabilities?.requiresData === true;

	    if (
	      !isOrchestrationSkill &&
	      !isExplicitSkillInvocation &&
	      (candidates.tools.length > 0 || candidates.knowledge.length > 0)
	    ) {
	      return null;
	    }

	    if (isExplicitSkillInvocation && requiresData) {
	      return null;
	    }

	    const confidence = candidate?.confidence ?? 0.8;

	    return {
	      mode: 'single_step',
	      chat: false,
	      tasks: [
	        {
	          id: '1',
	          resource: 'skill',
	          key: skillSignal.recommendedSkill,
	          depends_on: [],
	          confidence
	        }
	      ],
	      reasoning: `Skill signal matched: ${skillSignal.recommendedSkill}`,
	      confidence,
	      meta: {
	        preFilterConfidence: confidence,
	        postFilterConfidence: confidence,
	        ambiguityReasons: candidate?.matchedBy || ['skill_signal']
	      }
	    };
	  }

	  private isOrchestrationSkill(skill?: InternalSkillMetadata | null): boolean {
	    if (!skill?.capabilities) return false;
	    const actionTypes = skill.capabilities.actionTypes || [];
	    const context = skill.capabilities.context || [];
	    const category = skill.category || '';

	    return category === 'automation' ||
	      actionTypes.includes('automation') ||
	      actionTypes.includes('schedule') ||
	      actionTypes.includes('monitor') ||
	      context.includes('future_task') ||
	      context.includes('scheduled_workflow') ||
	      context.includes('conditional_alert');
	  }

  private normalizeForGate(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[\/_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isUserProfileQuestion(text: string): boolean {
    return isUserProfileQuestionText(text);
  }


	  // ============================================================
  // Candidate Building
  // ============================================================

  /**
   * Build candidate lists from matched intents
   */
  private buildCandidates(
    matches: IntentMatch[],
    input: PipelineInput,
    memoryContext: ContextMemory | null,
    perceptionFrame?: import('../../../types/perception.types').PerceptionFrame | null
  ): {
    skills: SkillCandidate[];
    tools: ResourceCandidate[];
    knowledge: ResourceCandidate[];
  } {
    const isCapabilityFilter = matches.some(match =>
      match.metadata?.matchingMode === 'capability_filter' ||
      match.metadata?.source === 'planner_candidate_fallback'
    );

    const SCORE_THRESHOLD = isCapabilityFilter
      ? 0.40
      : config.intent.similarityThreshold;
    const highConfidenceMatches = matches.filter(m => m.score >= SCORE_THRESHOLD);

    // Log if we filtered out low-confidence matches
    if (highConfidenceMatches.length < matches.length) {
      appLogger.debug('PlannerStage: Filtered low-confidence matches', {
        totalMatches: matches.length,
        highConfidenceMatches: highConfidenceMatches.length,
        threshold: SCORE_THRESHOLD,
        isCapabilityFilter,
        filteredOut: matches
          .filter(m => m.score < SCORE_THRESHOLD)
          .map(m => ({ slug: m.intent.slug, score: m.score }))
      });
    }

    // ✅ ISSUE #7: Add absolute minimum score threshold
    const ABSOLUTE_MIN_SCORE = isCapabilityFilter ? 0.35 : 0.45;
    
    // If top match below absolute minimum → chat-only (don't revive garbage)
    if (matches.length === 0 || matches[0].score < ABSOLUTE_MIN_SCORE) {
      appLogger.debug('[PlannerStage] No viable matches (below absolute minimum)', {
        topScore: matches[0]?.score || 0,
        threshold: ABSOLUTE_MIN_SCORE
      });
      
      return {
        skills: [],
        tools: [],
        knowledge: []
      };
    }

    const matchesToUse = isCapabilityFilter
      ? highConfidenceMatches
      : (
          highConfidenceMatches.length > 0
            ? highConfidenceMatches
            : (matches[0].score >= TASK_CONFIDENCE_MEDIUM ? [matches[0]] : [])
        );

    appLogger.debug('PlannerStage: Candidate match selection', {
      isCapabilityFilter,
      incomingMatches: matches.length,
      selectedMatches: matchesToUse.length,
      threshold: SCORE_THRESHOLD
    });

    const matchedIntents = matchesToUse.map(m => m.intent);

    // ✅ SKILLS-BASED: Get skills from registry (not from intent DB)
    const toolIntents = matchedIntents.filter(m => m.tools && m.tools.length > 0);
    const knowledgeIntents = matchedIntents.filter(m => m.knowledge && m.knowledge.length > 0);

    // ✅ SKILLS: Build from skillsRegistry (not from intent.handlerKey)
    const skills = this.selectSkillCandidates();

    const tools = toolIntents.flatMap(intent => {
      return (intent.tools || []).map((t: any) => {
        const toolData = t.tool || t;
        return {
          slug: toolData.slug,
          name: toolData.name,
          description: toolData.description,
          intentSlug: intent.slug,
          intentName: intent.name
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
          intentName: intent.name
        };
      });
    });

    // Deduplicate
    const uniqueTools = this.deduplicateBySlug(tools);
    const uniqueKnowledge = this.deduplicateBySlug(knowledge);
    const uniqueSkills = skills; // Already deduplicated from selectSkillCandidates

    appLogger.debug('PlannerStage: Intent candidates', {
      skills: uniqueSkills.map(s => s.slug),
      tools: uniqueTools.map(t => t.slug),
      knowledge: uniqueKnowledge.map(k => k.slug)
    });

    // ============================================================
    // COGNITIVE: Frame-driven candidate filtering
    // Perception tells planner what kind of work this is,
    // so planner can narrow candidates accordingly.
    // ============================================================
    let filteredSkills = uniqueSkills;
    if (perceptionFrame && perceptionFrame.confidence >= 0.65) {
      const ORCHESTRATION_CATEGORIES = new Set(['memory', 'automation']);
      const ORCHESTRATION_SLUGS = new Set(['greeting']);

      switch (perceptionFrame.type) {
        case 'direct_task':
          // Direct task: remove orchestration skills, focus on tools
          filteredSkills = uniqueSkills.filter(
            s => !ORCHESTRATION_CATEGORIES.has(s.category || '') &&
                 !ORCHESTRATION_SLUGS.has(s.slug)
          );
          if (filteredSkills.length < uniqueSkills.length) {
            appLogger.debug('[PlannerStage] Cognitive: filtered orchestration skills for direct_task', {
              before: uniqueSkills.map(s => s.slug),
              after: filteredSkills.map(s => s.slug)
            });
          }
          break;

        case 'comparison':
          // Comparison: keep all, but planner already knows it's a comparison
          break;

        case 'memory_question':
        case 'memory_task_replay':
          // Memory: keep only memory skills + tools (no filtering needed — routing handles this)
          break;

        default:
          break;
      }
    }

    return {
      skills: filteredSkills,
      tools: uniqueTools,
      knowledge: uniqueKnowledge
    };
  }

  private deduplicateBySlug(candidates: ResourceCandidate[]): ResourceCandidate[] {
    return [...new Map(candidates.map(c => [c.slug, c])).values()];
  }

  private selectSkillCandidates(): SkillCandidate[] {
    const allSkills = skillsRegistry.getAllSkills({ includeHidden: false });

    // ✅ ALWAYS RETURN ALL SKILLS - Let LLM decide which to use
    // This ensures skills are always available for planner
    return allSkills.map(skill => ({
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      handlerKey: skill.handlerKey,
      category: skill.category,
      tags: skill.tags,
      capabilities: skill.capabilities
    }));
  }

  // ============================================================
  // Validation & Utilities
  // ============================================================

  /**
   * ✅ FIX #5: Validate allowedFastPathResources configuration
   */
  private validateAllowedResources(allowedResources?: string[]): string[] {
    const VALID_RESOURCES = ['skill', 'tool', 'knowledge'];
    
    if (!allowedResources || allowedResources.length === 0) {
      appLogger.debug('[PlannerStage] Fast path disabled via configuration');
      return [];
    }
    
    // Filter out invalid resources
    const valid = allowedResources.filter(r => VALID_RESOURCES.includes(r.toLowerCase()));
    
    if (valid.length !== allowedResources.length) {
      const invalid = allowedResources.filter(r => !VALID_RESOURCES.includes(r.toLowerCase()));
      appLogger.warn('[PlannerStage] Invalid allowedFastPathResources filtered', {
        provided: allowedResources,
        valid: valid,
        invalid: invalid
      });
    }
    
    return valid;
  }

  // ============================================================
  // Fast Path Detection
  // ============================================================

  /**
   * Try fast path for single candidates
   * ✅ OPTIMIZATION: Validate against allowedFastPathResources
   */
  private tryFastPath(candidates: {
    skills: SkillCandidate[];
    tools: ResourceCandidate[];
    knowledge: ResourceCandidate[];
  }, allowedResources: string[]): PlannerOutput | null {
    // ✅ FIX #1: Early exit if allowedResources is empty or disabled
    if (!allowedResources || allowedResources.length === 0) {
      appLogger.debug('[PlannerStage] Fast path disabled (empty allowedResources)');
      return null;
    }

    const { skills, tools, knowledge } = candidates;

    // Single skill
    if (skills.length === 1 && tools.length === 0 && knowledge.length === 0) {
      if (!allowedResources.includes('skill')) {
        appLogger.debug('[PlannerStage] Skill fast path not allowed', {
          allowedResources,
          resourceType: 'skill'
        });
        return null;
      }

      appLogger.debug('[PlannerStage] Single skill -> skip planner', {
        skill: skills[0].slug
      });

      return {
        mode: 'single_step',
        chat: false,
        tasks: [this.buildTask('skill', skills[0].slug, 1)]
      };
    }

    // Single tool
    if (tools.length === 1 && skills.length === 0 && knowledge.length === 0) {
      // ✅ Check if tool is allowed
      if (!allowedResources.includes('tool')) {
        appLogger.debug('[PlannerStage] Tool fast path not allowed', {
          allowedResources,
          resourceType: 'tool'
        });
        return null;
      }
      
      appLogger.debug('[PlannerStage] Single tool → skip planner', {
        tool: tools[0].slug
      });
      
      return {
        mode: 'single_step',
        chat: false,
        tasks: [this.buildTask('tool', tools[0].slug, 1)]
      };
    }

    // Single knowledge
    if (knowledge.length === 1 && skills.length === 0 && tools.length === 0) {
      // ✅ Check if knowledge is allowed
      if (!allowedResources.includes('knowledge')) {
        appLogger.debug('[PlannerStage] Knowledge fast path not allowed', {
          allowedResources,
          resourceType: 'knowledge'
        });
        return null;
      }
      
      appLogger.debug('[PlannerStage] Single knowledge → skip planner', {
        knowledge: knowledge[0].slug
      });
      
      return {
        mode: 'single_step',
        chat: false,
        tasks: [this.buildTask('knowledge', knowledge[0].slug, 1)]
      };
    }

    return null;
  }

  private buildTask(
    resource: 'skill' | 'tool' | 'knowledge',
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
    skills: SkillCandidate[];
    tools: ResourceCandidate[];
    knowledge: ResourceCandidate[];
  }): PlannerOutput {
    const tasks: PlannerTask[] = [];
    let id = 1;

    for (const skill of candidates.skills) {
      tasks.push(this.buildTask('skill', skill.slug, id++));
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
  // Confidence Re-Ranking & Strategy
  // ============================================================
  private async reRankByConfidence(
    tasks: PlannerTask[],
    input: PipelineInput,
    memoryContext: ContextMemory | null
  ): Promise<{
    tasks: PlannerTask[];
    removedTasks: PlannerTask[];
    globalConfidence: number;
    needsClarification: boolean;
    clarificationQuestion?: string;
    strategy: 'execute' | 'clarify' | 'partial';
    meta: { removedInvalidTasks: number };
  }> {
    // ✅ SAFE: Check for undefined context
    if (!input) {
      appLogger.warn('[PlannerStage] No context available, skipping context boost');
      
      // Return tasks without context boost
      const globalConfidence = this.calculateGlobalConfidence(tasks);
      
      return {
        tasks,
        removedTasks: [],
        globalConfidence,
        needsClarification: false,
        clarificationQuestion: undefined,
        strategy: 'execute',
        meta: { removedInvalidTasks: 0 }
      };
    }
    
    const removedTasks: PlannerTask[] = [];
    const filteredTasks: PlannerTask[] = [];

    // Step 1: Filter by confidence threshold
    for (const task of tasks) {
      // ✅ CRITICAL FIX: Default to TASK_CONFIDENCE_MEDIUM, not 1.0
      const confidence = task.confidence ?? TASK_CONFIDENCE_MEDIUM;

      if (confidence >= TASK_CONFIDENCE_HIGH) {
        // ✅ HIGH: Keep directly
        filteredTasks.push(task);
      } else if (confidence >= TASK_CONFIDENCE_MEDIUM) {
        // ⚠️ MEDIUM: Apply context boost
        const contextBoost = await this.calculateContextBoost(task, input, memoryContext);
        const adjustedConfidence = Math.min(1.0, confidence + contextBoost);

        task.confidence = adjustedConfidence;  // Update with adjusted confidence

        // Keep if boosted to acceptable level
        if (adjustedConfidence >= TASK_CONFIDENCE_MEDIUM) {
          filteredTasks.push(task);
        } else {
          removedTasks.push(task);
          appLogger.debug('[PlannerStage] Low confidence task removed', {
            task: task.key,
            originalConfidence: confidence,
            contextBoost: contextBoost,
            adjustedConfidence: adjustedConfidence,
            threshold: TASK_CONFIDENCE_MEDIUM
          });
        }
      } else {
        // ❌ LOW: Remove
        removedTasks.push(task);
        appLogger.debug('[PlannerStage] Low confidence task removed', {
          task: task.key,
          confidence: confidence,
          threshold: TASK_CONFIDENCE_MEDIUM
        });
      }
    }

    // Step 2: Calculate global confidence with weighted penalty
    const globalConfidence = this.calculateGlobalConfidence(filteredTasks);

    // Step 3: Determine strategy
    const strategy = this.determineStrategy(
      filteredTasks,
      removedTasks,
      tasks.length,  // original count
      globalConfidence
    );

    // Step 4: Build clarification question if needed
    let clarificationQuestion: string | undefined;
    const needsClarification = strategy === 'clarify';

    if (needsClarification) {
      clarificationQuestion = await this.buildClarificationQuestion(
        filteredTasks,
        removedTasks
      );
    }

    return {
      tasks: filteredTasks,
      removedTasks,
      globalConfidence,
      needsClarification,
      clarificationQuestion,
      strategy,
      meta: {
        removedInvalidTasks: removedTasks.length
      }
    };
  }

  /**
   * ✅ Calculate context boost for medium confidence tasks
   * ✅ FIX #1: Correct episodic memory lookup params
   */
  private async calculateContextBoost(
    task: PlannerTask,
    input: PipelineInput,
    memoryContext: ContextMemory | null
  ): Promise<number> {
    let boost = 0.0;

    // Episodic memory boost: +10%
    if (memoryContext?.episodicMemory) {
      // ✅ FIX: Use user_id and app_name, NOT agent.id and task.key
      const recentUsage = await episodicMemoryService.getToolUsageHints(
        input.user_id,    // ✅ CORRECT
        input.app_name    // ✅ CORRECT
      );
      
      // Check if this specific tool was used recently
      const toolUsedRecently = recentUsage?.tasks?.some(
        (t: any) => t.key === task.key && t.resource === task.resource
      );
      
      if (toolUsedRecently) {
        boost += 0.10;
        appLogger.debug('[PlannerStage] Episodic memory boost', {
          task: task.key,
          boost: 0.10,
          userId: input.user_id,
          appName: input.app_name
        });
      }
    }

    // Working memory boost: +15%
    if (memoryContext?.workingMemory?.activeTool === task.key) {
      boost += 0.15;
      appLogger.debug('[PlannerStage] Working memory boost', {
        task: task.key,
        boost: 0.15
      });
    }

    // Cap at 20% total boost
    return Math.min(boost, 0.20);
  }

  /**
   * ✅ Calculate global confidence with weighted penalty
   * Formula: (average * 0.7) + (minimum * 0.3)
   */
  private calculateGlobalConfidence(tasks: PlannerTask[]): number {
    if (tasks.length === 0) return 0.0;

    const confidences = tasks.map(t => t.confidence ?? 1.0);

    // ✅ Weighted penalty: average (70%) + minimum (30%)
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const min = Math.min(...confidences);

    const globalConfidence = avg * 0.7 + min * 0.3;

    appLogger.debug('[PlannerStage] Global confidence calculated', {
      taskCount: tasks.length,
      confidences,
      average: avg,
      minimum: min,
      weightedGlobal: globalConfidence
    });

    return Math.max(0.0, Math.min(1.0, globalConfidence));
  }

  /**
   * ✅ Determine execution strategy based on confidence and filtering
   */
  private determineStrategy(
    filteredTasks: PlannerTask[],
    removedTasks: PlannerTask[],
    originalTaskCount: number,
    globalConfidence: number
  ): 'execute' | 'clarify' | 'partial' {
    // CLARIFY: No valid tasks or very low confidence
    if (filteredTasks.length === 0 || globalConfidence < PLAN_CONFIDENCE_LOW) {
      return 'clarify';
    }

    // CLARIFY: Majority removed
    if (removedTasks.length > originalTaskCount / 2) {
      return 'clarify';
    }

    // EXECUTE: All tasks kept and high confidence
    if (removedTasks.length === 0 && globalConfidence >= PLAN_CONFIDENCE_HIGH) {
      return 'execute';
    }

    // PARTIAL: Some tasks removed but still have valid tasks
    if (removedTasks.length > 0 && filteredTasks.length > 0) {
      return 'partial';
    }

    // Default to execute
    return 'execute';
  }

  /**
   * ✅ Build clarification question
   * ✅ ISSUE #6: Dynamic descriptions from repositories
   */
  private async buildClarificationQuestion(
    filteredTasks: PlannerTask[],
    removedTasks: PlannerTask[]
  ): Promise<string> {
    if (removedTasks.length > 1) {
      return 'Saya menemukan beberapa kemungkinan tindakan. Mana yang Anda maksud?';
    }

    if (removedTasks.length === 1) {
      const description = await this.getTaskDescription(removedTasks[0]);
      return `Apakah Anda ingin saya ${description}?`;
    }

    return 'Maaf, saya tidak yakin apa yang Anda maksud. Bisa jelaskan lebih detail?';
  }

  /**
   * ✅ Get task description dynamically from repositories
   * ✅ ISSUE #6: No more hardcoded descriptions
   */
  private async getTaskDescription(task: PlannerTask): Promise<string> {
    try {
      // Handler → intent repository
      if (task.resource === 'skill') {
        const skill = skillsRegistry.getSkillBySlug(task.key);
        return skill?.description || `menjalankan skill ${task.key}`;
      }
      
      // Tool → tools service
      if (task.resource === 'tool') {
        const tools = await toolService.getToolsBySlugs([task.key]);
        return tools[0]?.description || `mengakses ${task.key}`;
      }
      
      // Knowledge → knowledge service (if exists)
      if (task.resource === 'knowledge') {
        // Fallback for knowledge
        return `mencari ${task.key}`;
      }
      
      return `melakukan ${task.key}`;
    } catch (error) {
      appLogger.debug('[PlannerStage] Failed to get task description', {
        task: task.key,
        resource: task.resource,
        error: error instanceof Error ? error.message : error
      });
      return `melakukan ${task.key}`;
    }
  }

  // ============================================================
  // LLM Planner
  // ============================================================

  private async callPlanner(
    candidates: {
      skills: SkillCandidate[];
      tools: ResourceCandidate[];
      knowledge: ResourceCandidate[];
    },
    input: PipelineInput,
    memoryContext: ContextMemory | null,
    timeout: number,
    skillSignal?: SkillSignal,
    perceptionFrame?: import('../../../types/perception.types').PerceptionFrame | null
  ): Promise<PlannerOutput> {
    appLogger.debug('[PlannerStage] Multiple candidates → calling planner');

    const plan = await withTimeout(
      toolPlannerService.plan({
        input,
        candidates: {
          skills: candidates.skills.map(s => s.slug),
          tools: candidates.tools.map(t => t.slug),
          knowledge: candidates.knowledge.map(k => k.slug),
          skillsDetails: candidates.skills,
          toolsDetails: candidates.tools,
          knowledgeDetails: candidates.knowledge
        },
        episodicMemory: memoryContext?.episodicMemory,
        skillSignal,
        perceptionFrame
      },
      {
        includeReasoning: false,
        includeConfidence: true,
        includeClarification: true
      }
      ),
      timeout,
      'toolPlannerService.plan'
    );

    appLogger.debug('[PlannerStage] Planner returned plan', { plan });

    if (plan.chat === true && (!plan.tasks || plan.tasks.length === 0)) {
      return {
        ...plan,
        tasks: [],
        chat: true,
        confidence: plan.confidence ?? 0.5,
        needsClarification: false,
        clarificationQuestion: undefined,
        strategy: undefined,
        meta: {
          ...plan.meta,
          removedInvalidTasks: 0
        }
      };
    }

    // ✅ Apply confidence re-ranking
    const repairedPlan = this.repairDataSkillDependencies(plan);
    if (repairedPlan !== plan) {
      appLogger.info('[PlannerStage] Data skill dependencies repaired', {
        originalMode: plan.mode,
        repairedMode: repairedPlan.mode,
        tasks: repairedPlan.tasks.map(task => ({
          id: task.id,
          resource: task.resource,
          key: task.key,
          depends_on: task.depends_on
        }))
      });
    }

    const reRankedResult = await this.reRankByConfidence(repairedPlan.tasks, input, memoryContext);

    appLogger.info('[PlannerStage] Confidence re-ranking completed', {
      originalTasks: repairedPlan.tasks.length,
      filteredTasks: reRankedResult.tasks.length,
      removedTasks: reRankedResult.removedTasks.length,
      globalConfidence: reRankedResult.globalConfidence,
      strategy: reRankedResult.strategy,
      needsClarification: reRankedResult.needsClarification
    });

    // Build final output
    return {
      ...repairedPlan,
      tasks: reRankedResult.tasks,
      confidence: reRankedResult.globalConfidence,
      needsClarification: reRankedResult.needsClarification,
      clarificationQuestion: reRankedResult.clarificationQuestion,
      strategy: reRankedResult.strategy,
      meta: {
        ...repairedPlan.meta,
        ...reRankedResult.meta
      }
    };
  }

  private repairDataSkillDependencies(plan: PlannerOutput): PlannerOutput {
    if (!plan.tasks || plan.tasks.length < 2) return plan;

    const tasks = plan.tasks.map(task => ({
      ...task,
      depends_on: Array.isArray(task.depends_on) ? [...task.depends_on] : []
    }));
    let repaired = false;

    for (const task of tasks) {
      if (task.resource !== 'skill' || task.depends_on.length > 0) continue;
      if (!this.skillRequiresData(task.key)) continue;

      const toolIds = tasks
        .filter(candidate => candidate.resource === 'tool' && candidate.id !== task.id)
        .map(candidate => candidate.id);

      if (toolIds.length === 0) continue;

      task.depends_on = toolIds;
      repaired = true;
    }

    if (!repaired) return plan;

    return {
      ...plan,
      mode: 'multi_step',
      tasks,
      meta: {
        ...plan.meta,
        repaired: true
      }
    };
  }

  private skillRequiresData(skillSlug: string): boolean {
    const skill = skillsRegistry.getSkillBySlug(skillSlug);
    if (!skill) return false;
    if (skill.capabilities?.requiresData === true) return true;
    return (skill.paramSchema || []).some(param => param.name === 'data' && param.isRequired);
  }
}




