export type TemporalExpressionKind =
  | 'date'
  | 'datetime'
  | 'time'
  | 'period'
  | 'recurrence';

export type TemporalFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly';

export interface TemporalExpression {
  kind: TemporalExpressionKind;
  raw: string;
  date?: string;
  time?: string;
  startDate?: string;
  endDate?: string;
  frequency?: TemporalFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  timezone: string;
  direction?: 'current' | 'past' | 'future';
  confidence: number;
}

export interface TemporalParseOptions {
  locale?: 'id' | 'en' | 'auto';
  timezone?: string;
  now?: Date;
}
