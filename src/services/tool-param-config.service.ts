import { toolService } from './tools.service'
import type { ToolParam, ToolParamConfig } from '../types'
import { appLogger } from '../utils/logger.util'

// ============================================================
// Types
// ============================================================

export interface ValidationResult {
  isValid: boolean
  confidence: number
  normalizedValue?: any
  error?: string
  suggestions?: Array<{ label: string; value: any }>
}

export interface DateParseResult {
  isValid: boolean
  value?: string
  originalValue?: string
  isRelative?: boolean
  format?: string
  error?: string
}

// ============================================================
// Tool Parameter Config Service
// ============================================================

/**
 * ToolParamConfigService - Central service for loading and using tool parameter configs
 * 
 * Responsibilities:
 * - Load tool parameters with config from database
 * - Validate extracted values against config
 * - Build LLM prompts with config context
 * - Parse dates with config.format
 * - Normalize values based on config
 */
export class ToolParamConfigService {
  private paramCache = new Map<string, ToolParam[]>()
  private cacheTimestamps = new Map<string, number>()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  /**
   * Load tool parameters with config
   * Uses caching to prevent duplicate database queries
   */
  async loadToolParams(toolSlug: string): Promise<ToolParam[]> {
    // Check cache first
    const cached = this.getCachedParams(toolSlug)
    if (cached) {
      appLogger.debug('[ToolParamConfig] Cache hit', { toolSlug })
      return cached
    }

    // Load from service
    appLogger.debug('[ToolParamConfig] Loading tool params', { toolSlug })
    const tool = await toolService.getToolsBySlugs([toolSlug])
    
    if (!tool || tool.length === 0) {
      appLogger.warn('[ToolParamConfig] Tool not found', { toolSlug })
      return []
    }

    const params = tool[0].parameters || []
    
    // Cache the params
    this.paramCache.set(toolSlug, params)
    this.cacheTimestamps.set(toolSlug, Date.now())

    appLogger.debug('[ToolParamConfig] Tool params loaded', {
      toolSlug,
      paramCount: params.length
    })

    return params
  }

  /**
   * Get cached params (if still valid)
   */
  private getCachedParams(toolSlug: string): ToolParam[] | null {
    const params = this.paramCache.get(toolSlug)
    const timestamp = this.cacheTimestamps.get(toolSlug)

    if (!params || !timestamp) {
      return null
    }

    // Check if cache is still valid
    const age = Date.now() - timestamp
    if (age > this.CACHE_TTL) {
      // Cache expired
      this.paramCache.delete(toolSlug)
      this.cacheTimestamps.delete(toolSlug)
      return null
    }

    return params
  }

  /**
   * Get parameter by name from tool params list
   */
  getParamByName(params: ToolParam[], name: string): ToolParam | null {
    return params.find(p => p.name === name) || null
  }

  /**
   * Validate value against parameter config
   */
  validateValue(param: ToolParam, value: any): ValidationResult {
    if (value === undefined || value === null) {
      return {
        isValid: !param.isRequired,
        confidence: 0,
        error: param.isRequired ? 'Value is required' : undefined
      }
    }

    const config = param.config

    // Type-specific validation
    switch (param.type) {
      case 'select':
        return this.validateSelect(param, value, config)
      
      case 'multiselect':
        return this.validateMultiSelect(param, value, config)
      
      case 'date':
        return this.validateDate(param, value, config)
      
      case 'number':
        return this.validateNumber(param, value, config)
      
      case 'email':
        return this.validateEmail(param, value, config)
      
      case 'phone':
        return this.validatePhone(param, value, config)
      
      case 'string':
      default:
        return this.validateString(param, value, config)
    }
  }

  /**
   * Validate select parameter against config.options
   */
  private validateSelect(
    param: ToolParam,
    value: string,
    config?: ToolParamConfig
  ): ValidationResult {
    const options = config?.options

    if (!options || options.length === 0) {
      // No options defined, accept any value
      return {
        isValid: true,
        confidence: 0.5,
        normalizedValue: value
      }
    }

    // Exact match (case-insensitive)
    const lowerValue = String(value).toLowerCase()
    const exactMatch = options.find(
      opt => opt.value.toLowerCase() === lowerValue ||
             opt.label.toLowerCase() === lowerValue
    )

    if (exactMatch) {
      return {
        isValid: true,
        confidence: 1.0,
        normalizedValue: exactMatch.value,
        suggestions: options.map(opt => ({
          label: opt.label,
          value: opt.value
        }))
      }
    }

    // Fuzzy match (partial match)
    const fuzzyMatch = options.find(
      opt => opt.value.toLowerCase().includes(lowerValue) ||
             opt.label.toLowerCase().includes(lowerValue) ||
             lowerValue.includes(opt.value.toLowerCase()) ||
             lowerValue.includes(opt.label.toLowerCase())
    )

    if (fuzzyMatch) {
      return {
        isValid: true,
        confidence: 0.6, // Lower confidence for fuzzy match
        normalizedValue: fuzzyMatch.value,
        suggestions: options.map(opt => ({
          label: opt.label,
          value: opt.value
        }))
      }
    }

    // No match - return suggestions
    return {
      isValid: false,
      confidence: 0.2,
      error: `Value "${value}" not in valid options`,
      suggestions: options.map(opt => ({
        label: opt.label,
        value: opt.value
      }))
    }
  }

