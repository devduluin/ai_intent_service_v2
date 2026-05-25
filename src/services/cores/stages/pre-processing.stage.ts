import { queryDecompositionService, type UserMessageSignals } from '../../query-decomposition.service';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface PreProcessingResult {
  text: string;
  hasMultipleIntents: boolean;
  subQueries: string[];
  connectors: string[];
  reason: string;
  confidence: number;
  signals: UserMessageSignals;
}

export interface PreProcessingOptions {
  timeout?: number;
}

// ============================================================
// PreProcessingStage
// ============================================================

/**
 * PreProcessingStage - Handles query decomposition and signal extraction
 * 
 * Responsibilities:
 * - Query decomposition (multi-intent detection)
 * - Signal extraction (actions, formats, temporal, entities)
 * - Text normalization
 */
export class PreProcessingStage {
  /**
   * Execute pre-processing on input text
   * 
   * @param text - The input text to preprocess
   * @param options - Optional configuration
   * @returns PreProcessingResult with decomposed query and signals
   */
  async execute(
    text: string,
    options?: PreProcessingOptions
  ): Promise<PreProcessingResult> {
    try {
      const decomposition = queryDecompositionService.decompose(text);

      return {
        text: decomposition.normalizedQuery || decomposition.originalQuery,
        hasMultipleIntents: decomposition.hasMultipleIntents,
        subQueries: decomposition.subQueries,
        connectors: decomposition.connectors,
        reason: decomposition.reason,
        confidence: decomposition.confidence,
        signals: {
          actionHints: decomposition.signals.actionHints,
          formatHints: decomposition.signals.formatHints,
          temporalHints: decomposition.signals.temporalHints,
          temporalDetails: decomposition.signals.temporalDetails,
          entityHints: decomposition.signals.entityHints,
          asksForFile: decomposition.signals.asksForFile,
          asksForRealtimeData: decomposition.signals.asksForRealtimeData,
          isQuestion: decomposition.signals.isQuestion,
          language: decomposition.signals.language
        }
      };

    } catch (error) {
      appLogger.error('PreProcessingStage: Query decomposition failed', {
        error: error instanceof Error ? error.message : error,
        textLength: text.length
      });

      // Fallback to original text
      return {
        text,
        hasMultipleIntents: false,
        subQueries: [text],
        connectors: [],
        reason: 'fallback_original',
        confidence: 0,
        signals: {
          actionHints: [],
          formatHints: [],
          temporalHints: [],
          temporalDetails: [],
          entityHints: [],
          asksForFile: false,
          asksForRealtimeData: false,
          isQuestion: false,
          language: 'id'
        }
      };
    }
  }
}
