import { vectorService } from '../../vector.service';
import type { Intent, IntentMatch } from '../../../types';
import type { Agent } from '../../../types/agent.types';
import type { UserMessageSignals } from '../../query-decomposition.service';
import { appLogger } from '../../../utils/logger.util';
import { config } from '../../../config';

// ============================================================
// Types
// ============================================================

export interface IntentMatchingOptions {
  topK?: number;
  signals?: UserMessageSignals;
}

// ============================================================
// IntentMatchingStage
// ============================================================

/**
 * IntentMatchingStage - Matches query embeddings against intent vectors
 * 
 * Responsibilities:
 * - Vector similarity search
 * - Apply signal boosts
 * - Return ranked matches
 */
export class IntentMatchingStage {
  /**
   * Execute intent matching
   * 
   * @param embedding - Query embedding vector
   * @param intents - Available intents to match against
   * @param agent - Agent context
   * @param options - Optional configuration
   * @returns Ranked intent matches
   */
  async execute(
    embedding: number[],
    intents: Intent[],
    agent: Agent,
    options?: IntentMatchingOptions
  ): Promise<IntentMatch[]> {
    // Use config topK with option override
    const topK = options?.topK ?? config.intent.topK; // Default: 3 from config
    const signals = options?.signals;

    try {
      // Vector similarity search
      const matches = await vectorService.findIntent(
        embedding,
        intents,
        agent,
        topK
      );

      // Apply signal boosts if provided
      if (signals && matches.length > 0) {
        const boostedMatches = this.applySignalBoost(matches, signals);
        return boostedMatches;
      }

      return matches;

    } catch (error) {
      appLogger.error('IntentMatchingStage: Vector matching failed', {
        error: error instanceof Error ? error.message : error,
        embeddingLength: embedding.length,
        intentCount: intents.length
      });
      return [];
    }
  }

  /**
   * Apply signal-based score boosts to matches
   */
  private applySignalBoost(
    matches: IntentMatch[],
    signals: UserMessageSignals
  ): IntentMatch[] {
    const BOOST_MULTIPLIER = 1.15;
    const MAX_SCORE = 1.0;

    const actionHints = signals.actionHints || [];
    const formatHints = signals.formatHints || [];

    return matches.map(match => {
      let boostFactor = 1.0;
      const appliedBoosts: string[] = [];

      const intentSlug = match.intent.slug.toLowerCase();

      // Format-based boosts
      if (formatHints.length > 0 && (formatHints.includes('xlsx') || formatHints.includes('csv'))) {
        if (intentSlug.includes('xls') || intentSlug.includes('excel') || intentSlug.includes('export')) {
          boostFactor *= BOOST_MULTIPLIER;
          appliedBoosts.push(`format:${formatHints.join(',')}`);
        }
      }

      // File-related boosts
      if (signals.asksForFile) {
        if (intentSlug.includes('xls') || intentSlug.includes('export') || intentSlug.includes('download')) {
          boostFactor *= BOOST_MULTIPLIER;
          appliedBoosts.push('asksForFile');
        }
      }

      // Action-based boosts
      if (actionHints.includes('buat') || actionHints.includes('generate')) {
        if (intentSlug.includes('xls') || intentSlug.includes('generator') || intentSlug.includes('export')) {
          boostFactor *= BOOST_MULTIPLIER;
          appliedBoosts.push('action:generate');
        }
      }

      // Apply boost and cap at 1.0
      const boostedScore = Math.min(match.score * boostFactor, MAX_SCORE);

      if (appliedBoosts.length > 0) {
        appLogger.debug('IntentMatchingStage: Boost applied', {
          intentSlug: match.intent.slug,
          originalScore: match.score,
          boostedScore,
          appliedBoosts
        });
      }

      return {
        ...match,
        score: boostedScore
      };
    });
  }
}
