import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { ToolParam } from '../types'
import { extractTimezoneFromText } from '../utils/timezone.utils'
import { extractLocation, resolveLocation } from '../utils/location.utils';
import { config } from '../config'
import { parseTemporalExpressions } from '../utils/temporal/temporal-expression-parser.util'
import { llmOptionResolutionService } from './llm-option-resolution.service'
import {
  cleanAutomationGoalText,
  isGenericAutomationGoal,
  normalizeAutomationTypeLabel
} from '../utils/automation-param.util'

export interface ExtractedParamWithValue {
  name: string
  value: unknown
  confidence: number
}

export interface ExtractedParamsWithConfidence {
  params: Record<string, unknown>
  confidences: Record<string, number>
  lowConfidenceParams: string[]
}

class ParamExtractorService {

  async extractAll(
    text: string,
    params?: ToolParam[]
  ): Promise<ExtractedParamsWithConfidence> {

    if (!params || params.length === 0) {
      return { params: {}, confidences: {}, lowConfidenceParams: [] }
    }

    const CONFIDENCE_THRESHOLD = 0.5

    // ✅ OPTIMIZATION: Use batch extraction for continuation queries
    // Check if this is a continuation query (short query with cached params)
    if (this.isContinuationQuery(text, params)) {
      return await this.extractBatch(text, params);
    }

    // 🔥 extract parallel biar cepat (original flow for complex queries)
    const results = await Promise.all(
      params.map(p => this.extractSingle(text, p))
    )

    // gabung ke object dengan confidence
    const extracted: Record<string, unknown> = {}
    const confidences: Record<string, number> = {}
    const lowConfidenceParams: string[] = []

    for (const r of results) {
      extracted[r.name] = r.value
      confidences[r.name] = r.confidence

      if (r.confidence < CONFIDENCE_THRESHOLD) {
        lowConfidenceParams.push(r.name)
      }
    }

    console.log('[ParamExtractor] Extraction results:', {
      params: extracted,
      confidences,
      lowConfidenceParams
    })

    return { params: extracted, confidences, lowConfidenceParams }
  }

  /**
   * Check if query is a continuation query (short, likely uses cached params)
   */
  private isContinuationQuery(text: string, params: ToolParam[]): boolean {
    // Short queries (< 10 words) are likely continuation queries
    const wordCount = text.trim().split(/\s+/).length;
    return wordCount <= 5;
  }

  /**
   * Batch extraction - single LLM call for all params
   */
  private async extractBatch(
    text: string,
    params: ToolParam[]
  ): Promise<ExtractedParamsWithConfidence> {
    const extracted: Record<string, unknown> = {}
    const confidences: Record<string, number> = {}
    const lowConfidenceParams: string[] = []

    // First, try rule-based extraction for known types
    for (const param of params) {
      const automationValue = this.extractAutomationParamValue(text, param);
      if (automationValue !== undefined) {
        extracted[param.name] = automationValue;
        confidences[param.name] = 0.95;
        continue;
      }

      const selectValue = await this.resolveSelectOptionValue(text, param);
      if (selectValue !== undefined) {
        extracted[param.name] = selectValue;
        confidences[param.name] = 0.95;
        continue;
      }

      if (param.type === 'boolean') {
        const booleanValue = await this.resolveBooleanValue(text, param);
        if (booleanValue !== undefined) {
          extracted[param.name] = booleanValue;
          confidences[param.name] = 0.95;
          continue;
        }
      }

      // SPECIAL HANDLING UNTUK TIMEZONE
      if (param.name === 'timezone' || param.extractPrompt?.toLowerCase().includes('timezone')) {
        const timezone = extractTimezoneFromText(text);
        if (timezone) {
          extracted[param.name] = timezone;
          confidences[param.name] = 0.95;
          continue;
        }
      }

      // SPECIAL HANDLING UNTUK LOCATION/CITY
      if (param.name === 'city' || param.name === 'location' ||
          param.extractPrompt?.toLowerCase().includes('kota')) {
        const location = extractLocation(text);
        if (location) {
          const value = this.castType(location, param.type);
          extracted[param.name] = value;
          confidences[param.name] = 0.95;
          continue;
        }
      }
    }

    // For remaining params, use single batch LLM call
    const remainingParams = params.filter(p => !(p.name in extracted));
    
    if (remainingParams.length > 0) {
      const batchResult = await this.extractBatchWithLLM(text, remainingParams);

      for (const [name, value] of Object.entries(batchResult.params)) {
        const param = remainingParams.find(p => p.name === name);
        extracted[name] = param ? this.normalizeExtractedValue(value, param) : value;
        confidences[name] = batchResult.confidences[name] || 0.5;

        if (confidences[name] < 0.5) {
          lowConfidenceParams.push(name);
        }
      }
    }

    return { params: extracted, confidences, lowConfidenceParams }
  }