  /**
   * Validate multiselect parameter
   */
  private validateMultiSelect(
    param: ToolParam,
    value: any,
    config?: ToolParamConfig
  ): ValidationResult {
    const values = Array.isArray(value) ? value : [value]
    const options = config?.options

    if (!options || options.length === 0) {
      return {
        isValid: true,
        confidence: 0.5,
        normalizedValue: values
      }
    }

    const validated: any[] = []
    let allValid = true
    let minConfidence = 1.0

    for (const val of values) {
      const result = this.validateSelect(param, val, config)
      
      if (!result.isValid) {
        allValid = false
      }
      
      if (result.confidence < minConfidence) {
        minConfidence = result.confidence
      }
      
      if (result.normalizedValue !== undefined) {
        validated.push(result.normalizedValue)
      }
    }

    return {
      isValid: allValid,
      confidence: minConfidence,
      normalizedValue: validated,
      suggestions: options.map(opt => ({
        label: opt.label,
        value: opt.value
      }))
    }
  }

  /**
   * Validate date parameter
   * Note: Actual date parsing done by queryDecompositionService
   * This validates format and range
   */
  private validateDate(
    param: ToolParam,
    value: string,
    config?: ToolParamConfig
  ): ValidationResult {
    const format = config?.format
    const minDate = config?.minDate
    const maxDate = config?.maxDate

    // Check if it's a valid date
    const date = new Date(value)
    if (isNaN(date.getTime())) {
      return {
        isValid: false,
        confidence: 0,
        error: `Invalid date format: ${value}`
      }
    }

    // Check min date
    if (minDate) {
      const min = new Date(minDate)
      if (date < min) {
        return {
          isValid: false,
          confidence: 0,
          error: `Date must be >= ${minDate}`,
          suggestions: [{ label: `Min: ${minDate}`, value: minDate }]
        }
      }
    }

    // Check max date
    if (maxDate) {
      const max = new Date(maxDate)
      if (date > max) {
        return {
          isValid: false,
          confidence: 0,
          error: `Date must be <= ${maxDate}`,
          suggestions: [{ label: `Max: ${maxDate}`, value: maxDate }]
        }
      }
    }

    // Format validation (basic check)
    let formatValid = true
    if (format) {
      // Simple format validation
      // Can be enhanced with date-fns or moment
      if (format === 'YYYY-MM-DD' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        // Allow relative dates if configured
        if (!config?.allowRelative) {
          formatValid = false
        }
      }
    }

    return {
      isValid: formatValid,
      confidence: formatValid ? 1.0 : 0.5,
      normalizedValue: value,
      error: formatValid ? undefined : `Expected format: ${format}`
    }
  }

  /**
   * Validate number parameter with range
   */
  private validateNumber(
    param: ToolParam,
    value: any,
    config?: ToolParamConfig
  ): ValidationResult {
    const num = Number(value)

    if (isNaN(num)) {
      return {
        isValid: false,
        confidence: 0,
        error: `Invalid number: ${value}`
      }
    }

    const min = config?.min
    const max = config?.max

    // Check range
    if (min !== undefined && num < min) {
      return {
        isValid: false,
        confidence: 0,
        error: `Value must be >= ${min}`,
        suggestions: [{ label: `Min: ${min}`, value: min }]
      }
    }

    if (max !== undefined && num > max) {
      return {
        isValid: false,
        confidence: 0,
        error: `Value must be <= ${max}`,
        suggestions: [{ label: `Max: ${max}`, value: max }]
      }
    }

    return {
      isValid: true,
      confidence: 1.0,
      normalizedValue: num
    }
  }

  /**
   * Validate email parameter
   */
  private validateEmail(
    param: ToolParam,
    value: string,
    config?: ToolParamConfig
  ): ValidationResult {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const isValid = emailRegex.test(value)

    return {
      isValid,
      confidence: isValid ? 1.0 : 0.3,
      normalizedValue: isValid ? value.toLowerCase().trim() : undefined,
      error: isValid ? undefined : 'Invalid email format'
    }
  }

  /**
   * Validate phone parameter
   */
  private validatePhone(
    param: ToolParam,
    value: string,
    config?: ToolParamConfig
  ): ValidationResult {
    // Basic phone validation (can be customized per region)
    const phoneRegex = /^[\d\s\-\+\(\)]{8,20}$/
    const isValid = phoneRegex.test(value)

    return {
      isValid,
      confidence: isValid ? 1.0 : 0.3,
      normalizedValue: isValid ? value.replace(/\D/g, '') : undefined,
      error: isValid ? undefined : 'Invalid phone format'
    }
  }

