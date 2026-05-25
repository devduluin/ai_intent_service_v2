import type { UserMessageSignals } from '../../query-decomposition.service';

/**
 * SignalValidator - Validates user message signals
 * 
 * Responsible for:
 * - Checking for required signals
 * - Validating temporal details format
 * - Ensuring signal consistency
 */
export class SignalValidator {
  /**
   * Validate signals structure and content
   */
  validateSignals(signals: UserMessageSignals): boolean {
    if (!signals) {
      return false;
    }

    // Check required arrays exist
    if (!Array.isArray(signals.actionHints)) {
      return false;
    }
    if (!Array.isArray(signals.formatHints)) {
      return false;
    }
    if (!Array.isArray(signals.temporalHints)) {
      return false;
    }
    if (!Array.isArray(signals.entityHints)) {
      return false;
    }

    // Validate temporalDetails if present
    if (signals.temporalDetails && signals.temporalDetails.length > 0) {
      for (const detail of signals.temporalDetails) {
        if (!detail.type || !detail.value) {
          return false;
        }
      }
    }

    // Validate language
    if (signals.language && !['id', 'en', 'unknown'].includes(signals.language)) {
      return false;
    }

    return true;
  }

  /**
   * Check if signals indicate a realtime data request
   */
  isRealtimeRequest(signals: UserMessageSignals): boolean {
    return signals.asksForRealtimeData === true;
  }

  /**
   * Check if signals indicate a file generation request
   */
  isFileRequest(signals: UserMessageSignals): boolean {
    return signals.asksForFile === true;
  }

  /**
   * Check if signals have action hints
   */
  hasActionHints(signals: UserMessageSignals): boolean {
    return Array.isArray(signals.actionHints) && signals.actionHints.length > 0;
  }

  /**
   * Check if signals have format hints
   */
  hasFormatHints(signals: UserMessageSignals): boolean {
    return Array.isArray(signals.formatHints) && signals.formatHints.length > 0;
  }

  /**
   * Check if signals have temporal details
   */
  hasTemporalDetails(signals: UserMessageSignals): boolean {
    return Array.isArray(signals.temporalDetails) && signals.temporalDetails.length > 0;
  }

  /**
   * Check if signals have entity hints
   */
  hasEntityHints(signals: UserMessageSignals): boolean {
    return Array.isArray(signals.entityHints) && signals.entityHints.length > 0;
  }

  /**
   * Validate temporal details format
   * 
   * Expected format:
   * - type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative'
   * - value: string (original text)
   * - normalizedValue: string (resolved value)
   */
  validateTemporalDetails(temporalDetails: Array<{
    type: string;
    value: string;
    normalizedValue?: string;
  }>): boolean {
    if (!temporalDetails || temporalDetails.length === 0) {
      return true; // Empty is valid
    }

    const validTypes = ['day', 'week', 'month', 'year', 'quarter', 'period', 'date', 'relative'];

    for (const detail of temporalDetails) {
      if (!detail.type || !detail.value) {
        return false;
      }

      if (!validTypes.includes(detail.type)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if signals are consistent
   * 
   * Examples of inconsistencies:
   * - asksForFile but no format hints
   * - asksForRealtimeData but action hints suggest static operation
   */
  isConsistent(signals: UserMessageSignals): boolean {
    // If asks for file, should have format hints or file-related action
    if (signals.asksForFile) {
      const hasFormatOrFileAction = 
        this.hasFormatHints(signals) ||
        signals.actionHints?.some(a => 
          a.toLowerCase().includes('export') || 
          a.toLowerCase().includes('download') ||
          a.toLowerCase().includes('generate')
        ) || false;

      if (!hasFormatOrFileAction) {
        // Not necessarily invalid, but worth noting
        // Could log a warning here
      }
    }

    return true;
  }
}