  /**
   * Single LLM call for all remaining params
   */
  private async extractBatchWithLLM(
    text: string,
    params: ToolParam[]
  ): Promise<ExtractedParamsWithConfidence> {
    const paramSchema = params.map(p => ({
      name: p.name,
      type: p.type,
      description: p.description,
      extractPrompt: p.extractPrompt,
      options: p.config?.options || []
    }));

    const prompt = `
Ekstrak nilai parameter dari query pengguna.

PARAMETER YANG HARUS DIEKSTRAK
${JSON.stringify(paramSchema, null, 2)}

ATURAN:
- Ekstrak hanya parameter yang benar-benar ditemukan di query.
- Jangan mengarang nilai parameter.
- Untuk parameter select/multiselect, nilai wajib salah satu dari options.value.
- Jika user typo atau memakai label/sinonim, pilih options.value terdekat hanya jika yakin.

QUERY PENGGUNA:
"${text}"

RESPON HARUS FORMAT JSON VALID:
{
  "extractedParams": {
    "param_name": "extracted_value"
  },
  "confidences": {
    "param_name": 0.0-1.0
  }
}

CONTOH:
Query: "kalau besok"
Parameters: [{name: "date", type: "string"}]
Response: {
  "extractedParams": { "date": "besok" },
  "confidences": { "date": 0.95 }
}

RESPOND:
`.trim();

    try {
      const provider = config.default?.provider || 'ollama'
      let response: string;

      if (provider === 'qwen') {
        try {
          response = await openAiService.chatMessage(
            [{ role: 'user', content: prompt }],
            config.alibaba?.llmModel || 'gpt-3.5-turbo',
            { temperature: 0.1, num_predict: 500 }
          )
        } catch {
          // Fallback to ollama if openai fails
          response = await ollamaService.chatMessage(
            [{ role: 'user', content: prompt }],
            config.ollama?.llmModel,
            { temperature: 0.1, num_predict: 500 }
          )
        }
      } else {
        response = await ollamaService.chatMessage(
          [{ role: 'user', content: prompt }],
          config.ollama?.llmModel,
          { temperature: 0.1, num_predict: 500 }
        )
      }

      const parsed = JSON.parse(response);
      return {
        params: parsed.extractedParams || {},
        confidences: parsed.confidences || {},
        lowConfidenceParams: []
      };
    } catch (error) {
      console.error('[ParamExtractor] Batch extraction failed:', error);
      return { params: {}, confidences: {}, lowConfidenceParams: [] };
    }
  }

  // --------------------------------------------------
  // Extract 1 parameter
  // --------------------------------------------------
  private async extractSingle(text: string, param: ToolParam): Promise<ExtractedParamWithValue> {
    const automationValue = this.extractAutomationParamValue(text, param);
    if (automationValue !== undefined) {
      return {
        name: param.name,
        value: automationValue,
        confidence: 0.95
      }
    }

    if (!param.extractPrompt) {
      return { name: param.name, value: undefined, confidence: 0.5 }
    }

    let rawValue: unknown = null
    let confidence: number = 0.5

      const selectValue = await this.resolveSelectOptionValue(text, param)
      if (selectValue !== undefined) {
        return {
          name: param.name,
        value: selectValue,
        confidence: 0.95
      }
    }

    if (param.type === 'boolean') {
      const booleanValue = await this.resolveBooleanValue(text, param)
      if (booleanValue !== undefined) {
        return {
          name: param.name,
          value: booleanValue,
          confidence: 0.95
        }
      }
    }

    // SPECIAL HANDLING UNTUK TIMEZONE
    if (param.name === 'timezone' || param.extractPrompt.toLowerCase().includes('timezone')) {
      console.log(`[ParamExtractor] Special handling for timezone`);

      // Gunakan utils function
      const timezone = extractTimezoneFromText(text);
      if (timezone) {
        console.log(`[ParamExtractor] Extracted timezone via rule-based: ${timezone}`);
        rawValue = timezone;
        confidence = 0.95 // Rule-based extraction has high confidence
      }
    }

    if (param.name === 'city' || param.name === 'location' ||
        param.extractPrompt?.toLowerCase().includes('kota')) {

      const location = extractLocation(text);
      if (location) {
        console.log(`[ParamExtractor] Extracted location via rule-based: ${location}`);
        const value = this.castType(location, param.type);
        return { name: param.name, value, confidence: 0.95 }
      }
    }

    // Jika belum dapat value, fallback ke LLM
    if (rawValue === null) {
      // Pilih service berdasarkan config.default.provider
      const provider = config.default?.provider || 'ollama'

      if (provider === 'qwen') {
        const result = await openAiService.extractParam(
          text,
          param.extractPrompt,
          param.type,
          param.defaultValue
        );
        rawValue = result.value;
        confidence = result.confidence;
      } else {
        // Ollama belum support confidence, wrap dengan default confidence
        const value = await ollamaService.extractParam(
          text,
          param.extractPrompt,
          param.type,
          param.defaultValue
        );
        rawValue = value;
        confidence = value !== null ? 0.7 : 0.3 // Heuristic confidence for ollama
      }
    }

    const value = this.normalizeExtractedValue(rawValue, param)
    return { name: param.name, value, confidence }
  }

