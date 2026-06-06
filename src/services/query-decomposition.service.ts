import { appLogger } from '../utils/logger.util'
import { resolveTemporalExpression } from '../utils/dateHumanID'
import { parseTemporalExpressions, formatDateToISO as formatTemporalDateToISO } from '../utils/temporal/temporal-expression-parser.util'

// ============================================================
// Types
// ============================================================

export type DecompositionReason =
  | 'empty_query'
  | 'single_intent'
  | 'multi_action_connectors'
  | 'too_many_parts_limited'
  | 'fallback_original'

export interface UserMessageSignals {
  actionHints: string[]
  formatHints: string[]
  temporalHints: string[]
  temporalDetails?: {
    type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative'
    value: string
    normalizedValue?: string
    direction?: 'current' | 'past' | 'future'
  }[]
  comparison?: {
    isComparison: boolean
    operator: 'compare' | 'versus' | 'difference' | 'trend'
    baseline?: {
      source: 'current_query' | 'working_memory' | 'explicit'
      temporalDetails?: NonNullable<UserMessageSignals['temporalDetails']>
      params?: Record<string, unknown>
    }
    target?: {
      temporalDetails?: NonNullable<UserMessageSignals['temporalDetails']>
      params?: Record<string, unknown>
    }
    textSpan?: string
  }
  skill?: {
    hasStrongSignal: boolean
    recommendedSkill?: string
    candidates: Array<{
      slug: string
      name: string
      confidence: number
      matchedBy: string[]
      matchedText: string[]
      category?: string
    }>
  }
  entityHints: string[]
  asksForFile: boolean
  asksForRealtimeData: boolean
  isQuestion: boolean
  language: 'id' | 'en' | 'unknown'
}

export interface DecomposedQuery {
  originalQuery: string
  normalizedQuery: string
  primaryQuery: string
  subQueries: string[]
  hasMultipleIntents: boolean
  connectors: string[]
  confidence: number
  reason: DecompositionReason
  signals: UserMessageSignals
}

export interface DecompositionConfig {
  minQueryLength: number
  maxSubQueries: number
}

type Segment = {
  text: string
  connector?: string
}

const DEFAULT_CONFIG: DecompositionConfig = {
  minQueryLength: 4,
  maxSubQueries: 5,
}

const STRONG_CONNECTORS = [
  'setelah itu',
  'kemudian',
  'lalu',
  'terus',
  'selanjutnya',
  'habis itu',
  'dan',
  'after that',
  'and',
  'then',
  'next',
]

const CONDITIONAL_CONNECTORS = [
  'dan',
  'serta',
  'sekalian',
  'plus',
  'juga',
  'sambil',
  'also',
]

const ACTION_PATTERNS = [
  /\bcek\b/i,
  /\bcheck\b/i,
  /\bcari\b/i,
  /\bsearch\b/i,
  /\bambil\b/i,
  /\bget\b/i,
  /\btampilkan\b/i,
  /\bshow\b/i,
  /\bbuat(?:kan)?\b/i,
  /\bgenerate\b/i,
  /\bexport\b/i,
  /\bkirim\b/i,
  /\bsend\b/i,
  /\bhitung\b/i,
  /\bcalculate\b/i,
  /\bringkas\b/i,
  /\bsummarize\b/i,
  /\bbandingkan\b/i,
  /\bcompare\b/i,
  /\bubah\b/i,
  /\bconvert\b/i,
  /\btambah(?:kan)?\b/i,
  /\badd\b/i,
]

const FORMAT_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'xlsx', pattern: /\b(excel|xlsx|xls|spreadsheet)\b/i },
  { key: 'csv', pattern: /\b(csv|comma separated)\b/i },
  { key: 'pdf', pattern: /\b(pdf)\b/i },
  { key: 'json', pattern: /\b(json)\b/i },
  { key: 'txt', pattern: /\b(txt|text|plain text)\b/i },
]

