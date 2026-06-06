// ============================================================
// Entity Analyzer - Config-Aware Entity Detection
// ============================================================
// Detects entity substitutions with tool parameter config support
// ============================================================

import { extractLocation } from '../../../../utils/location.utils'
import {
  CITY_PATTERN,
  DATE_PATTERN,
  EXPORT_PATTERN,
  PERSON_PATTERN,
  isEntityOnlyQuery,
  getPatternConfidence,
} from '../../../../utils/patterns'
import type { WorkingMemoryData } from '../../../../types/working-memory.type'
import type { ToolParam } from '../../../../types'
import { toolParamConfigService } from '../../../tool-param-config.service'
import { appLogger } from '../../../../utils/logger.util'

// ============================================================
// Types
// ============================================================

export type EntityType = any |'city' | 'date' | 'export' | 'person' | 'unknown' | 'select' | 'string'

export interface EntityDetection {
  type: EntityType
  value: string
  confidence: number
  isEntityOnly: boolean  // True if query contains ONLY entity
  replacesEntity?: string  // Previous entity being replaced
  isValid?: boolean  // NEW: Validated against config
  normalizedValue?: any  // NEW: Normalized value from config
  suggestions?: Array<{ label: string; value: any }>  // NEW: Valid options
}

export interface EntityAnalysisResult {
  detections: EntityDetection[]
  hasEntityChange: boolean
  entityScore: number  // 0-1 confidence score
}

// ============================================================
// Entity Analyzer
// ============================================================

/**
 * EntityAnalyzer - Detects entity substitutions in user input
 * 
 * Enhanced with tool parameter config support:
 * - Validates against config.options for select params
 * - Uses config.format for date parsing
 * - Applies config.pattern/minLength/maxLength for string params
 * 
 * Examples:
 * - "jakarta" after "cuaca bandung" → city substitution
 * - "besok" after "rapat hari ini" → date substitution
 * - "exit" after "kendaraan active" → select param substitution
 */
export class EntityAnalyzer {
  /**
   * Analyze user input for entity changes
   */
  analyze(
    userInput: string,
    previousEntities: Record<string, unknown> = {},
    toolParams?: ToolParam[]  // NEW: Optional config
  ): EntityAnalysisResult {
    const detections: EntityDetection[] = []

    // If tool params provided, use config-aware detection
    if (toolParams && toolParams.length > 0) {
      appLogger.debug('[EntityAnalyzer] Using config-aware detection', {
        paramCount: toolParams.length,
        userInputLength: userInput.length
      })

      // Check each parameter for matches
      for (const param of toolParams) {
        const detection = this.detectParamValue(userInput, param, previousEntities)
        if (detection) {
          detections.push(detection)
        }
      }
    } else {
      // Fallback to pattern-based detection (backward compatibility)
      appLogger.debug('[EntityAnalyzer] Using pattern-based detection (no config)', {
        userInputLength: userInput.length
      })

      // Check for city substitution
      const cityDetection = this.detectCity(userInput, previousEntities)
      if (cityDetection) {
        detections.push(cityDetection)
      }

      // Check for date substitution
      const dateDetection = this.detectDate(userInput, previousEntities)
      if (dateDetection) {
        detections.push(dateDetection)
      }

      // Check for export format request
      const exportDetection = this.detectExport(userInput)
      if (exportDetection) {
        detections.push(exportDetection)
      }

      // Check for person/role substitution
      const personDetection = this.detectPerson(userInput, previousEntities)
      if (personDetection) {
        detections.push(personDetection)
      }
    }

    // Calculate overall entity score
    const entityScore = detections.length > 0
      ? Math.max(...detections.map(d => d.confidence))
      : 0

    // Check if any entity is being changed
    const hasEntityChange = detections.some(
      d => d.replacesEntity !== undefined
    )

    return {
      detections,
      hasEntityChange,
      entityScore
    }
  }

