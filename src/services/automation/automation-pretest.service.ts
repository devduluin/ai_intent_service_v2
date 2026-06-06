import type { PipelineInput, PipelineResult } from '../../types';
import { appLogger } from '../../utils/logger.util';

export interface AutomationPretestRunner {
  (input: PipelineInput): Promise<PipelineResult>;
}

class AutomationPretestService {
  shouldPretest(draft: any): boolean {
    return draft?.type === 'scheduled_workflow' || draft?.type === 'conditional_alert';
  }

  async attachPretest(
    input: PipelineInput,
    draft: any,
    runPipeline: AutomationPretestRunner
  ): Promise<any> {
    if (!draft || !this.shouldPretest(draft)) {
      return draft;
    }

    const automationMode = (input.attributes as any)?.automation?.mode;
    if (automationMode === 'condition_evaluation' || automationMode === 'pretest') {
      return draft;
    }

    const pretestQuery = this.buildEvaluationQuery(draft);
    if (!pretestQuery) {
      return {
        ...draft,
        pretest: {
          status: 'skipped',
          reason: 'No evaluation query could be built from automation draft.'
        }
      };
    }

    try {
      const pretestInput: PipelineInput = {
        ...input,
        text: pretestQuery,
        attributes: {
          ...(input.attributes || {}),
          automation: {
            mode: 'pretest',
            source: 'automation_confirmation',
            originalText: input.text,
            draftType: draft.type
          }
        }
      };

      const pretestResult = await runPipeline(pretestInput);
      const apiResult = pretestResult.apiResult;
      const isValid = this.isValidPretestResult(pretestResult);

      let reason: string;
      let reasonDetail: string;
      if (isValid) {
        reason = 'Evaluation query executed successfully with operational data.';
        reasonDetail = '';
      } else if (pretestResult.intent === 'general_chat') {
        reason = 'Tidak ada tool/knowledge yang mendukung query ini. Query tidak cocok dengan tools yang tersedia.';
        reasonDetail = `Pipeline jatuh ke general_chat (intent: ${pretestResult.intent}). Pastikan ada tool/skill/knowledge yang bisa mengeksekusi query "${pretestQuery}".`;
      } else if (pretestResult.intent === 'slot_filling') {
        reason = 'Query membutuhkan parameter tambahan yang tidak bisa diisi otomatis saat pretest.';
        reasonDetail = `Pipeline memicu slot filling (intent: ${pretestResult.intent}). Query "${pretestQuery}" butuh parameter yang harus diisi user.`;
      } else {
        const tasks = pretestResult.metadata?.executedTasks ?? 0;
        reason = tasks === 0
          ? 'Pipeline tidak mengeksekusi tool/skill apapun. Query tidak cocok dengan tools yang tersedia.'
          : 'Evaluation query did not return usable operational data.';
        reasonDetail = `Executed tasks: ${tasks}, Intent: ${pretestResult.intent}. Query: "${pretestQuery}".`;
      }

      return {
        ...draft,
        pretest: {
          status: isValid ? 'success' : 'no_data',
          type: draft.type,
          query: pretestQuery,
          intent: pretestResult.intent,
          naturalResponse: pretestResult.naturalResponse,
          apiResult: this.compactValue(apiResult),
          executedTasks: pretestResult.metadata?.executedTasks ?? 0,
          reason,
          reasonDetail
        }
      };
    } catch (error) {
      appLogger.warn('[AutomationPretest] Pretest failed', {
        userId: input.user_id,
        appName: input.app_name,
        draftType: draft.type,
        query: pretestQuery,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        ...draft,
        pretest: {
          status: 'failed',
          type: draft.type,
          query: pretestQuery,
          reason: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  buildEvaluationQuery(draft: any): string {
    const referencedSourceText = String(draft?.workflow?.referencedSourceText || '').trim();
    const workflowSourceText = String(draft?.workflow?.sourceText || '').trim();
    const goal = String(draft?.goal || '').trim();
    const conditionSourceText = String(draft?.condition?.sourceText || '').trim();

    if (draft?.condition?.kind === 'comparison') {
      return String(referencedSourceText || workflowSourceText || goal || conditionSourceText || '').trim();
    }

    const refersToPrevious = /\b(ini|this|itu|tersebut|di atas|sebelumnya|tadi|last result)\b/i.test(
      `${workflowSourceText} ${goal} ${conditionSourceText}`
    );

    if (refersToPrevious && referencedSourceText) {
      return this.ensureExecutableQuery(referencedSourceText);
    }

    const source = draft?.type === 'conditional_alert'
      ? conditionSourceText || goal || referencedSourceText || workflowSourceText || ''
      : goal || referencedSourceText || workflowSourceText || '';

    const cleaned = String(source || '')
      .replace(/\b(kalau|jika|if|when|apabila)\b/gi, ' ')
      .replace(/\b(lebih dari|lebih besar dari|di atas|above|greater than|>|minimal|setidaknya|paling sedikit|kurang dari|di bawah|below|less than|<|maksimal|paling banyak|sama dengan|equal|=)\b.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const query = cleaned || referencedSourceText || workflowSourceText || goal;
    if (!query) return '';
    return this.ensureExecutableQuery(query);
  }

  private ensureExecutableQuery(query: string): string {
    const cleaned = String(query || '')
      .replace(/\b(laporkan|kirimkan|kirim|report|schedule)\s+(ini|this|itu|tersebut|di atas|sebelumnya|tadi)\b/gi, ' ')
      .replace(/\b(setiap|tiap|every|daily|weekly|monthly)\b.*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) return '';
    return /^(cek|check|tampilkan|lihat|ambil|get)\b/i.test(cleaned)
      ? cleaned
      : `cek ${cleaned}`;
  }

  hasOperationalData(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) return false;
    if (keys.length === 1 && keys[0] === 'totalTime') return false;
    return true;
  }

  /**
   * Validate that pretest result represents a real tool/skill execution,
   * not a general_chat fallback or empty pipeline response.
   */
  isValidPretestResult(pretestResult: PipelineResult): boolean {
    // Must not be general_chat or slot_filling fallback
    if (pretestResult.intent === 'general_chat' || pretestResult.intent === 'slot_filling') {
      return false;
    }

    // Must have executed at least one real task (tool/skill/knowledge)
    const executedTasks = pretestResult.metadata?.executedTasks;
    if (typeof executedTasks !== 'number' || executedTasks <= 0) {
      return false;
    }

    // Must have operational data
    if (!this.hasOperationalData(pretestResult.apiResult)) {
      return false;
    }

    return true;
  }

  compactValue(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    try {
      const json = JSON.stringify(value);
      if (json.length <= 5000) return value;
      return {
        truncated: true,
        preview: json.slice(0, 5000)
      };
    } catch {
      return {
        unserializable: true
      };
    }
  }
}

export const automationPretestService = new AutomationPretestService();
