import { appLogger } from '../utils/logger.util'
import { resolveTemporalExpression } from '../utils/dateHumanID'

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

    return {
      actionHints: [...new Set(actionHints)],
      formatHints: [...new Set(formatHints)],
      temporalHints: [...new Set(temporalHints)],
      temporalDetails,
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

    // Use the utility function to resolve temporal expressions
    const temporalExpressions = [
      // Indonesian
      'hari ini', 'besok', 'lusa', 'kemarin', 'kemarin lusa',
      'minggu ini', 'minggu depan', 'minggu lalu', 'minggu kemarin',
      'bulan ini', 'bulan depan', 'bulan lalu', 'bulan kemarin',
      'tahun ini', 'tahun depan', 'tahun lalu',
      'kuartal ini', 'kuartal depan', 'kuartal lalu',
      'periode ini', 'periode depan', 'periode lalu',
      // English
      'today', 'tomorrow', 'yesterday',
      'this week', 'next week', 'last week',
      'this month', 'next month', 'last month',
      'this year', 'next year', 'last year',
      'this quarter', 'next quarter', 'last quarter',
    ]

    for (const expr of temporalExpressions) {
      if (normalizedQuery.includes(expr)) {
        const resolved = resolveTemporalExpression(expr)
        if (resolved) {
          details.push({
            type: resolved.type,
            value: resolved.value,
            normalizedValue: resolved.resolvedValue,
            direction: resolved.direction
          })
        }
      }
    }

    // Date patterns
    const isoDateMatch = query.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    if (isoDateMatch) {
      details.push({ type: 'date', value: isoDateMatch[1], normalizedValue: isoDateMatch[1], direction: 'past' })
    }

    const slashDateMatch = query.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/)
    if (slashDateMatch) {
      details.push({ type: 'date', value: slashDateMatch[1], normalizedValue: slashDateMatch[1], direction: 'past' })
    }

    // Month names
    const monthNames = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember']
    for (const month of monthNames) {
      const regex = new RegExp(`\\b${month}\\b`, 'i')
      if (regex.test(query)) {
        details.push({ type: 'month', value: month, normalizedValue: month, direction: 'current' })
      }
    }

    // Relative time (e.g., "5 hari yang lalu", "2 weeks ago")
    const relativeMatch = query.match(/\b(\d+)\s*(hari|week|weeks|month|months|year|years)\s*(yang lalu|ago|depan|from now)\b/i)
    if (relativeMatch) {
      const resolved = resolveTemporalExpression(relativeMatch[0])
      if (resolved) {
        details.push({
          type: resolved.type,
          value: resolved.value,
          normalizedValue: resolved.resolvedValue,
          direction: resolved.direction
        })
      }
    }

    return details.length > 0 ? details : undefined
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
}

export const queryDecompositionService = new QueryDecompositionService()
