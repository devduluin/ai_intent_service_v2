import { config } from '../config';
import { appLogger } from '../utils/logger.util';
import { isUserProfileQuestionText } from '../utils/user-profile-statement.util';
import { openAiService } from './openAi.service';
import { ollamaService } from './ollama.service';
import type { SkillSignal, SkillSignalCandidate } from './skill-signal.service';
import type { PerceptionFrame, PerceptionIntentType } from '../types/perception.types';
import type { UserMessageSignals } from './query-decomposition.service';

export interface PerceptionDisambiguationInput {
  text: string;
  skillSignal?: SkillSignal;
  perceptionFrame?: PerceptionFrame | null;
  signals?: UserMessageSignals;
}

export interface PerceptionDisambiguationResult {
  usedLlm: boolean;
  reason: string;
  selectedSkill?: string;
  selectedFrameType?: PerceptionIntentType;
  confidence?: number;
  skillSignal?: SkillSignal;
  perceptionFrame?: PerceptionFrame | null;
}

interface RouteCandidate {
  skill: string;
  frameType?: PerceptionIntentType;
  confidence: number;
  reason: string;
  source: 'perception' | 'skill_signal' | 'gate';
  matchedText?: string[];
}

class PerceptionDisambiguationService {
  private readonly MIN_LLM_CONFIDENCE = 0.72;

  async refine(input: PerceptionDisambiguationInput): Promise<PerceptionDisambiguationResult> {
    const candidates = this.buildCandidates(input);
    const uniqueCandidates = this.dedupeCandidates(candidates);
    const top = uniqueCandidates[0];
    const second = uniqueCandidates[1];
    const fallback = this.pickDeterministicFallback(uniqueCandidates) || top;

    if (!top) {
      return {
        usedLlm: false,
        reason: 'no_candidates',
        skillSignal: input.skillSignal,
        perceptionFrame: input.perceptionFrame
      };
    }

    if (!this.shouldDisambiguate(uniqueCandidates, input)) {
      return {
        usedLlm: false,
        reason: 'deterministic_confident',
        selectedSkill: top.skill,
        selectedFrameType: top.frameType,
        confidence: top.confidence,
        skillSignal: input.skillSignal,
        perceptionFrame: input.perceptionFrame
      };
    }

    try {
      const decision = await this.askLlm(input.text, uniqueCandidates);
      const selected = uniqueCandidates.find(candidate => candidate.skill === decision.selectedSkill);

      if (!selected || decision.confidence < this.MIN_LLM_CONFIDENCE) {
        appLogger.info('[PerceptionDisambiguation] LLM decision ignored', {
          selectedSkill: decision.selectedSkill,
          confidence: decision.confidence,
          allowed: uniqueCandidates.map(candidate => candidate.skill)
        });

        return {
          usedLlm: true,
          reason: 'llm_low_confidence_or_invalid',
          selectedSkill: fallback.skill,
          selectedFrameType: fallback.frameType,
          confidence: fallback.confidence,
          skillSignal: input.skillSignal,
          perceptionFrame: input.perceptionFrame
        };
      }

      const skillSignal = this.rewriteSkillSignal(input.skillSignal, selected, uniqueCandidates);
      const perceptionFrame = this.rewritePerceptionFrame(input.perceptionFrame, selected, decision.confidence, decision.reason);

      appLogger.info('[PerceptionDisambiguation] LLM selected route', {
        text: input.text,
        selectedSkill: selected.skill,
        selectedFrameType: selected.frameType,
        confidence: decision.confidence,
        reason: decision.reason,
        candidates: uniqueCandidates.map(candidate => ({
          skill: candidate.skill,
          frameType: candidate.frameType,
          confidence: candidate.confidence,
          source: candidate.source
        }))
      });

      return {
        usedLlm: true,
        reason: decision.reason || 'llm_selected',
        selectedSkill: selected.skill,
        selectedFrameType: selected.frameType,
        confidence: decision.confidence,
        skillSignal,
        perceptionFrame
      };
    } catch (error) {
      appLogger.warn('[PerceptionDisambiguation] LLM failed, keeping deterministic route', {
        error: error instanceof Error ? error.message : String(error),
        topSkill: top.skill,
        secondSkill: second?.skill
      });

      return {
        usedLlm: false,
        reason: 'llm_failed_deterministic_fallback',
        selectedSkill: fallback.skill,
        selectedFrameType: fallback.frameType,
        confidence: fallback.confidence,
        skillSignal: input.skillSignal,
        perceptionFrame: input.perceptionFrame
      };
    }
  }

