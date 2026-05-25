import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { ToolParam } from '../types'
import { extractTimezoneFromText } from '../utils/timezone.utils'
import { extractLocation, resolveLocation } from '../utils/location.utils';
import { config } from '../config'

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

    // 🔥 extract parallel biar cepat
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

  // --------------------------------------------------
  // Extract 1 parameter
  // --------------------------------------------------
  private async extractSingle(text: string, param: ToolParam): Promise<ExtractedParamWithValue> {
    if (!param.extractPrompt) {
      return { name: param.name, value: undefined, confidence: 0.5 }
    }

    let rawValue: unknown = null
    let confidence: number = 0.5

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

    const value = this.castType(rawValue, param.type)
    return { name: param.name, value, confidence }
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
        if (lower.includes('true')) return true
        if (lower.includes('false')) return false
        return undefined

      default:
        return cleanValue
    }
  }
}

export const paramExtractorService = new ParamExtractorService()