import type { PendingConfirmation } from '../../types/confirmation.types';
import { parseTemporalExpressions, toZonedIso } from '../../utils/temporal/temporal-expression-parser.util';
import { triggerNormalizerService } from './trigger-normalizer.service';
import { calculateNextRunFromCron } from '../../utils/cron.util';
import { cleanAutomationGoalText } from '../../utils/automation-param.util';

export interface DraftPatchResult {
  patch: Record<string, unknown> | null;
  changedFields: string[];
  confidence: number;
  reason?: string;
  needsPretest?: boolean;
}

class AutomationDraftEditService {
  detectPatch(text: string, confirmation: PendingConfirmation): DraftPatchResult {
    if (confirmation.type !== 'automation_job_create') {
      return { patch: null, changedFields: [], confidence: 0, reason: 'not_automation_create' };
    }

    const normalized = this.normalize(text);

    const offsetPatch = this.extractOffsetPatch(normalized, confirmation);
    if (offsetPatch.patch) return offsetPatch;

    const schedulePatch = this.extractSchedulePatch(normalized, confirmation);
    if (schedulePatch.patch) return schedulePatch;

    const goalPatch = this.extractGoalPatch(text, confirmation);
    if (goalPatch.patch) return goalPatch;

    const conditionPatch = this.extractConditionPatch(text, confirmation);
    if (conditionPatch.patch) return conditionPatch;

    const notificationPatch = this.extractNotificationPatch(text, confirmation);
    if (notificationPatch.patch) return notificationPatch;

    return { patch: null, changedFields: [], confidence: 0, reason: 'no_patch_detected' };
  }

  private extractOffsetPatch(text: string, confirmation: PendingConfirmation): DraftPatchResult {
    const match = text.match(/\b(\d+)\s*(menit|minute|minutes)\s*(sebelumnya|sebelum|before)\b/i);
    if (!match || !this.canEdit(confirmation, 'notification.offsetMinutes')) {
      return { patch: null, changedFields: [], confidence: 0 };
    }

    const offsetMinutes = Number(match[1]);
    if (!Number.isFinite(offsetMinutes) || offsetMinutes <= 0) {
      return { patch: null, changedFields: [], confidence: 0 };
    }

    const shiftedRunAt = this.subtractMinutes(confirmation.draft?.trigger?.runAt, offsetMinutes);
    return {
      patch: {
        ...(shiftedRunAt
          ? {
              trigger: {
                ...confirmation.draft.trigger,
                runAt: shiftedRunAt,
                sourceText: `${offsetMinutes} menit sebelumnya`
              },
              nextRunAt: shiftedRunAt
            }
          : {}),
        notification: {
          ...(confirmation.draft.notification || {}),
          offsetMinutes
        }
      },
      changedFields: ['notification.offsetMinutes', ...(shiftedRunAt ? ['trigger.runAt'] : [])],
      confidence: 0.95,
      needsPretest: false
    };
  }

  private extractSchedulePatch(text: string, confirmation: PendingConfirmation): DraftPatchResult {
    if (!this.canEdit(confirmation, 'schedule') && !this.canEdit(confirmation, 'trigger.runAt')) {
      return { patch: null, changedFields: [], confidence: 0 };
    }

    const scheduleText = text.replace(/^(ubah|ganti|jadikan|set|ke)\s+/i, '').trim();
    if (!scheduleText) return { patch: null, changedFields: [], confidence: 0 };

    const triggerResult = triggerNormalizerService.normalize(scheduleText);
    if (triggerResult.trigger && triggerResult.missing.length === 0) {
      const nextRunAt = triggerResult.trigger.runAt ||
        (triggerResult.trigger.cron ? calculateNextRunFromCron(triggerResult.trigger.cron)?.toISOString() : null);

      return {
        patch: {
          trigger: triggerResult.trigger,
          nextRunAt: nextRunAt || null
        },
        changedFields: ['trigger', 'nextRunAt'],
        confidence: 0.9,
        needsPretest: ['scheduled_workflow', 'conditional_alert'].includes(String(confirmation.draft?.type))
      };
    }

    const expression = parseTemporalExpressions(scheduleText, { locale: 'auto', timezone: 'Asia/Jakarta' })
      .find(item => item.kind === 'datetime');

    if (expression?.date && expression.time) {
      const runAt = toZonedIso(expression.date, expression.time, expression.timezone);
      return {
        patch: {
          trigger: {
            kind: 'once',
            runAt,
            timezone: expression.timezone,
            sourceText: expression.raw
          },
          nextRunAt: runAt
        },
        changedFields: ['trigger.runAt', 'nextRunAt'],
        confidence: 0.9,
        needsPretest: ['scheduled_workflow', 'conditional_alert'].includes(String(confirmation.draft?.type))
      };
    }

    return { patch: null, changedFields: [], confidence: 0 };
  }

