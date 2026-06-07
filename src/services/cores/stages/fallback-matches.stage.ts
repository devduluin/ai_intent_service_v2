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

    const ranked = (input.intents || [])
      .filter(intent => this.isUsableIntent(intent, input.agent))
      .map(intent => ({
        intent,
        rank: this.rankIntent(intent, input.signals, input.userText),
        lexicalScore: this.lexicalOverlapScore(intent, input.userText)
      }))
      .sort((a, b) => b.rank - a.rank);

    const hasStrongLexicalMatch = ranked.some(item => item.lexicalScore >= 0.35);
    const selected = (hasStrongLexicalMatch
      ? ranked.filter(item => item.lexicalScore >= 0.25).slice(0, Math.min(maxMatches, 6))
      : ranked.slice(0, maxMatches));

    const candidates = selected
      .slice(0, maxMatches)
      .map(item => ({
        intent: item.intent,
        score: Math.min(0.95, score + (item.lexicalScore >= 0.35 ? 0.1 : 0)),
        metadata: {
          fallbackReason: 'vector_no_matches',
          originalQuery: input.userText,
          source: 'planner_candidate_fallback',
          lexicalScore: item.lexicalScore,
          rank: item.rank
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

  private rankIntent(intent: Intent, signals: UserMessageSignals, userText: string): number {
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

    const lexicalScore = this.lexicalOverlapScore(intent, userText);
    if (lexicalScore > 0) {
      rank += lexicalScore * 12;
      if (lexicalScore >= 0.35) rank += 8;
    }

    return rank;
  }

  private lexicalOverlapScore(intent: Intent, userText: string): number {
    const queryTokens = this.tokenize(userText);
    if (queryTokens.length === 0) return 0;

    const intentTokens = new Set(this.tokenize(this.intentText(intent)));
    if (intentTokens.size === 0) return 0;

    const matched = queryTokens.filter(token => intentTokens.has(token));
    return matched.length / queryTokens.length;
  }

  private tokenize(text: string): string[] {
    const stopwords = new Set([
      'apa', 'itu', 'ini', 'yang', 'dan', 'atau', 'saya', 'anda', 'kamu',
      'jelaskan', 'bagaimana', 'jika', 'kalau', 'tidak', 'bisa', 'mohon',
      'tolong', 'please', 'what', 'is', 'the', 'my', 'your', 'me'
    ]);

    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9_@\.\-\s]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !stopwords.has(token));
  }

  private intentText(intent: Intent): string {
    const examples = (intent.examples || []).map((example: any) =>
      typeof example === 'string' ? example : String(example?.text || '')
    );

    return [
      intent.slug,
      intent.name,
      intent.description,
      ...examples
    ].filter(Boolean).join(' ');
  }
}
