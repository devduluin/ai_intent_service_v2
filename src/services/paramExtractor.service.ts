import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { ToolParam } from '../types'
import { extractTimezoneFromText } from '../utils/timezone.utils'
import { extractLocation, resolveLocation } from '../utils/location.utils';
import { config } from '../config'

class ParamExtractorService {

  async extractAll(
    text: string,
    params?: ToolParam[]
  ): Promise<Record<string, unknown>> {

    if (!params || params.length === 0) return {}

    // 🔥 extract parallel biar cepat
    const results = await Promise.all(
      params.map(p => this.extractSingle(text, p))
    )

    // gabung ke object
    const extracted: Record<string, unknown> = {}
    for (const r of results) {
      extracted[r.name] = r.value
    }

    // validasi required param
    // this.validateRequired(params, extracted)

    return extracted
  }

  // --------------------------------------------------
  // Extract 1 parameter
  // --------------------------------------------------
  private async extractSingle(text: string, param: ToolParam) {
    if (!param.extractPrompt) {
      return { name: param.name, value: undefined }
    }

    let rawValue: unknown = null;

    // SPECIAL HANDLING UNTUK TIMEZONE
    if (param.name === 'timezone' || param.extractPrompt.toLowerCase().includes('timezone')) {
      console.log(`[ParamExtractor] Special handling for timezone`);
      
      // Gunakan utils function
      const timezone = extractTimezoneFromText(text);
      if (timezone) {
        console.log(`[ParamExtractor] Extracted timezone via rule-based: ${timezone}`);
        rawValue = timezone;
      }
    }

    if (param.name === 'city' || param.name === 'location' || 
        param.extractPrompt?.toLowerCase().includes('kota')) {
      
      const location = extractLocation(text);
      if (location) {
        console.log(`[ParamExtractor] Extracted location via rule-based: ${location}`);
        const value = this.castType(location, param.type);
        return { name: param.name, value };
      }
    }

    // Jika belum dapat value, fallback ke LLM
    if (rawValue === null) {
      // Pilih service berdasarkan config.default.provider
      const provider = config.default?.provider || 'ollama'
      
      if (provider === 'openai') {
        rawValue = await openAiService.extractParam(
          text,
          param.extractPrompt,
          param.type,
          param.defaultValue
        );
      } else {
        rawValue = await ollamaService.extractParam(
          text,
          param.extractPrompt,
          param.type,
          param.defaultValue
        );
      }
    }

    const value = this.castType(rawValue, param.type)
    return { name: param.name, value }
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