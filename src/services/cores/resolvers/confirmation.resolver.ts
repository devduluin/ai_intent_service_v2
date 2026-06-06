import type { PipelineInput } from '../../../types';
import type { PendingConfirmation, ConfirmationResolutionResult } from '../../../types/confirmation.types';
import { parseTemporalExpressions, toZonedIso } from '../../../utils/temporal/temporal-expression-parser.util';
import { appLogger } from '../../../utils/logger.util';
import { llmOptionResolutionService } from '../../llm-option-resolution.service';
import { automationDraftEditService } from '../../automation/automation-draft-edit.service';

export class ConfirmationResolver {
  async resolve(input: PipelineInput, confirmation: PendingConfirmation | null): Promise<ConfirmationResolutionResult> {
    if (!confirmation) {
      return { isConfirmationResponse: false };
    }

    if (confirmation.status !== 'pending' && confirmation.status !== 'edited') {
      return { isConfirmationResponse: false, confirmation };
    }

    if (confirmation.expiresAt <= Date.now()) {
      return {
        isConfirmationResponse: false,
        confirmation: {
          ...confirmation,
          status: 'expired'
        },
        expired: true
      };
    }

    const normalized = this.normalize(input.text);
    if (this.isConfirm(normalized, confirmation)) {
      // Block save if pretest failed — no tool/skill supports the query
      const pretestFailed = confirmation.draft?.pretest?.status === 'no_data'
        || confirmation.draft?.pretest?.status === 'failed';
      if (pretestFailed) {
        return {
          isConfirmationResponse: true,
          status: 'pending',
          confirmation,
          shouldCommit: false,
          shouldCancel: false,
          shouldAskAgain: true,
          message: 'Tidak bisa menyimpan karena pretest gagal — query tidak bisa dijalankan oleh tools yang tersedia. Silakan ubah query atau batalkan.'
        };
      }

      return {
        isConfirmationResponse: true,
        status: 'confirmed',
        confirmation,
        shouldCommit: true
      };
    }

    if (this.isCancel(normalized)) {
      return {
        isConfirmationResponse: true,
        status: 'cancelled',
        confirmation,
        shouldCancel: true,
        message: 'Baik, saya batalkan draftnya. Tidak ada automation baru yang disimpan.'
      };
    }

    const patch = this.extractPatch(input.text, confirmation);
    if (patch) {
      return {
        isConfirmationResponse: true,
        status: 'edited',
        confirmation,
        patch,
        shouldAskAgain: true,
        message: 'Baik, saya ubah draftnya. Mau saya simpan sekarang?'
      };
    }

    return await this.resolveWithLLMFallback(input, confirmation);
  }

  private extractPatch(text: string, confirmation: PendingConfirmation): Record<string, unknown> | null {
    const result = automationDraftEditService.detectPatch(text, confirmation);
    return result.patch;
  }

  private extractOffsetMinutes(text: string): number | null {
    const match = text.match(/\b(\d+)\s*(menit|minute|minutes)\s*(sebelumnya|sebelum|before)\b/i);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
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

  private isConfirm(text: string, confirmation?: PendingConfirmation): boolean {
    if (confirmation?.type === 'automation_job_delete' && /^(hapus|ya hapus|iya hapus|ok hapus|oke hapus|lanjut hapus)$/.test(text)) {
      return true;
    }

    if (/^(oke|ok|ya|iya|boleh|simpan|buat|lanjut|setuju|yes|save|create)(\s+(simpan|buat|sekarang|saja|aja))?$/.test(text)) {
      return true;
    }
    return this.hasFuzzyToken(text, ['simpan', 'buat', 'setuju', 'lanjut']);
  }

  private isCancel(text: string): boolean {
    if (/^(batal|batalkan|jangan|hapus|cancel|no|tidak|nggak|gak|salah)(\s+(saja|aja|draft|itu))?$/.test(text)) {
      return true;
    }
    return this.hasFuzzyToken(text, ['batal', 'batalkan', 'jangan', 'hapus', 'cancel']);
  }

  private normalize(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}:.\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hasFuzzyToken(text: string, targets: string[]): boolean {
    const tokens = text.split(/\s+/).filter(token => token.length >= 4);
    return tokens.some(token => targets.some(target => this.levenshtein(token, target) <= 2));
  }

  private levenshtein(a: string, b: string): number {
    const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }

    return matrix[a.length][b.length];
  }