// ============================================================
// TEMPORAL EXPRESSIONS - Single source of truth
// Extracted from TEMPORAL_PATTERNS for use in extractTemporalDetails
// ============================================================
const TEMPORAL_EXPRESSIONS = [
  // Indonesian - Days
  'hari ini', 'besok', 'lusa', 'kemarin', 'kemarin lusa',
  // Indonesian - Weeks
  'minggu ini', 'minggu depan', 'minggu lalu', 'minggu kemarin',
  // Indonesian - Months
  'bulan ini', 'bulan depan', 'bulan lalu', 'bulan kemarin',
  // Indonesian - Years
  'tahun ini', 'tahun depan', 'tahun lalu',
  // Indonesian - Quarters
  'kuartal ini', 'kuartal depan', 'kuartal lalu',
  // Indonesian - Periods
  'periode ini', 'periode depan', 'periode lalu',
  // Current time (Sekarang/Now)
  'sekarang', 'saat ini', 'kini',
  // English - Days
  'today', 'tomorrow', 'yesterday', 'day after tomorrow', 'day before yesterday',
  // English - Weeks
  'this week', 'next week', 'last week',
  // English - Months
  'this month', 'next month', 'last month',
  // English - Years
  'this year', 'next year', 'last year',
  // English - Quarters
  'this quarter', 'next quarter', 'last quarter',
  // Current time (English)
  'now', 'right now', 'currently',
]

// Month names - Single source of truth (used in both TEMPORAL_PATTERNS and extractTemporalDetails)
const INDONESIAN_MONTH_NAMES = [
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember'
]

const ENGLISH_MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
]

const TEMPORAL_PATTERNS = [
  // Indonesian - Days
  /\bhari ini\b/i,
  /\bbesok\b/i,
  /\blusa\b/i,
  /\bkemarin\b/i,
  /\bKemarin lusa\b/i,

  // Indonesian - Weeks
  /\bminggu ini\b/i,
  /\bminggu depan\b/i,
  /\bminggu lalu\b/i,
  /\bminggu kemarin\b/i,

  // Indonesian - Months
  /\bbulan ini\b/i,
  /\bbulan depan\b/i,
  /\bbulan lalu\b/i,
  /\bbulan kemarin\b/i,

  // Indonesian - Years
  /\btahun ini\b/i,
  /\btahun depan\b/i,
  /\btahun lalu\b/i,
  /\btahun kemarin\b/i,

  // Indonesian - Quarters
  /\bkuartal ini\b/i,
  /\bkuartal depan\b/i,
  /\bkuartal lalu\b/i,

  // Indonesian - Periods
  /\bperiode ini\b/i,
  /\bperiode depan\b/i,
  /\bperiode lalu\b/i,

  // Current time expressions (Sekarang/Now)
  /\bsekarang\b/i,
  /\bsaat ini\b/i,
  /\bkini\b/i,
  /\bnow\b/i,
  /\bright now\b/i,
  /\bcurrently\b/i,

  // English - Days
  /\btoday\b/i,
  /\btomorrow\b/i,
  /\bday after tomorrow\b/i,
  /\byesterday\b/i,
  /\bday before yesterday\b/i,

  // English - Weeks
  /\bthis week\b/i,
  /\bnext week\b/i,
  /\blast week\b/i,

  // English - Months
  /\bthis month\b/i,
  /\bnext month\b/i,
  /\blast month\b/i,

  // English - Years
  /\bthis year\b/i,
  /\bnext year\b/i,
  /\blast year\b/i,

  // English - Quarters
  /\bthis quarter\b/i,
  /\bnext quarter\b/i,
  /\blast quarter\b/i,

  // Date formats
  /\b\d{4}-\d{2}-\d{2}\b/,  // 2024-01-15
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,  // 15/01/2024 or 01/15/2024
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,  // 15-01-2024

  // Indonesian month names
  /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/i,

  // English month names
  /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i,

  // Relative time
  /\b\d+\s*(hari|week|weeks|month|months|year|years)\s*(yang lalu|ago|depan|from now)\b/i,
  /\b(beberapa|a few|several)\s*(hari|week|weeks|month|months|year|years)\b/i,
]

const REALTIME_PATTERNS = [
  /\bcuaca\b/i,
  /\bweather\b/i,
  /\bjam\b/i,
  /\bwaktu\b/i,
  /\btime\b/i,
  /\bharga\b/i,
  /\bprice\b/i,
  /\bstok\b/i,
  /\bstock\b/i,
  /\bstatus\b/i,
]

