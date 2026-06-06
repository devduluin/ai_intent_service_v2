import type {
  AutomationCondition,
  AutomationConditionEvaluationResult
} from '../../types/automation.types';
import { conditionMetricResolutionService } from './condition-metric-resolution.service';

export class ConditionEvaluatorService {
  async evaluateAsync(
    condition: AutomationCondition | undefined,
    currentResult: unknown,
    previousResult?: unknown
  ): Promise<AutomationConditionEvaluationResult> {
    const heuristic = this.evaluate(condition, currentResult, previousResult);
    if (!condition || this.hasResolvedObservedValue(condition, heuristic)) {
      return heuristic;
    }

    const llmResolution = await conditionMetricResolutionService.resolve({
      condition,
      result: currentResult,
      previousResult
    });

    if (!llmResolution.matched) {
      return {
        ...heuristic,
        reason: `${heuristic.reason} LLM fallback could not resolve metric value.`
      };
    }

    const evaluated = this.evaluate(condition, llmResolution.observedValue, previousResult);
    return {
      ...evaluated,
      observedValue: llmResolution.observedValue,
      reason: `[LLM metric fallback] ${evaluated.reason}${llmResolution.sourcePath ? ` Source: ${llmResolution.sourcePath}.` : ''}`
    };
  }

  evaluate(
    condition: AutomationCondition | undefined,
    currentResult: unknown,
    previousResult?: unknown
  ): AutomationConditionEvaluationResult {
    if (!condition) {
      return {
        shouldRun: true,
        reason: 'No condition configured.'
      };
    }

    const operator = condition.operator;
    if (!operator) {
      return {
        shouldRun: false,
        reason: 'Condition operator is missing.'
      };
    }

    const observedValue = this.extractMetricValue(currentResult, condition.metric);
    if (operator === 'neq' || operator === 'eq') {
      const shouldRun = operator === 'eq'
        ? observedValue === condition.value
        : observedValue !== condition.value;

      return {
        shouldRun,
        reason: `Metric ${condition.metric || 'value'} ${operator} ${String(condition.value)}.`,
        observedValue
      };
    }

    if (operator === 'change_percent') {
      const current = Number(observedValue);
      const previous = Number(this.extractMetricValue(previousResult, condition.metric));
      const targetChange = Number(condition.value);

      if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0 || !Number.isFinite(targetChange)) {
        return {
          shouldRun: false,
          reason: 'Percentage change condition cannot be evaluated from available values.',
          observedValue
        };
      }

      const change = ((current - previous) / Math.abs(previous)) * 100;
      return {
        shouldRun: targetChange < 0 ? change <= targetChange : change >= targetChange,
        reason: `Metric changed by ${change.toFixed(2)}%.`,
        observedValue: change
      };
    }

    if (operator === 'increase_percent' || operator === 'decrease_percent') {
      const pair = this.extractComparisonMetricPair(currentResult, condition.metric);
      const targetChange = Math.abs(Number(condition.value));

      if (!pair || !Number.isFinite(targetChange) || pair.baseline === 0) {
        return {
          shouldRun: false,
          reason: 'Comparison percentage condition cannot be evaluated from available comparison values.',
          observedValue
        };
      }

      const change = ((pair.target - pair.baseline) / Math.abs(pair.baseline)) * 100;
      const shouldRun = operator === 'increase_percent'
        ? change >= targetChange
        : change <= -targetChange;

      return {
        shouldRun,
        reason: `Metric ${condition.metric || pair.metric || 'value'} changed by ${change.toFixed(2)}%.`,
        observedValue: change
      };
    }

    const numericObserved = Number(observedValue);
    const numericTarget = Number(condition.value);
    if (!Number.isFinite(numericObserved) || !Number.isFinite(numericTarget)) {
      return {
        shouldRun: false,
        reason: 'Numeric condition cannot be evaluated from available values.',
        observedValue
      };
    }

    const shouldRun = operator === 'gt'
      ? numericObserved > numericTarget
      : operator === 'gte'
        ? numericObserved >= numericTarget
        : operator === 'lt'
          ? numericObserved < numericTarget
          : operator === 'lte'
            ? numericObserved <= numericTarget
            : false;