  private async resolveWithLLMFallback(
    input: PipelineInput,
    confirmation: PendingConfirmation
  ): Promise<ConfirmationResolutionResult> {
    try {
      const parsed = await this.classifyWithLLM(input.text, confirmation);
      const action = String(parsed.action || 'none');

      if (action === 'confirm') {
        return {
          isConfirmationResponse: true,
          status: 'confirmed',
          confirmation,
          shouldCommit: true
        };
      }

      if (action === 'cancel') {
        return {
          isConfirmationResponse: true,
          status: 'cancelled',
          confirmation,
          shouldCancel: true,
          message: 'Baik, saya batalkan draftnya. Tidak ada automation baru yang disimpan.'
        };
      }

      if (action === 'edit') {
        const patch = this.buildPatchFromLLM(parsed, confirmation);
        if (patch) {
          return {
            isConfirmationResponse: true,
            status: 'edited',
            confirmation,
            patch,
            shouldAskAgain: true,
            message: 'Baik, saya ubah draftnya. Mau saya simpan sekarang?'
          };
        }
      }
    } catch (error) {
      appLogger.debug('[ConfirmationResolver] LLM fallback failed', {
        error: error instanceof Error ? error.message : String(error),
        text: input.text,
        confirmationType: confirmation.type
      });
    }

    return {
      isConfirmationResponse: false,
      confirmation
    };
  }

  private async classifyWithLLM(text: string, confirmation: PendingConfirmation): Promise<any> {
    const result = await llmOptionResolutionService.resolve({
      text,
      mode: 'action',
      minConfidence: 0.65,
      options: [
        {
          key: 'confirm',
          label: 'confirm',
          aliases: ['ya', 'iya', 'oke', 'ok', 'simpan', 'buat', 'lanjut', 'setuju', 'save', 'create'],
          description: 'User agrees to save or commit the active draft.'
        },
        {
          key: 'cancel',
          label: 'cancel',
          aliases: ['batal', 'batalkan', 'jangan', 'hapus', 'cancel', 'tidak', 'nggak', 'gak'],
          description: 'User rejects or cancels the active draft.'
        },
        {
          key: 'edit',
          label: 'edit',
          aliases: ['ubah', 'ganti', 'edit', 'jadikan', 'sebelumnya', 'before'],
          description: 'User wants to change editable fields such as schedule or reminder offset.'
        }
      ],
      context: {
        confirmationType: confirmation.type,
        editableFields: confirmation.editableFields,
        draft: confirmation.draft
      }
    });

    if (!result.matched || !result.action) {
      return { action: 'none', confidence: result.confidence };
    }

    if (result.action !== 'edit') {
      return { action: result.action, confidence: result.confidence };
    }

    const patchResult = await llmOptionResolutionService.resolve({
      text,
      mode: 'param_patch',
      minConfidence: 0.65,
      schema: [
        {
          name: 'scheduleText',
          type: 'string',
          description: 'New schedule text, for example "jam 13:45", "besok jam 7 pagi", or "setiap Senin jam 9 pagi".',
          editable: this.canEdit(confirmation, 'trigger.runAt')
        },
        {
          name: 'offsetMinutes',
          type: 'number',
          description: 'Reminder offset in minutes before the event, for example 15.',
          editable: this.canEdit(confirmation, 'notification.offsetMinutes')
        }
      ],
      context: {
        confirmationType: confirmation.type,
        editableFields: confirmation.editableFields,
        draft: confirmation.draft
      }
    });

    return {
      action: 'edit',
      confidence: Math.min(result.confidence, patchResult.confidence || result.confidence),
      edit: patchResult.paramsPatch || {}
    };
  }

  private buildPatchFromLLM(parsed: any, confirmation: PendingConfirmation): Record<string, unknown> | null {
    const edit = parsed.edit || {};
    const offsetMinutes = Number(edit.offsetMinutes);
    if (Number.isFinite(offsetMinutes) && offsetMinutes > 0) {
      if (!this.canEdit(confirmation, 'notification.offsetMinutes')) {
        return null;
      }

      const shiftedRunAt = this.subtractMinutes(confirmation.draft?.trigger?.runAt, offsetMinutes);
      return {
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
      };
    }

    if (typeof edit.scheduleText === 'string' && edit.scheduleText.trim()) {
      if (!this.canEdit(confirmation, 'trigger.runAt')) {
        return null;
      }

      const expression = parseTemporalExpressions(edit.scheduleText, { locale: 'auto', timezone: 'Asia/Jakarta' })
        .find(item => item.kind === 'datetime');
      if (expression?.date && expression.time) {
        const runAt = toZonedIso(expression.date, expression.time, expression.timezone);
        return {
          trigger: {
            ...confirmation.draft.trigger,
            kind: 'once',
            runAt,
            timezone: expression.timezone,
            sourceText: expression.raw
          },
          nextRunAt: runAt
        };
      }
    }

    return null;
  }

  private canEdit(confirmation: PendingConfirmation, field: string): boolean {
    return confirmation.editableFields.some(editableField =>
      editableField === field ||
      field.startsWith(`${editableField}.`) ||
      editableField.startsWith(`${field}.`)
    );
  }
}