const MODIFIER_PATTERNS = [
  /^\s*tambah(?:kan)?\b/i,
  /^\s*sertakan\b/i,
  /^\s*include\b/i,
  /^\s*pakai\b/i,
  /^\s*gunakan\b/i,
  /^\s*dengan\b/i,
  /^\s*with\b/i,
]

class QueryDecompositionService {
  private config: DecompositionConfig

  constructor(config?: Partial<DecompositionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  decompose(query: string): DecomposedQuery {
    const originalQuery = query.trim()
    const normalizedQuery = this.normalizeQuery(originalQuery)
    const signals = this.extractSignals(originalQuery)

    if (!normalizedQuery) {
      return this.buildResult({
        originalQuery,
        normalizedQuery,
        subQueries: [],
        connectors: [],
        confidence: 1,
        reason: 'empty_query',
        signals,
      })
    }

    const segments = this.segmentQuery(originalQuery)
    const candidateParts = this.buildSubQueriesFromSegments(segments)
    const filteredParts = this.filterAndDeduplicate(candidateParts)

    if (filteredParts.length <= 1) {
      return this.buildResult({
        originalQuery,
        normalizedQuery,
        subQueries: [originalQuery],
        connectors: [],
        confidence: 0.9,
        reason: 'single_intent',
        signals,
      })
    }

    const limitedParts = filteredParts.slice(0, this.config.maxSubQueries)
    const reason: DecompositionReason =
      filteredParts.length > this.config.maxSubQueries
        ? 'too_many_parts_limited'
        : 'multi_action_connectors'

    const connectors = segments
      .map(segment => segment.connector)
      .filter((connector): connector is string => Boolean(connector))

    appLogger.info('Query decomposed', {
      originalLength: originalQuery.length,
      subQueryCount: limitedParts.length,
      connectors,
      reason,
      signals: {
        actions: signals.actionHints,
        formats: signals.formatHints,
        asksForFile: signals.asksForFile,
        asksForRealtimeData: signals.asksForRealtimeData,
      }
    })

    return this.buildResult({
      originalQuery,
      normalizedQuery,
      subQueries: limitedParts,
      connectors,
      confidence: 0.82,
      reason,
      signals,
    })
  }

  extractSignals(query: string): UserMessageSignals {
    const normalized = this.normalizeQuery(query)
    const actionHints = ACTION_PATTERNS
      .filter(pattern => pattern.test(query))
      .map(pattern => this.patternLabel(pattern))

    const formatHints = FORMAT_PATTERNS
      .filter(item => item.pattern.test(query))
      .map(item => item.key)

    const temporalHints = TEMPORAL_PATTERNS
      .filter(pattern => pattern.test(query))
      .map(pattern => this.patternLabel(pattern))

    const temporalDetails = this.extractTemporalDetails(query)
    const comparison = this.extractComparisonSignal(query, temporalDetails)

    return {
      actionHints: [...new Set(actionHints)],
      formatHints: [...new Set(formatHints)],
      temporalHints: [...new Set(temporalHints)],
      temporalDetails,
      comparison,
      entityHints: this.extractEntityHints(query),
      asksForFile: /\b(file|berkas|dokumen|excel|xlsx|csv|pdf|export|download)\b/i.test(query),
      asksForRealtimeData: REALTIME_PATTERNS.some(pattern => pattern.test(query)),
      isQuestion: /[?]$/.test(query.trim()) || /^(apa|apakah|bagaimana|gimana|berapa|siapa|kapan|di mana|what|how|why|who|when|where)\b/i.test(normalized),
      language: this.detectLanguage(normalized),
    }
  }

  needsDecomposition(query: string): boolean {
    return this.decompose(query).hasMultipleIntents
  }

  getPriorityConnector(query: string): string | null {
    const segments = this.segmentQuery(query)
    return segments.find(segment => segment.connector)?.connector || null
  }

  mergeResults(results: Array<{ intent: string; result: any }>): string {
    if (results.length === 0) return ''
    if (results.length === 1) return results[0].result || ''

    return results
      .map((result, index) => {
        const intentName = result.intent || `Intent ${index + 1}`
        return `${intentName}: ${result.result || 'No result'}`
      })
      .join('\n\n')
  }

  updateConfig(config: Partial<DecompositionConfig>): void {
    this.config = { ...this.config, ...config }
    appLogger.info('Query decomposition config updated', {
      config: this.config
    })
  }

  getConfig(): DecompositionConfig {
    return { ...this.config }
  }

  addConnector(_connector: string): void {
    appLogger.warn('Dynamic connectors are no longer supported; update connector constants instead')
  }

  removeConnector(_connector: string): void {
    appLogger.warn('Dynamic connectors are no longer supported; update connector constants instead')
  }

  private segmentQuery(query: string): Segment[] {
    const protectedQuery = this.protectQuotedText(query)
    const connectorRegex = this.buildConnectorRegex()
    const rawParts = protectedQuery.split(connectorRegex).filter(Boolean)

    if (rawParts.length === 1) {
      return [{ text: this.restoreQuotedText(rawParts[0]) }]
    }

    const segments: Segment[] = []
    let currentConnector: string | undefined

    for (const part of rawParts) {
      const trimmed = part.trim()
      if (!trimmed) continue

      const connector = this.normalizeConnector(trimmed)
      if (connector) {
        currentConnector = connector
        continue
      }

      segments.push({
        text: this.restoreQuotedText(trimmed),
        connector: currentConnector,
      })
      currentConnector = undefined
    }

    return segments
  }

  private buildSubQueriesFromSegments(segments: Segment[]): string[] {
    if (segments.length <= 1) return segments.map(segment => segment.text)

    const parts: string[] = []
    let buffer = segments[0]?.text || ''

    for (let index = 1; index < segments.length; index++) {
      const segment = segments[index]
      const connector = segment.connector || ''
      const shouldSplit = this.shouldSplitSegment(buffer, segment.text, connector)

      if (shouldSplit) {
        parts.push(buffer)
        buffer = segment.text
      } else {
        buffer = `${buffer} ${connector} ${segment.text}`.trim()
      }
    }

    if (buffer) parts.push(buffer)
    return parts
  }

  private shouldSplitSegment(previous: string, next: string, connector: string): boolean {
    const normalizedConnector = connector.toLowerCase()

    if (this.isModifierSegment(next)) {
      return false
    }

    if (this.isStrongConnector(normalizedConnector)) {
      return this.hasAction(next) || this.hasAction(previous)
    }

    if (this.isConditionalConnector(normalizedConnector)) {
      return this.hasAction(next) && (this.hasAction(previous) || this.isQuestionLike(previous))
    }

    if ([',', ';'].includes(normalizedConnector)) {
      return this.hasAction(next) && (this.hasAction(previous) || this.isQuestionLike(previous))
    }

    return false
  }

  private filterAndDeduplicate(parts: string[]): string[] {
    const seen = new Set<string>()
    const result: string[] = []

    for (const part of parts) {
      const cleaned = this.cleanSubQuery(part)
      if (cleaned.length < this.config.minQueryLength) continue
      if (/^[,.;:!?]+$/.test(cleaned)) continue

      const key = this.normalizeQuery(cleaned)
      if (seen.has(key)) continue

      seen.add(key)
      result.push(cleaned)
    }

    return result
  }

  private buildResult(input: {
    originalQuery: string
    normalizedQuery: string
    subQueries: string[]
    connectors: string[]
    confidence: number
    reason: DecompositionReason
    signals: UserMessageSignals
  }): DecomposedQuery {
    const subQueries = input.subQueries.length > 0 ? input.subQueries : [input.originalQuery].filter(Boolean)

    return {
      originalQuery: input.originalQuery,
      normalizedQuery: input.normalizedQuery,
      primaryQuery: subQueries[0] || input.originalQuery,
      subQueries,
      hasMultipleIntents: subQueries.length > 1,
      connectors: [...new Set(input.connectors)],
      confidence: input.confidence,
      reason: input.reason,
      signals: input.signals,
    }
  }

  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  }