    return {
      shouldRun,
      reason: `Metric ${condition.metric || 'value'} ${operator} ${numericTarget}.`,
      observedValue
    };
  }

  private extractMetricValue(result: unknown, metric?: string): unknown {
    if (typeof result === 'number' || typeof result === 'string' || typeof result === 'boolean') {
      return result;
    }
    if (!result || typeof result !== 'object') return undefined;
    if (!metric) return this.findBestNumericValue(result);

    const segments = metric.split('.').filter(Boolean);
    let cursor: any = result;
    for (const segment of segments) {
      if (!cursor || typeof cursor !== 'object' || !(segment in cursor)) {
        return this.findNumericValueByKey(result, metric);
      }
      cursor = cursor[segment];
    }

    if (typeof cursor === 'number') return cursor;
    const nested = this.findBestNumericValue(cursor);
    if (nested !== undefined) return nested;

    return this.findNumericValueByKey(result, metric) ?? cursor;
  }

  private findNumericValueByKey(result: unknown, metric: string): number | undefined {
    const normalizedMetric = this.normalizeKey(metric);
    const queue: unknown[] = [result];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;

      if (Array.isArray(current)) {
        for (const item of current) queue.push(item);
        continue;
      }

      for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
        const normalizedKey = this.normalizeKey(key);
        if (
          normalizedKey === normalizedMetric ||
          normalizedKey.includes(normalizedMetric) ||
          normalizedMetric.includes(normalizedKey)
        ) {
          if (typeof value === 'number') return value;
          const nested = this.findBestNumericValue(value);
          if (nested !== undefined) return nested;
        }

        if (value && typeof value === 'object') queue.push(value);
      }
    }

    return undefined;
  }

  private extractComparisonMetricPair(
    result: unknown,
    metric?: string
  ): { baseline: number; target: number; metric?: string } | null {
    const candidates = this.collectComparisonCandidates(result);

    for (const candidate of candidates) {
      const baselineValue = Number(this.extractMetricValue(candidate.baseline, metric));
      const targetValue = Number(this.extractMetricValue(candidate.target, metric));
      if (Number.isFinite(baselineValue) && Number.isFinite(targetValue)) {
        return { baseline: baselineValue, target: targetValue, metric };
      }
    }

    for (const candidate of candidates) {
      const baselineValue = Number(this.findBestNumericValue(candidate.baseline));
      const targetValue = Number(this.findBestNumericValue(candidate.target));
      if (Number.isFinite(baselineValue) && Number.isFinite(targetValue)) {
        return { baseline: baselineValue, target: targetValue, metric };
      }
    }

    return null;
  }

  private collectComparisonCandidates(result: unknown): Array<{ baseline: unknown; target: unknown }> {
    const candidates: Array<{ baseline: unknown; target: unknown }> = [];
    const queue: unknown[] = [result];

    while (queue.length > 0 && candidates.length < 20) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') continue;

      if (Array.isArray(current)) {
        for (const item of current) queue.push(item);
        continue;
      }

      const record = current as Record<string, unknown>;
      if (record.baseline !== undefined && record.target !== undefined) {
        candidates.push({ baseline: this.unwrapComparisonSide(record.baseline), target: this.unwrapComparisonSide(record.target) });
      }
      if (record.baseline !== undefined && record.comparison !== undefined) {
        candidates.push({ baseline: this.unwrapComparisonSide(record.baseline), target: this.unwrapComparisonSide(record.comparison) });
      }

      for (const value of Object.values(record)) {
        if (value && typeof value === 'object') queue.push(value);
      }
    }

    return candidates;
  }

  private unwrapComparisonSide(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    return record.result ?? record.data ?? record.value ?? record;
  }

  private findBestNumericValue(result: unknown): number | undefined {
    if (typeof result === 'number') return result;
    if (!result || typeof result !== 'object') return undefined;
    if (Array.isArray(result)) return result.length;

    const record = result as Record<string, unknown>;
    for (const key of ['count', 'total', 'totalCount', 'length', 'qty', 'quantity', 'jumlah']) {
      const value = record[key];
      if (typeof value === 'number') return value;
    }

    for (const key of ['summary', 'meta', 'data']) {
      const value = this.findBestNumericValue(record[key]);
      if (value !== undefined) return value;
    }

    const numericValues = Object.values(record).filter((value): value is number => typeof value === 'number');
    if (numericValues.length === 1) return numericValues[0];

    return undefined;
  }

  private normalizeKey(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, '');
  }

  private hasResolvedObservedValue(
    condition: AutomationCondition,
    result: AutomationConditionEvaluationResult
  ): boolean {
    if (result.observedValue === undefined || result.observedValue === null) return false;

    if (condition.operator === 'eq' || condition.operator === 'neq') {
      return true;
    }

    const observed = Number(result.observedValue);
    return Number.isFinite(observed);
  }
}

export const conditionEvaluatorService = new ConditionEvaluatorService();
