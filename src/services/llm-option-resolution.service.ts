import { config } from '../config';
import type { ToolParam } from '../types';
import { appLogger } from '../utils/logger.util';
import { ollamaService } from './ollama.service';
import { openAiService } from './openAi.service';

export type LlmOptionResolutionMode = 'boolean' | 'enum' | 'action' | 'param_patch';
export type LlmOptionResolutionSource = 'rule' | 'fuzzy' | 'llm';

export interface LlmResolutionOption {
  key: string;
  label?: string;
  aliases?: string[];
  description?: string;
}

export interface LlmParamSchemaField {
  name: string;
  type: string;
  description?: string;
  options?: LlmResolutionOption[];
  editable?: boolean;
}

export interface LlmOptionResolutionRequest {
  text: string;
  mode: LlmOptionResolutionMode;
  options?: LlmResolutionOption[];
  schema?: LlmParamSchemaField[];
  context?: Record<string, unknown>;
  minConfidence?: number;
}

export interface LlmOptionResolutionResult {
  matched: boolean;
  action?: string;
  value?: unknown;
  paramsPatch?: Record<string, unknown>;
  confidence: number;
  source: LlmOptionResolutionSource;
  raw?: unknown;
}

class LlmOptionResolutionService {
  async resolve(request: LlmOptionResolutionRequest): Promise<LlmOptionResolutionResult> {
    const threshold = request.minConfidence ?? 0.65;
    const normalizedText = this.normalize(request.text);

    const deterministic = this.resolveDeterministic(normalizedText, request);
    if (deterministic) {
      return deterministic;
    }

    try {
      const parsed = await this.resolveWithLLM(request);
      const confidence = Number(parsed.confidence || 0);
      if (!Number.isFinite(confidence) || confidence < threshold) {
        return { matched: false, confidence, source: 'llm', raw: parsed };
      }

      return this.normalizeLlmResult(parsed, request, confidence);
    } catch (error) {
      appLogger.debug('[LlmOptionResolution] LLM fallback failed', {
        error: error instanceof Error ? error.message : String(error),
        mode: request.mode,
        text: request.text
      });
      return { matched: false, confidence: 0, source: 'llm' };
    }
  }

  fromToolParam(param: ToolParam): LlmParamSchemaField {
    return {
      name: param.name,
      type: param.type,
      description: param.description || param.extractPrompt,
      options: this.optionsFromToolParam(param),
      editable: !param.isHidden
    };
  }

  optionsFromToolParam(param: ToolParam): LlmResolutionOption[] {
    return (param.config?.options || []).map(option => ({
      key: String(option.value),
      label: String(option.label || option.value),
      aliases: Array.isArray((option as any).aliases) ? (option as any).aliases.map(String) : [],
      description: (option as any).description ? String((option as any).description) : undefined
    }));
  }

  private resolveDeterministic(
    normalizedText: string,
    request: LlmOptionResolutionRequest
  ): LlmOptionResolutionResult | null {
    if (request.mode === 'boolean') {
      const value = this.resolveBoolean(normalizedText);
      if (value !== undefined) {
        return { matched: true, value, confidence: 0.95, source: 'rule' };
      }
    }

    if (request.mode === 'enum' || request.mode === 'action') {
      const option = this.resolveOption(normalizedText, request.options || []);
      if (option) {
        return {
          matched: true,
          action: request.mode === 'action' ? option.key : undefined,
          value: request.mode === 'enum' ? option.key : undefined,
          confidence: option.source === 'rule' ? 0.95 : 0.82,
          source: option.source
        };
      }
    }

    return null;
  }

  private resolveBoolean(normalizedText: string): boolean | undefined {
    const trueValues = ['true', '1', 'yes', 'ya', 'iya', 'y', 'ok', 'oke', 'boleh', 'lanjut', 'setuju'];
    const falseValues = ['false', '0', 'no', 'tidak', 'nggak', 'gak', 'ga', 'n', 'batal', 'jangan'];

    if (trueValues.includes(normalizedText)) return true;
    if (falseValues.includes(normalizedText)) return false;

    const firstToken = normalizedText.split(/\s+/)[0] || '';
    if (['ya', 'iya', 'ok', 'oke', 'yes'].some(value => this.levenshtein(firstToken, value) <= 1)) {
      return true;
    }

    if (['no', 'ga', 'gak', 'nggak'].some(value => this.levenshtein(firstToken, value) <= 1)) {
      return false;
    }

    if (this.hasFuzzyToken(normalizedText, trueValues.filter(value => value.length >= 4))) return true;
    if (this.hasFuzzyToken(normalizedText, falseValues.filter(value => value.length >= 4))) return false;

    return undefined;
  }

