import {
  parseTemporalExpressions,
  toZonedIso
} from '../../utils/temporal/temporal-expression-parser.util';
import type { AutomationTrigger } from '../../types/automation.types';
import type { TemporalExpression } from '../../utils/temporal/temporal-expression.types';

export interface TriggerNormalizationResult {
  trigger?: AutomationTrigger;
  confidence: number;
  missing: string[];
  expression?: TemporalExpression;
}

class TriggerNormalizerService {
  normalize(
    sourceText: string,
    options: {
      timezone?: string;
      now?: Date;
      locale?: 'id' | 'en' | 'auto';
    } = {}
  ): TriggerNormalizationResult {
    const timezone = options.timezone || 'Asia/Jakarta';
    const expressions = parseTemporalExpressions(sourceText, {
      timezone,
      now: options.now,
      locale: options.locale || 'auto'
    });

    console.log('[TriggerNormalizer] Parsed expressions:', {
      sourceText,
      count: expressions.length,
      expressions: expressions.map(e => ({
        kind: e.kind,
        date: e.date,
        time: e.time,
        direction: e.direction,
        confidence: e.confidence
      }))
    });

    const expression = this.enrichRecurringExpressionWithTime(
      this.selectBestExpression(expressions),
      expressions
    );
    if (!expression) {
      return {
        confidence: 0,
        missing: ['schedule']
      };
    }

    console.log('[TriggerNormalizer] Selected expression:', {
      kind: expression.kind,
      date: expression.date,
      time: expression.time,
      direction: expression.direction
    });

    if (expression.kind === 'datetime' && expression.date && expression.time) {
      // ✅ Use date/time as parsed by temporal parser
      // Parser already handles:
      // 1. Ambiguous time (assumes PM if AM passed)
      // 2. Past time (adds 1 day if already passed)
      const dateToUse = expression.date;

      console.log('[TriggerNormalizer] Using parsed datetime', {
        date: dateToUse,
        time: expression.time,
        direction: expression.direction
      });

      return {
        trigger: {
          kind: 'once',
          runAt: toZonedIso(dateToUse, expression.time, timezone),
          timezone,
          sourceText
        },
        expression,
        confidence: expression.confidence,
        missing: []
      };
    }

    if (expression.kind === 'date' && expression.date) {
      return {
        trigger: {
          kind: 'once',
          runAt: toZonedIso(expression.date, '09:00', timezone),
          timezone,
          sourceText
        },
        expression,
        confidence: Math.min(expression.confidence, 0.75),
        missing: ['time']
      };
    }

    if (expression.kind === 'recurrence') {
      const cron = this.toCron(expression);
      if (!cron) {
        return {
          expression,
          confidence: expression.confidence,
          missing: ['schedule']
        };
      }

      return {
        trigger: {
          kind: 'recurring',
          cron,
          timezone,
          sourceText
        },
        expression,
        confidence: expression.confidence,
        missing: expression.time ? [] : ['time']
      };
    }

    return {
      expression,
      confidence: expression.confidence,
      missing: ['schedule']
    };
  }

  private selectBestExpression(expressions: TemporalExpression[]): TemporalExpression | undefined {
    return [...expressions].sort((a, b) => {
      const priority = this.kindPriority(b.kind) - this.kindPriority(a.kind);
      if (priority !== 0) return priority;
      return b.confidence - a.confidence;
    })[0];
  }

  private enrichRecurringExpressionWithTime(
    selected: TemporalExpression | undefined,
    expressions: TemporalExpression[]
  ): TemporalExpression | undefined {
    if (!selected || selected.kind !== 'recurrence' || selected.time) {
      return selected;
    }

    const expressionWithTime = expressions.find(expression =>
      expression !== selected &&
      !!expression.time &&
      (expression.kind === 'datetime' || expression.kind === 'time')
    );

    if (!expressionWithTime?.time) {
      return selected;
    }

    return {
      ...selected,
      time: expressionWithTime.time,
      confidence: Math.max(selected.confidence, expressionWithTime.confidence)
    };
  }

  private kindPriority(kind: TemporalExpression['kind']): number {
    switch (kind) {
      case 'recurrence':
        return 6;
      case 'datetime':
        return 5;
      case 'date':
        return 3;
      case 'period':
        return 2;
      case 'time':
        return 1;
      default:
        return 0;
    }
  }

  private toCron(expression: TemporalExpression): string | null {
    const [hourRaw, minuteRaw] = (expression.time || '09:00').split(':');
    const hour = Number(hourRaw);
    const minute = Number(minuteRaw);

    if (expression.frequency === 'daily') {
      return `${minute} ${hour} * * *`;
    }

    if (expression.frequency === 'weekly' && expression.dayOfWeek !== undefined) {
      return `${minute} ${hour} * * ${expression.dayOfWeek}`;
    }

    if (expression.frequency === 'monthly' && expression.dayOfMonth !== undefined) {
      return `${minute} ${hour} ${expression.dayOfMonth} * *`;
    }

    return null;
  }
  
  // ✅ HELPER: Format date to ISO
  private formatDateToISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export const triggerNormalizerService = new TriggerNormalizerService();
