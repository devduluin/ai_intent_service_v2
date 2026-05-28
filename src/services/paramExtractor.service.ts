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

    const normalizedText = text.toLowerCase()

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

    if (param.name === 'company_id') {
      const companyId = this.extractCompanyId(normalizedText)
      if (companyId) {
        return { name: param.name, value: companyId, confidence: 0.95 }
      }
    }

    if (param.name === 'date' || param.extractPrompt?.toLowerCase().includes('tanggal')) {
      const dateValue = this.extractDate(normalizedText)
      if (dateValue) {
        return { name: param.name, value: dateValue, confidence: 0.95 }
      }
    }

    if (param.name === 'status' && this.isAttendanceContext(normalizedText, param)) {
      const statusValue = this.extractAttendanceStatus(normalizedText)
      if (statusValue) {
        return { name: param.name, value: statusValue, confidence: 0.9 }
      }
      return { name: param.name, value: 'all', confidence: 0.6 }
    }

    if (param.name === 'all_company' && this.isAttendanceContext(normalizedText, param)) {
      const allCompanyValue = this.extractAllCompany(normalizedText)
      return { name: param.name, value: allCompanyValue, confidence: 0.6 }
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

  private extractCompanyId(text: string): string | undefined {
    const match = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)
    return match ? match[0] : undefined
  }

  private extractDate(text: string): string | undefined {
    if (text.includes('hari ini') || text.includes('today') || text.includes('tgl hari ini') || text.includes('tanggal hari ini')) {
      return this.getJakartaDate()
    }

    const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    }

    const slashMatch = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/)
    if (slashMatch) {
      const day = this.pad2(slashMatch[1])
      const month = this.pad2(slashMatch[2])
      return `${slashMatch[3]}-${month}-${day}`
    }

    const monthMatch = text.match(/\b(\d{1,2})\s+(jan|januari|feb|februari|mar|maret|apr|april|mei|jun|juni|jul|juli|agu|agustus|sep|september|okt|oktober|nov|november|des|desember)\s*(\d{4})?\b/)
    if (monthMatch) {
      const day = this.pad2(monthMatch[1])
      const month = this.monthToNumber(monthMatch[2])
      const year = monthMatch[3] || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric' })
      if (month) {
        return `${year}-${month}-${day}`
      }
    }

    return undefined
  }

  private extractAttendanceStatus(text: string): string | undefined {
    if (text.includes('izin') || text.includes('cuti') || text.includes('leave')) return 'leave'
    if (text.includes('telat') || text.includes('terlambat') || text.includes('late')) return 'late'
    if (text.includes('hadir') || text.includes('present')) return 'present'
    if (this.hasAbsentKeyword(text)) return 'absent'
    if (text.includes('all') || text.includes('semua status') || text.includes('semua')) return 'all'
    return undefined
  }

  private extractAllCompany(text: string): boolean {
    if (text.includes('company tertentu') || text.includes('hanya company ini') || text.includes('company ini saja')) {
      return false
    }
    return true
  }

  private hasAbsentKeyword(text: string): boolean {
    return /\b(absen|absent|alpha)\b/.test(text) || text.includes('tidak hadir')
  }

  private isAttendanceContext(text: string, param: ToolParam): boolean {
    if (/\b(absensi|kehadiran|presensi|attendance)\b/.test(text)) return true
    return /absensi|kehadiran|presensi|attendance/.test((param.extractPrompt || '').toLowerCase())
  }

  private monthToNumber(month: string): string | undefined {
    const map: Record<string, string> = {
      jan: '01', januari: '01',
      feb: '02', februari: '02',
      mar: '03', maret: '03',
      apr: '04', april: '04',
      mei: '05',
      jun: '06', juni: '06',
      jul: '07', juli: '07',
      agu: '08', agustus: '08',
      sep: '09', september: '09',
      okt: '10', oktober: '10',
      nov: '11', november: '11',
      des: '12', desember: '12',
    }

    return map[month]
  }

  private pad2(value: string): string {
    return value.padStart(2, '0')
  }

  private getJakartaDate(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
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