  private resolveOption(
    normalizedText: string,
    options: LlmResolutionOption[]
  ): { key: string; source: LlmOptionResolutionSource } | null {
    for (const option of options) {
      const candidates = [option.key, option.label, ...(option.aliases || [])]
        .filter(Boolean)
        .map(value => this.normalize(String(value)));

      if (candidates.some(candidate => this.matchesToken(normalizedText, candidate))) {
        return { key: option.key, source: 'rule' };
      }
    }

    const tokens = normalizedText.split(/\s+/).filter(token => token.length >= 4);
    for (const option of options) {
      const candidates = [option.key, option.label, ...(option.aliases || [])]
        .filter(Boolean)
        .map(value => this.normalize(String(value)))
        .filter(value => value.length >= 4);

      if (tokens.some(token => candidates.some(candidate => this.levenshtein(token, candidate) <= 2))) {
        return { key: option.key, source: 'fuzzy' };
      }
    }

    return null;
  }

  private async resolveWithLLM(request: LlmOptionResolutionRequest): Promise<any> {
    const prompt = this.buildPrompt(request);
    const provider = config.default?.provider;
    const raw = provider === 'qwen' || provider === 'openai'
      ? await openAiService.generateJson(prompt, { temperature: 0, num_predict: 220 })
      : await ollamaService.generateJson(prompt);

    return JSON.parse(raw);
  }

  private normalizeLlmResult(
    parsed: any,
    request: LlmOptionResolutionRequest,
    confidence: number
  ): LlmOptionResolutionResult {
    if (request.mode === 'boolean') {
      if (typeof parsed.value === 'boolean') {
        return { matched: true, value: parsed.value, confidence, source: 'llm', raw: parsed };
      }
      return { matched: false, confidence, source: 'llm', raw: parsed };
    }

    if (request.mode === 'enum' || request.mode === 'action') {
      const key = String(parsed.value || parsed.action || '');
      const allowed = new Set((request.options || []).map(option => option.key));
      if (allowed.has(key)) {
        return {
          matched: true,
          action: request.mode === 'action' ? key : undefined,
          value: request.mode === 'enum' ? key : undefined,
          confidence,
          source: 'llm',
          raw: parsed
        };
      }
      return { matched: false, confidence, source: 'llm', raw: parsed };
    }

    if (request.mode === 'param_patch') {
      const paramsPatch = this.filterParamsPatch(parsed.paramsPatch || parsed.edit || {}, request.schema || []);
      if (Object.keys(paramsPatch).length > 0) {
        return { matched: true, paramsPatch, confidence, source: 'llm', raw: parsed };
      }
    }

    return { matched: false, confidence, source: 'llm', raw: parsed };
  }

  private filterParamsPatch(value: Record<string, unknown>, schema: LlmParamSchemaField[]): Record<string, unknown> {
    const allowed = new Map(schema.filter(field => field.editable !== false).map(field => [field.name, field]));
    const patch: Record<string, unknown> = {};

    for (const [name, rawValue] of Object.entries(value || {})) {
      const field = allowed.get(name);
      if (!field) continue;

      if (field.options?.length) {
        const option = this.resolveOption(this.normalize(String(rawValue)), field.options);
        if (option) patch[name] = option.key;
        continue;
      }

      patch[name] = rawValue;
    }

    return patch;
  }

  private buildPrompt(request: LlmOptionResolutionRequest): string {
    return `
Anda adalah resolver aman untuk input user yang mungkin typo.

Tujuan:
- Cocokkan input user hanya ke options/schema yang diberikan.
- Jangan mengarang option, action, atau field baru.
- Jika tidak yakin, return matched false atau action none.
- Return JSON valid saja.

Mode: ${request.mode}
Options:
${JSON.stringify(request.options || [], null, 2)}

Schema:
${JSON.stringify(request.schema || [], null, 2)}

Context:
${JSON.stringify(request.context || {}, null, 2)}

User text:
"${request.text}"

Output untuk boolean/enum/action:
{
  "matched": true,
  "value": "option_key atau boolean",
  "action": "action_key optional",
  "confidence": 0.0
}

Output untuk param_patch:
{
  "matched": true,
  "paramsPatch": {
    "field_name": "value"
  },
  "confidence": 0.0
}
`.trim();
  }

  private normalize(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[\/_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}:.\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private matchesToken(normalizedText: string, candidate: string): boolean {
    if (!candidate) return false;
    const pattern = new RegExp(`(^|\\s)${this.escapeRegex(candidate)}(\\s|$)`, 'i');
    return pattern.test(normalizedText);
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

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

export const llmOptionResolutionService = new LlmOptionResolutionService();