  private buildCandidates(input: PerceptionDisambiguationInput): RouteCandidate[] {
    const candidates: RouteCandidate[] = [];

    const frameCandidate = this.candidateFromFrame(input.perceptionFrame);
    if (frameCandidate) candidates.push(frameCandidate);

    for (const candidate of input.skillSignal?.candidates || []) {
      candidates.push({
        skill: candidate.slug,
        frameType: this.frameTypeForSkill(candidate.slug),
        confidence: candidate.confidence,
        reason: `skill_signal:${candidate.matchedBy.join(',')}`,
        source: 'skill_signal',
        matchedText: candidate.matchedText
      });
    }

    if (isUserProfileQuestionText(input.text)) {
      candidates.push({
        skill: 'user_profile_recall',
        frameType: 'direct_task',
        confidence: 0.82,
        reason: 'profile_question_gate',
        source: 'gate'
      });
    }

    return candidates;
  }

  private candidateFromFrame(frame?: PerceptionFrame | null): RouteCandidate | null {
    if (!frame) return null;

    switch (frame.type) {
      case 'memory_question':
      case 'memory_task_replay':
        return {
          skill: 'memory_recall',
          frameType: frame.type,
          confidence: frame.confidence,
          reason: frame.reasoning.join('; '),
          source: 'perception'
        };
      case 'automation_request':
        return {
          skill: 'automation_manager',
          frameType: frame.type,
          confidence: frame.confidence,
          reason: frame.reasoning.join('; '),
          source: 'perception'
        };
      case 'small_talk':
        return {
          skill: 'greeting',
          frameType: frame.type,
          confidence: frame.confidence,
          reason: frame.reasoning.join('; '),
          source: 'perception'
        };
      default:
        return null;
    }
  }