  private cleanSubQuery(query: string): string {
    return query
      .trim()
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/\s+/g, ' ')
  }

  private hasAction(text: string): boolean {
    return ACTION_PATTERNS.some(pattern => pattern.test(text))
  }

  private isQuestionLike(text: string): boolean {
    return /[?]$/.test(text.trim()) ||
      /^(apa|apakah|bagaimana|gimana|berapa|siapa|kapan|di mana|what|how|why|who|when|where)\b/i.test(this.normalizeQuery(text))
  }

  private isModifierSegment(text: string): boolean {
    return MODIFIER_PATTERNS.some(pattern => pattern.test(text))
  }

  private isStrongConnector(connector: string): boolean {
    return STRONG_CONNECTORS.includes(connector)
  }

  private isConditionalConnector(connector: string): boolean {
    return CONDITIONAL_CONNECTORS.includes(connector)
  }

  private buildConnectorRegex(): RegExp {
    const connectors = [
      ...STRONG_CONNECTORS,
      ...CONDITIONAL_CONNECTORS,
      ',',
      ';',
    ]
      .sort((a, b) => b.length - a.length)
      .map(connector => this.connectorToRegexSource(connector))

    return new RegExp(`\\s*(${connectors.join('|')})\\s*`, 'gi')
  }

  private connectorToRegexSource(connector: string): string {
    if ([',', ';'].includes(connector)) return this.escapeRegex(connector)

    const words = connector
      .trim()
      .split(/\s+/)
      .map(word => this.escapeRegex(word))
      .join('\\s+')

    return `\\b${words}\\b`
  }

  private normalizeConnector(value: string): string | null {
    const normalized = value.toLowerCase().trim()
    const allConnectors = new Set([
      ...STRONG_CONNECTORS,
      ...CONDITIONAL_CONNECTORS,
      ',',
      ';',
    ])

    return allConnectors.has(normalized) ? normalized : null
  }

  private extractEntityHints(query: string): string[] {
    const quoted = [...query.matchAll(/"([^"]+)"|'([^']+)'/g)]
      .map(match => match[1] || match[2])

    const capitalized = [...query.matchAll(/\b[A-Z][a-zA-Z0-9_-]{2,}\b/g)]
      .map(match => match[0])

    return [...new Set([...quoted, ...capitalized])].slice(0, 8)
  }

  private extractTemporalDetails(query: string): UserMessageSignals['temporalDetails'] {
    const details: NonNullable<UserMessageSignals['temporalDetails']> = []
    const normalizedQuery = this.normalizeQuery(query)

    for (const expression of parseTemporalExpressions(query, { locale: 'auto', timezone: 'Asia/Jakarta' })) {
      if (expression.kind === 'date' || expression.kind === 'datetime') {
        details.push({
          type: 'date',
          value: expression.raw,
          normalizedValue: expression.date,
          direction: expression.direction
        })
      } else if (expression.kind === 'recurrence') {
        details.push({
          type: 'period',
          value: expression.raw,
          normalizedValue: expression.frequency,
          direction: 'future'
        })
      }
    }

    // Use the utility function to resolve temporal expressions
    for (const expr of TEMPORAL_EXPRESSIONS) {
      if (normalizedQuery.includes(expr)) {
        const resolved = resolveTemporalExpression(expr)
        if (resolved) {
          // Format dates as YYYY-mm-dd for date types
          let normalizedValue = resolved.resolvedValue;
          let type = resolved.type;

          // If we can resolve to a specific date (YYYY-mm-dd), use type "date"
          if (resolved.startDate && ['day', 'date'].includes(resolved.type)) {
            normalizedValue = this.formatDateToISO(resolved.startDate);
            type = 'date';  // Use "date" for specific dates like "2026-05-25"
          } else if (resolved.type === 'year' && resolved.startDate) {
            normalizedValue = resolved.startDate.getFullYear().toString();
          } else if (resolved.startDate && resolved.endDate) {
            // For periods (week, month, quarter), use ISO date range
            normalizedValue = this.formatDateRange(resolved.startDate, resolved.endDate);
          }

          details.push({
            type: type,
            value: resolved.value,
            normalizedValue: normalizedValue,
            direction: resolved.direction
          })
        }
      }
    }

    // Date patterns (ISO format: YYYY-mm-dd)
    const isoDateMatch = query.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (isoDateMatch) {
      details.push({ type: 'date', value: isoDateMatch[1], normalizedValue: isoDateMatch[1], direction: 'past' })
    }

    // Slash date patterns (DD/MM/YYYY or DD/MM/YY)
    const slashDateMatch = query.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)
    if (slashDateMatch) {
      const isoDate = this.parseSlashDate(slashDateMatch[1]);
      details.push({ type: 'date', value: slashDateMatch[1], normalizedValue: isoDate, direction: 'past' })
    }

    const dayOfMonthMatch = query.match(/\b(?:tanggal|tgl)\s+(\d{1,2})\b/i)
    if (dayOfMonthMatch) {
      const day = Number(dayOfMonthMatch[1])
      const isoDate = this.resolveDayOfMonth(day)
      if (isoDate) {
        details.push({
          type: 'date',
          value: dayOfMonthMatch[0],
          normalizedValue: isoDate,
          direction: isoDate > this.formatDateToISO(new Date()) ? 'future' : 'past'
        })
      }
    }

    // Month names (Indonesian)
    for (const month of INDONESIAN_MONTH_NAMES) {
      const regex = new RegExp(`\\b${month}\\b`, 'i')
      if (regex.test(query)) {
        details.push({ type: 'month', value: month, normalizedValue: month, direction: 'current' })
      }
    }

    // Month names (English)
    for (const month of ENGLISH_MONTH_NAMES) {
      const regex = new RegExp(`\\b${month}\\b`, 'i')
      if (regex.test(query)) {
        details.push({ type: 'month', value: month, normalizedValue: month, direction: 'current' })
      }
    }

    // Year patterns (e.g., "2024", "tahun 2025") - keep as type "year"
    const yearMatch = query.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      details.push({
        type: 'year',
        value: yearMatch[0],
        normalizedValue: yearMatch[0],
        direction: yearMatch[0] >= new Date().getFullYear().toString() ? 'future' : 'past'
      });
    }

    // Relative time (e.g., "5 hari yang lalu", "2 weeks ago")
    const relativeMatch = query.match(/\b(\d+)\s*(hari|week|weeks|month|months|year|years)\s*(yang lalu|ago|depan|from now)\b/i)
    if (relativeMatch) {
      const resolved = resolveTemporalExpression(relativeMatch[0])
      if (resolved) {
        // Format as ISO date if it resolves to a specific date
        let normalizedValue = resolved.resolvedValue;
        let type = resolved.type;

        if (resolved.startDate && ['day', 'date'].includes(resolved.type)) {
          normalizedValue = this.formatDateToISO(resolved.startDate);
          type = 'date';  // Use "date" for specific dates
        } else if (resolved.type === 'year' && resolved.startDate) {
          normalizedValue = resolved.startDate.getFullYear().toString();
        }

        details.push({
          type: type,
          value: resolved.value,
          normalizedValue: normalizedValue,
          direction: resolved.direction
        })
      }
    }

    return this.dedupeTemporalDetails(details)
  }

  private extractComparisonSignal(
    query: string,
    temporalDetails: UserMessageSignals['temporalDetails']
  ): UserMessageSignals['comparison'] {
    const normalized = this.normalizeQuery(query)
    const patterns: Array<{ operator: 'compare' | 'versus' | 'difference' | 'trend'; pattern: RegExp }> = [
      { operator: 'compare', pattern: /\b(bandingkan|dibandingkan|compare)\b/i },
      { operator: 'versus', pattern: /\b(vs|versus)\b/i },
      { operator: 'difference', pattern: /\b(selisih|beda|perbedaan|difference)\b/i },
      { operator: 'trend', pattern: /\b(trend|tren)\b/i }
    ]

    const matched = patterns.find(item => item.pattern.test(query))
    if (!matched) {
      return undefined
    }

    const hasStandaloneTemporalPair = (temporalDetails?.length || 0) >= 2
    const baselineSource: 'current_query' | 'working_memory' =
      hasStandaloneTemporalPair || !/^(bandingkan|compare|dibandingkan|selisih|beda|perbedaan|trend|tren)\b/i.test(normalized)
        ? 'current_query'
        : 'working_memory'

    return {
      isComparison: true,
      operator: matched.operator,
      baseline: {
        source: baselineSource,
        temporalDetails: baselineSource === 'current_query' ? temporalDetails : undefined
      },
      target: {
        temporalDetails
      },
      textSpan: query
    }
  }

  /**
   * Format date as YYYY-mm-dd
   */
  private formatDateToISO(date: Date): string {
    return formatTemporalDateToISO(date);
  }

  /**
   * Format date range as ISO date range
   */
  private formatDateRange(start: Date, end: Date): string {
    return `${this.formatDateToISO(start)} to ${this.formatDateToISO(end)}`;
  }

  /**
   * Parse slash date format (DD/MM/YYYY or DD/MM/YY) to YYYY-mm-dd
   */
  private parseSlashDate(slashDate: string): string {
    const parts = slashDate.split('/');
    if (parts.length === 3) {
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return slashDate;
  }

  private resolveDayOfMonth(day: number): string | null {
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return null
    }

    const now = new Date()
    let year = now.getFullYear()
    let monthIndex = now.getMonth()

    if (day > now.getDate()) {
      monthIndex -= 1
      if (monthIndex < 0) {
        monthIndex = 11
        year -= 1
      }
    }

    const candidate = new Date(year, monthIndex, day)
    if (
      candidate.getFullYear() !== year ||
      candidate.getMonth() !== monthIndex ||
      candidate.getDate() !== day
    ) {
      return null
    }

    return this.formatDateToISO(candidate)
  }

  private dedupeTemporalDetails(
    details: NonNullable<UserMessageSignals['temporalDetails']>
  ): UserMessageSignals['temporalDetails'] {
    const seen = new Set<string>()
    const result: NonNullable<UserMessageSignals['temporalDetails']> = []

    for (const detail of details) {
      const key = `${detail.type}|${detail.value}|${detail.normalizedValue || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(detail)
    }

    return result
  }

  private detectLanguage(normalizedQuery: string): 'id' | 'en' | 'unknown' {
    const idWords = ['tolong', 'buat', 'cek', 'cari', 'berapa', 'bagaimana', 'dan', 'lalu', 'kemudian']
    const enWords = ['please', 'create', 'check', 'find', 'what', 'how', 'and', 'then']

    const idScore = idWords.filter(word => normalizedQuery.includes(word)).length
    const enScore = enWords.filter(word => normalizedQuery.includes(word)).length

    if (idScore > enScore) return 'id'
    if (enScore > idScore) return 'en'
    return 'unknown'
  }

  private patternLabel(pattern: RegExp): string {
    return pattern.source
      .replace(/\\b/g, '')
      .replace(/[()?:\\]/g, '')
      .replace(/\|/g, '_or_')
      .slice(0, 40)
  }

  private protectQuotedText(query: string): string {
    return query.replace(/"([^"]+)"|'([^']+)'/g, match => {
      return match.replace(/\s/g, '\u0007')
    })
  }

  private restoreQuotedText(query: string): string {
    return query.replace(/\u0007/g, ' ')
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  splitByConnectors(query: string): string[] {
    const segments = this.segmentQuery(query);
    return segments.map(s => s.text);
  }
}

// ============================================================
// EXPORTED HELPER FUNCTIONS FOR ENTITY DETECTION
// ============================================================

/**
 * Extract temporal details from query (exported for entity detection)
 */
export function extractTemporalDetails(query: string): Array<{
  type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative';
  value: string;
  normalizedValue?: string;
  direction?: 'current' | 'past' | 'future';
}> {
  const normalizedQuery = query.toLowerCase();
  const details: Array<{
    type: 'day' | 'week' | 'month' | 'year' | 'quarter' | 'period' | 'date' | 'relative';
    value: string;
    normalizedValue?: string;
    direction?: 'current' | 'past' | 'future';
  }> = [];

  for (const expression of parseTemporalExpressions(query, { locale: 'auto', timezone: 'Asia/Jakarta' })) {
    if (expression.kind === 'date' || expression.kind === 'datetime') {
      details.push({
        type: 'date',
        value: expression.raw,
        normalizedValue: expression.date,
        direction: expression.direction
      });
    } else if (expression.kind === 'recurrence') {
      details.push({
        type: 'period',
        value: expression.raw,
        normalizedValue: expression.frequency,
        direction: 'future'
      });
    }
  }

  for (const expr of TEMPORAL_EXPRESSIONS) {
    if (normalizedQuery.includes(expr.toLowerCase())) {
      const resolved = resolveTemporalExpression(expr);
      
      if (resolved) {
        details.push({
          type: resolved.type,
          value: expr,
          normalizedValue: resolved.value,  // Use 'value' not 'normalized'
          direction: resolved.direction
        });
      }
    }
  }

  const seen = new Set<string>();
  return details.filter(detail => {
    const key = `${detail.type}|${detail.value}|${detail.normalizedValue || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const queryDecompositionService = new QueryDecompositionService()