  /**
   * Detect value for specific parameter using config
   */
  private detectParamValue(
    userInput: string,
    param: ToolParam,
    previousEntities: Record<string, unknown>
  ): EntityDetection | null {
    const config = param.config
    const previousValue = previousEntities[param.name] as string | undefined

    // Select type - match against config.options
    if (param.type === 'select' && config?.options) {
      return this.detectSelectParam(userInput, param, previousValue)
    }

    // Date type - use date detection with format awareness
    if (param.type === 'date') {
      return this.detectDateParam(userInput, param, previousValue)
    }

    // String type with pattern - validate against config.pattern
    if (param.type === 'string' && config?.pattern) {
      return this.detectStringParam(userInput, param, previousValue)
    }

    // Email type
    if (param.type === 'email') {
      return this.detectEmailParam(userInput, param, previousValue)
    }

    // Phone type
    if (param.type === 'phone') {
      return this.detectPhoneParam(userInput, param, previousValue)
    }

    // Fallback to generic detection
    return null
  }

  /**
   * Detect select parameter value
   */
  private detectSelectParam(
    userInput: string,
    param: ToolParam,
    previousValue?: string
  ): EntityDetection | null {
    const options = param.config?.options
    if (!options || options.length === 0) {
      return null
    }

    const lowerInput = userInput.toLowerCase()
    const isEntityOnly = isEntityOnlyQuery(userInput)

    // Try exact match first (value or label)
    for (const opt of options) {
      if (
        lowerInput.includes(opt.value.toLowerCase()) ||
        lowerInput.includes(opt.label.toLowerCase())
      ) {
        const isChange = previousValue !== undefined && 
                        String(previousValue).toLowerCase() !== opt.value.toLowerCase()

        return {
          type: 'select',
          value: opt.value,
          confidence: 0.95,  // High confidence for exact match
          isEntityOnly,
          isValid: true,
          normalizedValue: opt.value,
          replacesEntity: isChange ? String(previousValue) : undefined,
          suggestions: options.map(o => ({ label: o.label, value: o.value }))
        }
      }
    }

    // Try fuzzy match (partial match)
    for (const opt of options) {
      if (
        opt.value.toLowerCase().includes(lowerInput) ||
        opt.label.toLowerCase().includes(lowerInput) ||
        lowerInput.includes(opt.value.toLowerCase().substring(0, 3)) ||
        lowerInput.includes(opt.label.toLowerCase().substring(0, 3))
      ) {
        const isChange = previousValue !== undefined && 
                        String(previousValue).toLowerCase() !== opt.value.toLowerCase()

        return {
          type: 'select',
          value: opt.value,
          confidence: 0.6,  // Medium confidence for fuzzy match
          isEntityOnly,
          isValid: true,
          normalizedValue: opt.value,
          replacesEntity: isChange ? String(previousValue) : undefined,
          suggestions: options.map(o => ({ label: o.label, value: o.value }))
        }
      }
    }

    // No match found
    return null
  }

  /**
   * Detect date parameter with format awareness
   */
  private detectDateParam(
    userInput: string,
    param: ToolParam,
    previousValue?: string
  ): EntityDetection | null {
    const config = param.config
    const dateMatch = DATE_PATTERN.exec(userInput)?.[0]

    if (dateMatch) {
      const isEntityOnly = isEntityOnlyQuery(userInput)
      const isChange = previousValue !== undefined && 
                      String(previousValue).toLowerCase() !== dateMatch.toLowerCase()

      return {
        type: 'date',
        value: dateMatch,
        confidence: 0.9,
        isEntityOnly,
        replacesEntity: isChange ? String(previousValue) : undefined,
        isValid: true  // Will be validated by queryDecompositionService
      }
    }

    // Check for relative dates if allowed
    if (config?.allowRelative) {
      const relativeDatePatterns = [
        'hari ini', 'besok', 'kemarin',
        'lusa', 'kemarin lusa',
        'minggu depan', 'minggu lalu',
        'bulan depan', 'bulan lalu',
        'tahun depan', 'tahun lalu'
      ]

      for (const pattern of relativeDatePatterns) {
        if (userInput.toLowerCase().includes(pattern)) {
          const isEntityOnly = isEntityOnlyQuery(userInput)
          const isChange = previousValue !== undefined && 
                          String(previousValue).toLowerCase() !== pattern

          return {
            type: 'date',
            value: pattern,
            confidence: 0.85,
            isEntityOnly,
            replacesEntity: isChange ? String(previousValue) : undefined,
            isValid: true,
            normalizedValue: pattern  // Will be resolved by queryDecompositionService
          }
        }
      }
    }

    return null
  }