  private extractGoalPatch(text: string, confirmation: PendingConfirmation): DraftPatchResult {
    if (!this.canEdit(confirmation, 'goal')) {
      return { patch: null, changedFields: [], confidence: 0 };
    }

    const match = text.match(/\b(?:ubah|ganti|edit)\s+(?:goal|tujuan|judul)\s+(?:jadi|ke|menjadi)?\s*(.+)$/i);
    const goal = cleanAutomationGoalText(match?.[1]);
    if (!goal) return { patch: null, changedFields: [], confidence: 0 };

    return {
      patch: {
        goal,
        title: this.rebuildTitle(confirmation.draft?.type, goal),
        workflow: {
          ...(confirmation.draft?.workflow || {}),
          sourceText: goal
        },
        action: {
          ...(confirmation.draft?.action || {}),
          params: {
            ...(confirmation.draft?.action?.params || {}),
            message: goal
          }
        },
        notification: {
          ...(confirmation.draft?.notification || {}),
          messageTemplate: goal
        }
      },
      changedFields: ['goal', 'title', 'workflow.sourceText'],
      confidence: 0.86,
      needsPretest: ['scheduled_workflow', 'conditional_alert'].includes(String(confirmation.draft?.type))
    };
  }

  private extractConditionPatch(text: string, confirmation: PendingConfirmation): DraftPatchResult {
    if (!this.canEdit(confirmation, 'condition')) {
      return { patch: null, changedFields: [], confidence: 0 };
    }

    const match = text.match(/\b(?:ubah|ganti|edit)\s+(?:kondisi|condition|rule)\s+(?:jadi|ke|menjadi)?\s*(.+)$/i);
    const conditionText = match?.[1]?.trim();
    if (!conditionText) return { patch: null, changedFields: [], confidence: 0 };

    return {
      patch: {
        condition: this.normalizeCondition(conditionText)
      },
      changedFields: ['condition'],
      confidence: 0.86,
      needsPretest: true
    };
  }

  private extractNotificationPatch(text: string, confirmation: PendingConfirmation): DraftPatchResult {
    if (!this.canEdit(confirmation, 'notification')) {
      return { patch: null, changedFields: [], confidence: 0 };
    }

    const normalized = this.normalize(text);
    const channel = /\b(email)\b/.test(normalized)
      ? 'email'
      : /\b(webhook)\b/.test(normalized)
        ? 'webhook'
        : /\b(chat|websocket|ws)\b/.test(normalized)
          ? 'chat'
          : null;
    const targetMatch = text.match(/\b(?:ke|to)\s+([^\s]+@[^\s]+|[+\d][\d\s-]{6,}|chat)\b/i);
    const target = targetMatch?.[1]?.trim();

    if (!channel && !target) return { patch: null, changedFields: [], confidence: 0 };

    return {
      patch: {
        notification: {
          ...(confirmation.draft?.notification || {}),
          ...(channel ? { channel } : {}),
          ...(target ? { target } : {})
        },
        action: {
          ...(confirmation.draft?.action || {}),
          params: {
            ...(confirmation.draft?.action?.params || {}),
            ...(target ? { target } : {})
          }
        }
      },
      changedFields: ['notification'],
      confidence: 0.8,
      needsPretest: false
    };
  }

  private normalizeCondition(sourceText: string): Record<string, unknown> {
    const lowered = sourceText.toLowerCase();
    const numberMatch = lowered.match(/\b(\d+(?:[.,]\d+)?)\b/);
    const value = numberMatch ? Number(numberMatch[1].replace(',', '.')) : undefined;
    const metric = lowered
      .replace(/\b(kalau|jika|if|when|turun|naik|lebih|dari|besar|kecil|kurang|persen|percent|%)\b/gi, ' ')
      .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .pop();

    if (/\b(turun|decrease|down)\b/i.test(lowered)) {
      return { kind: 'comparison', sourceText, metric, operator: 'decrease_percent', value };
    }
    if (/\b(naik|increase|up)\b/i.test(lowered)) {
      return { kind: 'comparison', sourceText, metric, operator: 'increase_percent', value };
    }
    if (/\b(lebih dari|lebih besar dari|di atas|above|greater than|>)\b/i.test(lowered)) {
      return { kind: 'threshold', sourceText, metric, operator: 'gt', value };
    }
    if (/\b(kurang dari|di bawah|below|less than|<)\b/i.test(lowered)) {
      return { kind: 'threshold', sourceText, metric, operator: 'lt', value };
    }
    return { kind: 'threshold', sourceText, metric, operator: value !== undefined ? 'gt' : undefined, value };
  }

  private subtractMinutes(value: unknown, minutes: number): string | null {
    if (typeof value !== 'string') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setMinutes(date.getMinutes() - minutes);
    return this.formatJakartaIso(date);
  }

  private formatJakartaIso(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(date);

    const get = (type: string) => parts.find(part => part.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+07:00`;
  }

  private canEdit(confirmation: PendingConfirmation, field: string): boolean {
    return confirmation.editableFields.some(editableField =>
      editableField === field ||
      field.startsWith(`${editableField}.`) ||
      editableField.startsWith(`${field}.`)
    );
  }

  private rebuildTitle(type: unknown, goal: string): string {
    const prefix = type === 'reminder'
      ? 'Reminder'
      : type === 'scheduled_workflow'
        ? 'Scheduled Workflow'
        : 'Conditional Alert';
    return `${prefix}: ${goal.slice(0, 80)}`;
  }

  private normalize(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}:.\s@+%-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export const automationDraftEditService = new AutomationDraftEditService();
