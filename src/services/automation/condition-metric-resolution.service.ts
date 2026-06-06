import { config } from '../../config';
import type { AutomationCondition } from '../../types/automation.types';
import { appLogger } from '../../utils/logger.util';
import { ollamaService } from '../ollama.service';
import { openAiService } from '../openAi.service';

export interface ConditionMetricResolutionRequest {
  condition: AutomationCondition;
  result: unknown;
  previousResult?: unknown;
}

export interface ConditionMetricResolutionResult {
  matched: boolean;
  observedValue?: number | string | boolean;
  metric?: string;
  sourcePath?: string;
  confidence: number;
  reason?: string;
  raw?: unknown;
}

class ConditionMetricResolutionService {
  async resolve(request: ConditionMetricResolutionRequest): Promise<ConditionMetricResolutionResult> {
    if (!request.condition?.operator) {
      return {
        matched: false,
        confidence: 0,
        reason: 'Condition operator is missing.'
      };
    }

    try {
      const parsed = await this.resolveWithLLM(request);
      const confidence = Number(parsed.confidence || 0);
      const matched = parsed.matched === true && confidence >= 0.68;

      if (!matched || parsed.observedValue === undefined || parsed.observedValue === null) {
        return {
          matched: false,
          confidence: Number.isFinite(confidence) ? confidence : 0,
          reason: parsed.reason || 'LLM could not identify a grounded metric value.',
          raw: parsed
        };
      }

      return {
        matched: true,
        observedValue: parsed.observedValue,
        metric: parsed.metric ? String(parsed.metric) : request.condition.metric,
        sourcePath: parsed.sourcePath ? String(parsed.sourcePath) : undefined,
        confidence,
        reason: parsed.reason ? String(parsed.reason) : undefined,
        raw: parsed
      };
    } catch (error) {
      appLogger.warn('[ConditionMetricResolution] LLM fallback failed', {
        error: error instanceof Error ? error.message : String(error),
        metric: request.condition.metric,
        operator: request.condition.operator
      });

      return {
        matched: false,
        confidence: 0,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async resolveWithLLM(request: ConditionMetricResolutionRequest): Promise<any> {
    const prompt = this.buildPrompt(request);
    const provider = config.default?.provider;
    const raw = provider === 'qwen' || provider === 'openai'
      ? await openAiService.generateJson(prompt, { temperature: 0, num_predict: 450 })
      : await ollamaService.generateJson(prompt);

    return this.parseJson(raw);
  }

  private buildPrompt(request: ConditionMetricResolutionRequest): string {
    return `
Anda adalah resolver metric untuk automation conditional alert.

Tugas:
- Cari nilai observasi yang paling relevan dari JSON result untuk condition yang diberikan.
- Gunakan hanya data yang ada di JSON result.
- Jangan mengarang data, nama field, atau angka.
- Jika field metric eksplisit tidak ada, boleh cari sinonim/struktur terkait berdasarkan sourceText.
- Jika result berupa array yang relevan, observedValue boleh berupa jumlah item array.
- Jika tidak cukup bukti, return matched false.
- Return JSON valid saja.

Condition:
${JSON.stringify(request.condition, null, 2)}

Current result:
${this.stringifyCompact(request.result)}

Previous result optional:
${this.stringifyCompact(request.previousResult)}

Output:
{
  "matched": true,
  "metric": "nama metric yang dipakai",
  "observedValue": 0,
  "sourcePath": "path.ke.field",
  "confidence": 0.0,
  "reason": "alasan singkat"
}
`.trim();
  }

  private stringifyCompact(value: unknown): string {
    if (value === undefined) return 'null';

    const seen = new WeakSet<object>();
    const json = JSON.stringify(
      value,
      (_key, item) => {
        if (item && typeof item === 'object') {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        if (typeof item === 'string' && item.length > 500) return `${item.slice(0, 500)}...`;
        return item;
      },
      2
    );

    if (!json) return 'null';
    if (json.length <= 8000) return json;
    return `${json.slice(0, 8000)}\n... [truncated]`;
  }

  private parseJson(raw: string): any {
    try {
      return JSON.parse(raw);
    } catch {
      const match = String(raw || '').match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error('LLM metric resolver returned invalid JSON.');
    }
  }
}

export const conditionMetricResolutionService = new ConditionMetricResolutionService();
