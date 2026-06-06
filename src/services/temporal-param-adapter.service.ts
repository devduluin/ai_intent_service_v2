import type { ToolParam } from '../types';
import { resolveTemporalExpression } from '../utils/dateHumanID';

type TemporalDetail = {
  type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative';
  value: string;
  normalizedValue?: string;
  direction?: 'current' | 'past' | 'future';
};

export interface TemporalParamMappingResult {
  params: Record<string, unknown>;
  mappedKeys: string[];
  strategy: 'date' | 'month_year' | 'range' | 'period' | 'year' | 'none';
  missingTemporalParams: string[];
  label?: string;
}

class TemporalParamAdapterService {
  mapTemporalToToolParams(
    temporalDetails: TemporalDetail[] | undefined,
    toolParams: ToolParam[],
    baseParams: Record<string, unknown>
  ): TemporalParamMappingResult {
    const detail = temporalDetails?.[0];
    if (!detail) {
      return {
        params: { ...baseParams },
        mappedKeys: [],
        strategy: 'none',
        missingTemporalParams: ['temporal']
      };
    }

    const params = this.clearTemporalParams(baseParams);
    const names = new Set(toolParams.map(param => param.name));
    const resolved = resolveTemporalExpression(detail.value);
    const startDate = resolved?.startDate ? this.formatDateToISO(resolved.startDate) : this.extractStartDate(detail.normalizedValue);
    const endDate = resolved?.endDate ? this.formatDateToISO(resolved.endDate) : this.extractEndDate(detail.normalizedValue);
    const month = resolved?.startDate ? resolved.startDate.getMonth() + 1 : undefined;
    const year = resolved?.startDate ? resolved.startDate.getFullYear() : this.extractYear(detail.normalizedValue);
    const label = detail.value || detail.normalizedValue;

    const rangeKeys = this.findRangeKeys(names);
    if (rangeKeys && startDate && endDate) {
      params[rangeKeys.start] = startDate;
      params[rangeKeys.end] = endDate;
      return {
        params,
        mappedKeys: [rangeKeys.start, rangeKeys.end],
        strategy: 'range',
        missingTemporalParams: [],
        label
      };
    }

    const monthKey = this.findFirst(names, ['month', 'bulan']);
    const yearKey = this.findFirst(names, ['year', 'tahun']);
    if (monthKey && yearKey && month && year) {
      params[monthKey] = this.formatMonthValue(month, toolParams.find(param => param.name === monthKey));
      params[yearKey] = this.formatYearValue(year, toolParams.find(param => param.name === yearKey));
      return {
        params,
        mappedKeys: [monthKey, yearKey],
        strategy: 'month_year',
        missingTemporalParams: [],
        label
      };
    }

    if (yearKey && year && detail.type === 'year') {
      params[yearKey] = this.formatYearValue(year, toolParams.find(param => param.name === yearKey));
      return {
        params,
        mappedKeys: [yearKey],
        strategy: 'year',
        missingTemporalParams: [],
        label
      };
    }

    const dateKey = this.findFirst(names, ['date', 'tanggal']);
    if (dateKey) {
      params[dateKey] = startDate && endDate && startDate !== endDate
        ? `${startDate} to ${endDate}`
        : (startDate || detail.normalizedValue || detail.value);
      return {
        params,
        mappedKeys: [dateKey],
        strategy: 'date',
        missingTemporalParams: [],
        label
      };
    }

    const periodKey = this.findFirst(names, ['period']);
    if (periodKey) {
      params[periodKey] = startDate && endDate
        ? `${startDate} to ${endDate}`
        : (detail.normalizedValue || detail.value);
      return {
        params,
        mappedKeys: [periodKey],
        strategy: 'period',
        missingTemporalParams: [],
        label
      };
    }

    return {
      params,
      mappedKeys: [],
      strategy: 'none',
      missingTemporalParams: ['date', 'month/year', 'range', 'period'],
      label
    };
  }

  private clearTemporalParams(params: Record<string, unknown>): Record<string, unknown> {
    const temporalKeys = new Set([
      'date',
      'month',
      'year',
      'start_date',
      'end_date',
      'from_date',
      'to_date',
      'tanggal',
      'bulan',
      'tahun',
      'period'
    ]);

    return Object.fromEntries(
      Object.entries(params).filter(([key]) => !temporalKeys.has(key))
    );
  }

  private findRangeKeys(names: Set<string>): { start: string; end: string } | null {
    if (names.has('start_date') && names.has('end_date')) {
      return { start: 'start_date', end: 'end_date' };
    }

    if (names.has('from_date') && names.has('to_date')) {
      return { start: 'from_date', end: 'to_date' };
    }

    return null;
  }

  private findFirst(names: Set<string>, candidates: string[]): string | undefined {
    return candidates.find(candidate => names.has(candidate));
  }

  private formatMonthValue(month: number, param?: ToolParam): string | number {
    if (param?.type === 'number') {
      return month;
    }

    return String(month).padStart(2, '0');
  }

  private formatYearValue(year: number, param?: ToolParam): string | number {
    if (param?.type === 'number') {
      return year;
    }

    return String(year);
  }

  private extractStartDate(value?: string): string | undefined {
    return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  }

  private extractEndDate(value?: string): string | undefined {
    const matches = value?.match(/\d{4}-\d{2}-\d{2}/g);
    return matches?.[1] || matches?.[0];
  }

  private extractYear(value?: string): number | undefined {
    const match = value?.match(/\b(19|20)\d{2}\b/);
    return match ? Number(match[0]) : undefined;
  }

  private formatDateToISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export const temporalParamAdapterService = new TemporalParamAdapterService();