  /**
   * Validate string parameter with pattern/length
   */
  private validateString(
    param: ToolParam,
    value: string,
    config?: ToolParamConfig
  ): ValidationResult {
    const str = String(value)

    // Length validation
    const minLength = config?.minLength
    const maxLength = config?.maxLength

    if (minLength !== undefined && str.length < minLength) {
      return {
        isValid: false,
        confidence: 0,
        error: `Value must be >= ${minLength} characters`
      }
    }

    if (maxLength !== undefined && str.length > maxLength) {
      return {
        isValid: false,
        confidence: 0,
        error: `Value must be <= ${maxLength} characters`
      }
    }

    // Pattern validation
    const pattern = config?.pattern
    if (pattern) {
      try {
        const regex = new RegExp(pattern)
        if (!regex.test(str)) {
          return {
            isValid: false,
            confidence: 0,
            error: `Value does not match pattern: ${pattern}`
          }
        }
      } catch (error) {
        appLogger.warn('[ToolParamConfig] Invalid pattern in config', {
          paramName: param.name,
          pattern,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return {
      isValid: true,
      confidence: 1.0,
      normalizedValue: str.trim()
    }
  }

  /**
   * Build LLM extraction prompt with config context
   */
  buildExtractionPrompt(param: ToolParam): string {
    const label = param.label || param.name
    const description = param.description || ''
    const type = param.type
    const config = param.config

    let prompt = `Parameter: "${label}" (${type})`
    
    if (description) {
      prompt += ` - ${description}`
    }

    // Add type-specific hints
    if (type === 'select' && config?.options) {
      const options = config.options
        .map(opt => `${opt.label} (${opt.value})`)
        .join(', ')
      prompt += `\nValid options: ${options}`
    }

    if (type === 'date') {
      if (config?.format) {
        prompt += `\nFormat: ${config.format}`
      }
      if (config?.allowRelative) {
        prompt += `\nAccepts relative dates: kemarin, besok, minggu depan, etc.`
      }
    }

    if (type === 'number') {
      if (config?.min !== undefined || config?.max !== undefined) {
        const range = []
        if (config?.min !== undefined) range.push(`>= ${config.min}`)
        if (config?.max !== undefined) range.push(`<= ${config.max}`)
        prompt += `\nRange: ${range.join(' ')}`
      }
      if (config?.unit) {
        prompt += `\nUnit: ${config.unit}`
      }
    }

    if (type === 'email') {
      prompt += `\nMust be a valid email address`
    }

    if (type === 'phone') {
      prompt += `\nMust be a valid phone number`
    }

    if (config?.pattern) {
      prompt += `\nPattern: ${config.pattern}`
    }

    if (config?.placeholder) {
      prompt += `\nExample: ${config.placeholder}`
    }

    return prompt
  }

  /**
   * Build all params prompt for LLM
   */
  buildAllParamsPrompt(params: ToolParam[]): string {
    if (params.length === 0) {
      return 'No parameters required'
    }

    const paramPrompts = params.map(param => {
      return `  - ${this.buildExtractionPrompt(param)}`
    }).join('\n')

    return `Expected parameters:\n${paramPrompts}`
  }

  /**
   * Normalize value based on config
   */
  normalizeValue(param: ToolParam, value: any): any {
    if (value === undefined || value === null) {
      return value
    }

    const config = param.config

    switch (param.type) {
      case 'string':
        return String(value).trim()
      
      case 'number':
        return Number(value)
      
      case 'boolean':
        return String(value).toLowerCase() === 'true'
      
      case 'email':
        return String(value).toLowerCase().trim()
      
      case 'phone':
        return String(value).replace(/\D/g, '')
      
      case 'select':
        // Try to normalize against options
        if (config?.options) {
          const lowerValue = String(value).toLowerCase()
          const match = config.options.find(
            opt => opt.value.toLowerCase() === lowerValue ||
                   opt.label.toLowerCase() === lowerValue
          )
          return match ? match.value : value
        }
        return value
      
      case 'date':
        // Date normalization handled by queryDecompositionService
        return value
      
      default:
        return value
    }
  }

  /**
   * Clear cache for specific tool
   */
  clearCache(toolSlug: string): void {
    this.paramCache.delete(toolSlug)
    this.cacheTimestamps.delete(toolSlug)
    appLogger.debug('[ToolParamConfig] Cache cleared', { toolSlug })
  }

  /**
   * Clear all caches
   */
  clearAllCache(): void {
    this.paramCache.clear()
    this.cacheTimestamps.clear()
    appLogger.debug('[ToolParamConfig] All caches cleared')
  }
}

// Singleton instance
export const toolParamConfigService = new ToolParamConfigService()
