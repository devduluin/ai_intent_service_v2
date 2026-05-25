import type { UserMessageSignals } from '../../query-decomposition.service';

/**
 * TemporalDetailWithDates - Extended type with date objects for injection
 */
export type TemporalDetailWithDates = {
  type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative';
  value: string;
  normalizedValue: string;
  direction?: 'current' | 'past' | 'future';
  startDate?: Date;
  endDate?: Date;
};

/**
 * TemporalInjector - Injects temporal context into parameter objects
 * 
 * Converts temporal details (dates, days, periods) into structured parameters
 * for tool execution with proper date formatting.
 */
export class TemporalInjector {
  /**
   * Inject temporal details into a target parameter object
   * 
   * Format:
   * - { date: "2026-05-25" } for single dates
   * - { dateStart: "2026-05-25", dateEnd: "2026-05-26" } for ranges
   * 
   * @param target - The target parameter object to inject into
   * @param temporalDetails - Array of temporal details from query decomposition
   * @returns The modified target object with injected temporal params
   */
  inject(
    target: Record<string, unknown>,
    temporalDetails: TemporalDetailWithDates[]
  ): Record<string, unknown> {
    if (!temporalDetails || temporalDetails.length === 0) {
      return target;
    }

    temporalDetails.forEach((t) => {
      // Determine the base parameter name
      const paramName = t.type === 'date' || t.type === 'day' ? 'date' : t.type;

      // Inject normalized value as the primary param
      target[paramName] = t.normalizedValue;

      // Inject startDate if available (YYYY-mm-dd format)
      if (t.startDate) {
        target[`${paramName}Start`] = t.startDate.toISOString().split('T')[0];
      }

      // Inject endDate if available (YYYY-mm-dd format)
      if (t.endDate) {
        target[`${paramName}End`] = t.endDate.toISOString().split('T')[0];
      }
    });

    return target;
  }

  /**
   * Inject temporal details into a new object (immutable version)
   * 
   * @param temporalDetails - Array of temporal details
   * @returns A new object with injected temporal params
   */
  injectToNew(temporalDetails: TemporalDetailWithDates[]): Record<string, unknown> {
    return this.inject({}, temporalDetails);
  }
}