  private dedupeCandidates(candidates: RouteCandidate[]): RouteCandidate[] {
    const bySkill = new Map<string, RouteCandidate>();

    for (const candidate of candidates) {
      const existing = bySkill.get(candidate.skill);
      if (!existing || candidate.confidence > existing.confidence) {
        bySkill.set(candidate.skill, candidate);
      }
    }

    return [...bySkill.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  }

  private shouldDisambiguate(candidates: RouteCandidate[], input: PerceptionDisambiguationInput): boolean {
    if (candidates.length < 2) return false;

    const top = candidates[0];
    const second = candidates[1];
    const gap = top.confidence - second.confidence;
    const hasHighRisk = candidates.some(candidate =>
      ['user_profile_recall', 'automation_manager', 'memory_recall'].includes(candidate.skill)
    );

    if (gap <= 0.16) return true;
    if (hasHighRisk && top.confidence < 0.88) return true;

    const frameSkill = this.candidateFromFrame(input.perceptionFrame)?.skill;
    const signalSkill = input.skillSignal?.recommendedSkill;
    if (frameSkill && signalSkill && frameSkill !== signalSkill) return true;

    return false;
  }

  private pickDeterministicFallback(candidates: RouteCandidate[]): RouteCandidate | null {
    const perceptionCandidate = candidates.find(candidate =>
      candidate.source === 'perception' &&
      candidate.confidence >= 0.65 &&
      ['memory_recall', 'automation_manager', 'greeting'].includes(candidate.skill)
    );

    if (perceptionCandidate) return perceptionCandidate;
    return candidates[0] || null;
  }

  private async askLlm(text: string, candidates: RouteCandidate[]): Promise<{
    selectedSkill: string;
    confidence: number;
    reason: string;
  }> {
    const prompt = [
      'You are a strict route disambiguator for an enterprise AI runtime.',
      'Choose exactly one route from allowed candidates. Do not create a new route.',
      '',
      'Important distinctions:',
      '- memory_recall = user asks about conversation history, previous questions, previous topics, what was discussed/asked today/yesterday.',
      '- user_profile_recall = user asks personal/profile facts such as name, email, company_id, partner, hobby, preference.',
      '- automation_manager = user wants future work, reminders, schedules, monitoring, alerts.',
      '- greeting = greeting, thanks, identity/capability question.',
      '',
      `User text: ${JSON.stringify(text)}`,
      '',
      'Allowed candidates:',
      JSON.stringify(candidates.map(candidate => ({
        skill: candidate.skill,
        frameType: candidate.frameType,
        confidence: candidate.confidence,
        source: candidate.source,
        reason: candidate.reason,
        matchedText: candidate.matchedText || []
      })), null, 2),
      '',
      'Return JSON only:',
      '{"selectedSkill":"one allowed skill","confidence":0.0,"reason":"short reason"}'
    ].join('\n');

    const raw = config.default.provider === 'qwen' || config.default.provider === 'openai'
      ? await openAiService.generateJson(prompt, { temperature: 0, num_predict: 180 })
      : await ollamaService.generateJson(prompt);

    const parsed = JSON.parse(raw);
    return {
      selectedSkill: String(parsed.selectedSkill || parsed.skill || ''),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
      reason: String(parsed.reason || '')
    };
  }

  private rewriteSkillSignal(
    original: SkillSignal | undefined,
    selected: RouteCandidate,
    candidates: RouteCandidate[]
  ): SkillSignal {
    const existingCandidates: SkillSignalCandidate[] = original?.candidates || [];
    const bySlug = new Map(existingCandidates.map(candidate => [candidate.slug, candidate]));

    for (const candidate of candidates) {
      if (!bySlug.has(candidate.skill)) {
        bySlug.set(candidate.skill, {
          slug: candidate.skill,
          name: candidate.skill,
          confidence: candidate.confidence,
          matchedBy: [candidate.source],
          matchedText: candidate.matchedText || [],
        });
      }
    }

    const rewrittenCandidates = [...bySlug.values()]
      .map(candidate => candidate.slug === selected.skill
        ? {
            ...candidate,
            confidence: Math.max(candidate.confidence, selected.confidence, 0.88),
            matchedBy: [...new Set([...candidate.matchedBy, 'llm_disambiguation'])],
          }
        : candidate
      )
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    return {
      hasStrongSignal: true,
      recommendedSkill: selected.skill,
      candidates: rewrittenCandidates
    };
  }

  private rewritePerceptionFrame(
    original: PerceptionFrame | null | undefined,
    selected: RouteCandidate,
    confidence: number,
    reason: string
  ): PerceptionFrame | null | undefined {
    if (!selected.frameType || !this.isFrameSkill(selected.skill)) return original;
    if (original?.type === selected.frameType) {
      return {
        ...original,
        confidence: Math.max(original.confidence, confidence),
        reasoning: [...original.reasoning, `LLM disambiguation: ${reason}`]
      };
    }

    const base = original || {
      operations: this.operationsForSkill(selected.skill),
      reasoning: []
    } as Pick<PerceptionFrame, 'operations' | 'reasoning'>;

    return {
      ...base,
      type: selected.frameType,
      operations: this.operationsForSkill(selected.skill),
      confidence: Math.max(confidence, selected.confidence),
      reasoning: [...(base.reasoning || []), `LLM disambiguation selected ${selected.skill}: ${reason}`],
      target: this.targetForSkill(selected.skill)
    } as PerceptionFrame;
  }

  private frameTypeForSkill(skill: string): PerceptionIntentType | undefined {
    switch (skill) {
      case 'memory_recall':
        return 'memory_question';
      case 'automation_manager':
        return 'automation_request';
      case 'greeting':
        return 'small_talk';
      default:
        return undefined;
    }
  }

  private isFrameSkill(skill: string): boolean {
    return ['memory_recall', 'automation_manager', 'greeting'].includes(skill);
  }

  private operationsForSkill(skill: string): PerceptionFrame['operations'] {
    switch (skill) {
      case 'memory_recall':
        return ['recall'];
      case 'automation_manager':
        return ['schedule', 'notify'];
      case 'greeting':
        return ['clarify'];
      default:
        return ['execute'];
    }
  }

  private targetForSkill(skill: string): PerceptionFrame['target'] {
    switch (skill) {
      case 'memory_recall':
        return { resource: 'memory', kind: 'previous_topic' };
      case 'automation_manager':
        return { resource: 'automation', kind: 'future_task' };
      case 'greeting':
        return { resource: 'skill', key: 'greeting' };
      default:
        return undefined;
    }
  }
}

export const perceptionDisambiguationService = new PerceptionDisambiguationService();
