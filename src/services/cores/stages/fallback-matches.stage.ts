import type { Agent } from '../../../types/agent.types';
import type { Intent, IntentMatch } from '../../../types';
import type { UserMessageSignals } from '../../query-decomposition.service';
import { appLogger } from '../../../utils/logger.util';

export interface FallbackMatchesStageOptions {
  maxMatches?: number;
  score?: number;
}

export interface FallbackMatchesStageInput {
  intents: Intent[];
  agent: Agent;
  userText: string;
  signals: UserMessageSignals;
  options?: FallbackMatchesStageOptions;
}

const DEFAULT_MAX_MATCHES = 25;
const DEFAULT_FALLBACK_SCORE = 0.76;

export class FallbackMatchesStage {
  execute(input: FallbackMatchesStageInput): IntentMatch[] {
    const maxMatches = input.options?.maxMatches ?? DEFAULT_MAX_MATCHES;
    const score = input.options?.score ?? DEFAULT_FALLBACK_SCORE;

    const candidates = (input.intents || [])
      .filter(intent => this.isUsableIntent(intent, input.agent))
      .sort((a, b) => this.rankIntent(b, input.signals) - this.rankIntent(a, input.signals))
      .slice(0, maxMatches)
      .map(intent => ({
        intent,
        score,
        metadata: {
          fallbackReason: 'vector_no_matches',
          originalQuery: input.userText,
          source: 'planner_candidate_fallback'
        }
      }));

    appLogger.info('[FallbackMatchesStage] Built planner fallback candidates', {
      userTextLength: input.userText.length,
      agentId: input.agent.id,
      totalIntents: input.intents?.length || 0,
      candidateCount: candidates.length,
      maxMatches
    });

    return candidates;
  }

  private isUsableIntent(intent: Intent, agent: Agent): boolean {
    if (!intent) return false;
    if (intent.agentId && agent.id && intent.agentId !== agent.id) return false;
    if (intent.slug === 'general_chat') return false;

    const toolCount = intent.tools?.length || 0;
    const knowledgeCount = intent.knowledge?.length || 0;

    return toolCount > 0 || knowledgeCount > 0;
  }

  private rankIntent(intent: Intent, signals: UserMessageSignals): number {
    let rank = 0;

    if (intent.tools?.length) rank += 10;
    if (intent.knowledge?.length) rank += 6;

    if (signals.asksForFile) {
      const text = this.intentText(intent);
      if (/\b(export|excel|xls|xlsx|csv|download|unduh|file)\b/i.test(text)) {
        rank += 5;
      }
    }

    if (signals.temporalDetails?.length) {
      const hasTemporalParam = intent.tools?.some(mapping => {
        const params = mapping.parameters || mapping.tool?.parameters || [];
        return params.some(param => /date|month|year|period|tanggal|bulan|tahun/i.test(param.name));
      });

      if (hasTemporalParam) rank += 4;
    }

    return rank;
  }

  private intentText(intent: Intent): string {
    return [
      intent.slug,
      intent.name,
      intent.description,
      ...(intent.examples || [])
    ].filter(Boolean).join(' ');
  }
}