  private normalizeExtractedValue(value: unknown, param: ToolParam): unknown {
    if (param.name === 'goal' && this.isGenericAutomationGoal(value)) {
      return undefined
    }

    if (param.type === 'select') {
      const selectValue = this.extractSelectOptionValue(String(value ?? ''), param)
      if (selectValue !== undefined) {
        return selectValue
      }
    }

    return this.castType(value, param.type)
  }

    private isGenericAutomationGoal(value: unknown): boolean {
      return isGenericAutomationGoal(value)
    }

  private async resolveSelectOptionValue(text: string, param: ToolParam): Promise<string | undefined> {
    const deterministic = this.extractSelectOptionValue(text, param)
    if (deterministic !== undefined) {
      return deterministic
    }

    if (param.type !== 'select' || !param.config?.options?.length) {
      return undefined
    }

    const result = await llmOptionResolutionService.resolve({
      text,
      mode: 'enum',
      minConfidence: 0.65,
      options: llmOptionResolutionService.optionsFromToolParam(param),
      context: {
        param: llmOptionResolutionService.fromToolParam(param)
      }
    })

    return result.matched && typeof result.value === 'string' ? result.value : undefined
  }

  private async resolveBooleanValue(text: string, param?: ToolParam): Promise<boolean | undefined> {
    const deterministic = this.extractBooleanValue(text, param)
    if (deterministic !== undefined) {
      return deterministic
    }

    const result = await llmOptionResolutionService.resolve({
      text,
      mode: 'boolean',
      minConfidence: 0.65,
      context: {
        param: param ? llmOptionResolutionService.fromToolParam(param) : undefined
      }
    })

    return result.matched && typeof result.value === 'boolean' ? result.value : undefined
  }

  // --------------------------------------------------
  // Type Casting
  // --------------------------------------------------
  private castType(value: unknown, type: ToolParam['type']) {
    if (value == null) return undefined
    
    // Bersihkan value dari noise (spasi berlebih) tapi JANGAN potong berdasarkan /
    let cleanValue = String(value).trim();

    switch (type) {
      case 'number':
        const num = Number(cleanValue)
        if (isNaN(num)) return undefined;
        return num

      case 'boolean':
        const lower = cleanValue.toLowerCase()
        if (this.matchesBooleanCandidate(lower, this.getBooleanTrueValues())) return true
        if (this.matchesBooleanCandidate(lower, this.getBooleanFalseValues())) return false
        return undefined

      default:
        return cleanValue
    }
  }

  private extractBooleanValue(text: string, param?: ToolParam): boolean | undefined {
    const normalized = this.normalizeForMatch(text)
    const trueValues = this.getBooleanTrueValues(param)
    const falseValues = this.getBooleanFalseValues(param)

    if (this.matchesBooleanCandidate(normalized, trueValues)) {
      return true
    }

    if (this.containsBooleanCandidate(normalized, trueValues)) {
      return true
    }

    if (this.matchesBooleanCandidate(normalized, falseValues)) {
      return false
    }

    return undefined
  }

  private getBooleanTrueValues(param?: ToolParam): string[] {
    return [
      'true',
      '1',
      'yes',
      'ya',
      'iya',
      'y',
      'ok',
      'oke',
      ...(param?.config?.trueValues || [])
    ].map(value => this.normalizeForMatch(String(value)))
  }

  private getBooleanFalseValues(param?: ToolParam): string[] {
    return [
      'false',
      '0',
      'no',
      'tidak',
      'nggak',
      'gak',
      'ga',
      'n',
      ...(param?.config?.falseValues || [])
    ].map(value => this.normalizeForMatch(String(value)))
  }

