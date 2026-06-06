import type { UserMessageSignals } from './query-decomposition.service';
import type { ComparisonTemporalDetail } from '../types/comparison.types';
import { formatDateToISO } from '../utils/temporal/temporal-expression-parser.util';

export interface ComparisonTemporalSplitResult {
  baselineTemporalDetails: ComparisonTemporalDetail[];
  targetTemporalDetails: ComparisonTemporalDetail[];
  strategy: 'position' | 'first_last' | 'working_memory_target' | 'ambiguous';
  isAmbiguous: boolean;
  reason?: string;
}

class ComparisonTemporalSplitterService {
  split(
    query: string,
    temporalDetails: NonNullable<UserMessageSignals['temporalDetails']> = [],
    comparisonSignal?: UserMessageSignals['comparison']
  ): ComparisonTemporalSplitResult {
    const details = this.normalizeTemporalDetails(temporalDetails);

    if (comparisonSignal?.baseline?.source === 'working_memory' && details.length < 2) {
      return {
        baselineTemporalDetails: [],
        targetTemporalDetails: this.normalizeTemporalDetails(
          comparisonSignal.target?.temporalDetails || temporalDetails
        ),
        strategy: 'working_memory_target',
        isAmbiguous: false
      };
    }

    if (
      details.length === 1 &&
      comparisonSignal?.baseline?.source === 'current_query' &&
      details[0]?.direction !== 'current' &&
      this.hasCurrentBaselineHint(query)
    ) {
      return {
        baselineTemporalDetails: [this.buildCurrentDateDetail()],
        targetTemporalDetails: details,
        strategy: 'first_last',
        isAmbiguous: false
      };
    }

    if (details.length < 2) {
      return {
        baselineTemporalDetails: details.slice(0, 1),
        targetTemporalDetails: [],
        strategy: 'ambiguous',
        isAmbiguous: true,
        reason: 'Standalone comparison needs baseline and target temporal expressions'
      };
    }

    const positioned = this.positionTemporalDetails(query, details);
    const splitIndex = this.findComparisonBoundary(query);

    if (splitIndex >= 0) {
      const baseline = positioned
        .filter(item => item.index >= 0 && item.index < splitIndex)
        .map(item => item.detail);
      const target = positioned
        .filter(item => item.index >= splitIndex)
        .map(item => item.detail);

      if (baseline.length > 0 && target.length > 0) {
        return {
          baselineTemporalDetails: baseline,
          targetTemporalDetails: target,
          strategy: 'position',
          isAmbiguous: false
        };
      }
    }

    return {
      baselineTemporalDetails: [details[0]],
      targetTemporalDetails: [details[details.length - 1]],
      strategy: 'first_last',
      isAmbiguous: false
    };
  }

  private normalizeTemporalDetails(
    temporalDetails: NonNullable<UserMessageSignals['temporalDetails']>
  ): ComparisonTemporalDetail[] {
    return temporalDetails.map(detail => ({
      type: detail.type,
      value: detail.value,
      normalizedValue: detail.normalizedValue,
      direction: detail.direction
    }));
  }

  private positionTemporalDetails(
    query: string,
    details: ComparisonTemporalDetail[]
  ): Array<{ detail: ComparisonTemporalDetail; index: number }> {
    const normalizedQuery = this.normalize(query);

    return details
      .map((detail, order) => ({
        detail,
        index: this.findTemporalIndex(normalizedQuery, detail, order)
      }))
      .sort((left, right) => {
        if (left.index < 0 && right.index < 0) return 0;
        if (left.index < 0) return 1;
        if (right.index < 0) return -1;
        return left.index - right.index;
      });
  }

  private findTemporalIndex(
    normalizedQuery: string,
    detail: ComparisonTemporalDetail,
    fallbackOrder: number
  ): number {
    const candidates = [
      detail.value,
      detail.normalizedValue
    ]
      .filter((value): value is string => !!value)
      .map(value => this.normalize(value));

    for (const candidate of candidates) {
      const index = normalizedQuery.indexOf(candidate);
      if (index >= 0) {
        return index;
      }
    }

    return -1 - fallbackOrder;
  }

  private findComparisonBoundary(query: string): number {
    const normalized = this.normalize(query);
    const patterns = [
      /\b(dan\s+)?(bandingkan|dibandingkan|compare)\s+(dengan\s+)?/i,
      /\b(vs|versus)\b/i,
      /\b(selisih|beda|perbedaan|difference)\s+(dengan\s+)?/i,
      /\b(trend|tren)\s+(dengan\s+)?/i
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.index !== undefined) {
        return match.index + match[0].length;
      }
    }

    return -1;
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/[?.,;:!]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildCurrentDateDetail(): ComparisonTemporalDetail {
    return {
      type: 'date',
      value: 'hari ini',
      normalizedValue: formatDateToISO(new Date()),
      direction: 'current'
    };
  }

  private hasCurrentBaselineHint(query: string): boolean {
    const normalized = this.normalize(query);
    return /\b(hari ini|today|sekarang|saat ini|current)\b/i.test(normalized);
  }
}

export const comparisonTemporalSplitterService = new ComparisonTemporalSplitterService();
export { ComparisonTemporalSplitterService };