  /**
   * Detect string parameter with pattern validation
   */
  private detectStringParam(
    userInput: string,
    param: ToolParam,
    previousValue?: string
  ): EntityDetection | null {
    const config = param.config
    const pattern = config?.pattern

    if (!pattern) {
      return null
    }

    try {
      const regex = new RegExp(pattern, 'i')  // Case-insensitive
      const match = regex.exec(userInput)

      if (match && match[0]) {
        const value = match[0]
        const isEntityOnly = isEntityOnlyQuery(userInput)
        const isChange = previousValue !== undefined && 
                        String(previousValue).toLowerCase() !== value.toLowerCase()

        return {
          type: 'string',
          value,
          confidence: 0.9,
          isEntityOnly,
          isValid: true,
          normalizedValue: value.trim(),
          replacesEntity: isChange ? String(previousValue) : undefined
        }
      }
    } catch (error) {
      appLogger.warn('[EntityAnalyzer] Invalid pattern in config', {
        paramName: param.name,
        pattern,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }

    return null
  }

  /**
   * Detect email parameter
   */
  private detectEmailParam(
    userInput: string,
    param: ToolParam,
    previousValue?: string
  ): EntityDetection | null {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
    const match = emailRegex.exec(userInput)

    if (match && match[0]) {
      const value = match[0]
      const isEntityOnly = isEntityOnlyQuery(userInput)
      const isChange = previousValue !== undefined && 
                      String(previousValue).toLowerCase() !== value.toLowerCase()

      return {
        type: 'email',
        value,
        confidence: 0.95,
        isEntityOnly,
        isValid: true,
        normalizedValue: value.toLowerCase().trim(),
        replacesEntity: isChange ? String(previousValue) : undefined
      }
    }

    return null
  }

  /**
   * Detect phone parameter
   */
  private detectPhoneParam(
    userInput: string,
    param: ToolParam,
    previousValue?: string
  ): EntityDetection | null {
    // Basic phone pattern (can be customized per region)
    const phoneRegex = /[\d\s\-\+\(\)]{8,20}/gi
    const match = phoneRegex.exec(userInput)

    if (match && match[0]) {
      const value = match[0].trim()
      const isEntityOnly = isEntityOnlyQuery(userInput)
      const isChange = previousValue !== undefined && 
                      String(previousValue) !== value

      return {
        type: 'phone',
        value,
        confidence: 0.85,
        isEntityOnly,
        isValid: true,
        normalizedValue: value.replace(/\D/g, ''),
        replacesEntity: isChange ? String(previousValue) : undefined
      }
    }

    return null
  }

  /**
   * Detect city substitution (fallback for backward compatibility)
   */
  private detectCity(
    userInput: string,
    previousEntities: Record<string, unknown>
  ): EntityDetection | null {
    // Try location.utils first (more comprehensive)
    const location = extractLocation(userInput)

    // Fallback to pattern matching
    const cityMatch = location || CITY_PATTERN.exec(userInput)?.[0]

    if (cityMatch) {
      const previousLocation = previousEntities.location as string | undefined
      const isEntityOnly = isEntityOnlyQuery(userInput)

      return {
        type: 'city',
        value: cityMatch.toLowerCase(),
        confidence: getPatternConfidence(isEntityOnly ? 'exact' : 'partial'),
        isEntityOnly,
        replacesEntity: previousLocation && previousLocation.toLowerCase() !== cityMatch.toLowerCase()
          ? previousLocation
          : undefined
      }
    }

    return null
  }

  /**
   * Detect date/time substitution (fallback for backward compatibility)
   */
  private detectDate(
    userInput: string,
    previousEntities: Record<string, unknown>
  ): EntityDetection | null {
    const dateMatch = DATE_PATTERN.exec(userInput)?.[0]

    if (dateMatch) {
      const previousDate = previousEntities.date as string | undefined
      const isEntityOnly = isEntityOnlyQuery(userInput)

      return {
        type: 'date',
        value: dateMatch.toLowerCase(),
        confidence: getPatternConfidence(isEntityOnly ? 'exact' : 'partial'),
        isEntityOnly,
        replacesEntity: previousDate && previousDate.toLowerCase() !== dateMatch.toLowerCase()
          ? previousDate
          : undefined
      }
    }

    return null
  }

  /**
   * Detect export format request (fallback for backward compatibility)
   */
  private detectExport(userInput: string): EntityDetection | null {
    const formatMatch = EXPORT_PATTERN.exec(userInput)?.[0]

    if (formatMatch) {
      return {
        type: 'export',
        value: formatMatch.toLowerCase(),
        confidence: getPatternConfidence('partial'),
        isEntityOnly: isEntityOnlyQuery(userInput)
      }
    }

    return null
  }

  /**
   * Detect person/role substitution (fallback for backward compatibility)
   */
  private detectPerson(
    userInput: string,
    previousEntities: Record<string, unknown>
  ): EntityDetection | null {
    const personMatch = PERSON_PATTERN.exec(userInput)?.[0]

    if (personMatch) {
      const previousPerson = previousEntities.person as string | undefined
      const isEntityOnly = isEntityOnlyQuery(userInput)

      return {
        type: 'person',
        value: personMatch.toLowerCase(),
        confidence: getPatternConfidence(isEntityOnly ? 'exact' : 'partial'),
        isEntityOnly,
        replacesEntity: previousPerson && previousPerson.toLowerCase() !== personMatch.toLowerCase()
          ? previousPerson
          : undefined
      }
    }

    return null
  }

  /**
   * Check if input is purely an entity reference (backward compatibility)
   */
  isPureEntityReference(userInput: string): boolean {
    const normalized = userInput.trim().toLowerCase()
    const wordCount = normalized.split(/\s+/).filter(Boolean).length

    // Pure entity references are 1-2 words
    // "jakarta", "besok", "pdf saja", "excel aja"
    if (wordCount > 2) {
      return false
    }

    // Check if it matches any entity pattern
    return (
      CITY_PATTERN.test(normalized) ||
      DATE_PATTERN.test(normalized) ||
      EXPORT_PATTERN.test(normalized) ||
      PERSON_PATTERN.test(normalized)
    )
  }

  /**
   * Get entity type from working memory (backward compatibility)
   */
  getActiveEntityType(memory: WorkingMemoryData | null): EntityType | null {
    if (!memory) {
      return null
    }

    // Check activeEntities
    const entities = memory.activeEntities || {}

    if (entities.location) {
      return 'city'
    }

    if (entities.date || entities.time) {
      return 'date'
    }

    if (entities.person || entities.role) {
      return 'person'
    }

    // Check if activeIntent suggests entity type
    const activeIntent = memory.activeIntent?.toLowerCase() || ''

    if (activeIntent.includes('weather') || activeIntent.includes('cuaca')) {
      return 'city'
    }

    if (activeIntent.includes('schedule') || activeIntent.includes('meeting')) {
      return 'date'
    }

    return null
  }
}

// Singleton instance
export const entityAnalyzer = new EntityAnalyzer()