  private matchesBooleanCandidate(normalizedText: string, candidates: string[]): boolean {
    return candidates.some(candidate => normalizedText === candidate)
  }

  private containsBooleanCandidate(normalizedText: string, candidates: string[]): boolean {
    return candidates
      .filter(candidate => candidate.length > 1)
      .some(candidate => this.matchesOption(normalizedText, candidate))
  }

  private extractSelectOptionValue(text: string, param: ToolParam): string | undefined {
    if (param.type !== 'select' || !param.config?.options?.length) {
      return undefined
    }

    const normalizedText = this.normalizeForMatch(text)

    for (const option of param.config.options) {
      const value = String(option.value)
      const label = String(option.label)
      const candidates = [
        value,
        label,
        ...this.getSelectSynonyms(value, label)
      ]

      if (candidates.some(candidate => this.matchesOption(normalizedText, candidate))) {
        return value
      }
    }

    return undefined
  }

  private matchesOption(normalizedText: string, candidate: string): boolean {
    const normalizedCandidate = this.normalizeForMatch(candidate)
    if (!normalizedCandidate) {
      return false
    }

    const pattern = new RegExp(`(^|\\s)${this.escapeRegex(normalizedCandidate)}(\\s|$)`, 'i')
    return pattern.test(normalizedText)
  }

  private normalizeForMatch(value: string): string {
    return value
      .toLowerCase()
      .replace(/[\/_-]+/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private getSelectSynonyms(value: string, label: string): string[] {
    const normalizedValue = value.toLowerCase()
    const normalizedLabel = label.toLowerCase()

    const synonyms: Record<string, string[]> = {
      active: ['aktif', 'berjalan'],
      leave: ['cuti', 'izin', 'cuti izin', 'cuti/izin'],
      exit: ['keluar', 'nonaktif', 'berhenti']
    }

    return [
      ...(synonyms[normalizedValue] || []),
      ...(synonyms[normalizedLabel] || [])
    ]
  }

  private extractAutomationParamValue(text: string, param: ToolParam): unknown {
    const name = param.name;
    if (!['automation_type', 'schedule', 'goal', 'condition'].includes(name)) {
      return undefined;
    }

    const normalizedText = String(text || '').trim();
    if (!normalizedText) {
      return undefined;
    }

      if (name === 'automation_type') {
        const typeFromLabel = normalizeAutomationTypeLabel(normalizedText);
        if (typeFromLabel) return typeFromLabel;

        const lowered = this.normalizeForMatch(normalizedText);
        if (/\b(reminder|pengingat|ingatkan|remind)\b/i.test(lowered)) return 'reminder';
        if (/\b(scheduled workflow|workflow terjadwal|jadwal|jadwalkan|setiap|tiap|schedule|recurring)\b/i.test(lowered)) return 'scheduled_workflow';
        if (/\b(conditional alert|pantau|monitor|kalau|jika|if|when)\b/i.test(lowered)) return 'conditional_alert';
        return undefined;
      }

    if (name === 'schedule') {
      const schedule = this.extractScheduleText(normalizedText);
      return schedule || undefined;
    }

    if (name === 'goal') {
      const goal = this.extractAutomationGoalText(normalizedText);
      return goal || undefined;
    }

    if (name === 'condition') {
      const lowered = normalizedText.toLowerCase();
      const match = lowered.match(/\b(kalau|jika|if|when)\b(.+)$/i);
      return match?.[2]?.trim() || undefined;
    }

    return undefined;
  }

  private extractScheduleText(text: string): string | undefined {
    const expressions = parseTemporalExpressions(text, { locale: 'auto', timezone: 'Asia/Jakarta' });
    const expression = expressions.find(item => item.kind === 'datetime' || item.kind === 'recurrence' || item.kind === 'date');
    if (expression?.raw) {
      return expression.raw;
    }

    const clockOnly = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
    if (clockOnly) {
      return clockOnly[0].replace('.', ':');
    }

    const spokenClock = text.match(/\b(?:jam|pukul)\s+([01]?\d|2[0-3])\s+([0-5]\d)\b/i);
    if (spokenClock) {
      return `${spokenClock[1].padStart(2, '0')}:${spokenClock[2]}`;
    }

    return undefined;
  }

    private extractAutomationGoalText(text: string): string | undefined {
      let goal = text;
      const schedule = this.extractScheduleText(goal);
      if (schedule) {
        goal = goal.replace(new RegExp(this.escapeRegex(schedule), 'i'), ' ');
      }

      return cleanAutomationGoalText(goal);
    }
}

export const paramExtractorService = new ParamExtractorService()
