import { toolService } from './tools.service'
import { paramExtractorService } from './paramExtractor.service'
import { resourceParamSchemaService } from './resource-param-schema.service'
import type {
  ToolParam,
  ToolMissingParams,
  PipelineInput,
  ResourceMissingParams,
  ResourceParamOwner
} from '../types'
import type { PlannerOutput, PlannerTask } from '../types/planner.types'
import type { DecomposedQuery } from './query-decomposition.service'
import { appLogger } from '../utils/logger.util'
import {
  cleanAutomationGoalText,
  normalizeAutomationTypeLabel
} from '../utils/automation-param.util'
import { PipelineValidator } from '../utils/pipeline-validator.util'
import { extractTimezoneFromText } from '../utils/timezone.utils'
import { parseTemporalExpressions } from '../utils/temporal/temporal-expression-parser.util'
import { userProfileService } from './user-profile.service'

// ============================================================
// Types
// ============================================================

export type ParamSource =
  | 'attributes'
  | 'temporal'
  | 'rule'
  | 'llm'
  | 'llm_optional'
  | 'user_profile'
  | 'default'

export interface ParamResolutionOptions {
  mode?: 'pipeline' | 'continuation'
  allowOptionalSemanticOverwrite?: boolean
  clearStaleOptionalSemanticParams?: boolean
  ignoreTemporalDetails?: boolean
}

export interface ParamResolutionResult {
  availableParams: Record<string, unknown>
  missingResourceParams: ResourceMissingParams[]
  missingToolsParams: ToolMissingParams[]
  sources: Record<string, ParamSource>
  confidences: Record<string, number>
  lowConfidenceParams: string[]
  resourceParams: ResourceParamOwner[]
  toolParams: ToolParam[]
}

interface SourceParams {
  source: ParamSource
  params: Record<string, unknown>
}

// ============================================================
// Param Resolution Service
// ============================================================

/**
 * ParamResolutionService - Central service for resolving parameters
 * 
 * Resolution Order:
 * 1. Get tool schema from tool.parameters
 * 2. Get valid tool defaults from tool.parameters.defaultValue
 * 3. Get input.attributes.params that match tool param names
 * 4. Merge: tool defaults -> matched attributes
 * 5. Merge signals.temporalDetails for temporal params like date
 * 6. Check missing required params
 * 7. Run LLM extraction ONLY for unresolved params
 * 
 * Precedence before LLM: temporal > matched attributes > valid defaults.
 * LLM extraction only fills params that are still unresolved.
 */
export class ParamResolutionService {
  /**
   * Resolve parameters from all sources
   */
  async resolve(
    input: PipelineInput,
    plan: PlannerOutput,
    decompositionResult: DecomposedQuery,
    options: ParamResolutionOptions = {}
  ): Promise<ParamResolutionResult> {
    appLogger.debug('[ParamResolution] Starting resolution', {
      userId: input.user_id,
      appName: input.app_name,
      hasDecomposition: !!decompositionResult,
      taskCount: plan.tasks?.length || 0
    })

    // Step 1: Get tool tasks and params
    const resourceOwners = await resourceParamSchemaService.collectOwners(plan.tasks || [])
    const allResourceParams = resourceOwners.flatMap(owner => owner.params)
    const toolParams = resourceOwners
      .filter(owner => owner.resource === 'tool')
      .flatMap(owner => owner.params)
    const skillParams = resourceOwners
      .filter(owner => owner.resource === 'skill')
      .flatMap(owner => owner.params)

    if (resourceOwners.length === 0 || allResourceParams.length === 0) {
      appLogger.debug('[ParamResolution] No resource params found', {
        taskCount: plan.tasks?.length
      })
      return {
        availableParams: {},
        missingResourceParams: [],
        missingToolsParams: [],
        sources: {},
        confidences: {},
        lowConfidenceParams: [],
        resourceParams: resourceOwners,
        toolParams
      }
    }

    appLogger.debug('[ParamResolution] Resource params collected', {
      ownerCount: resourceOwners.length,
      toolOwnerCount: resourceOwners.filter(owner => owner.resource === 'tool').length,
      skillOwnerCount: resourceOwners.filter(owner => owner.resource === 'skill').length,
      paramCount: allResourceParams.length,
      toolParamCount: toolParams.length,
      skillParamCount: skillParams.length
    })

    // Step 4: Collect from all sources
    const fromDefaults = this.collectFromDefaults(allResourceParams, input)
    const fromAttributes = this.collectFromAttributes(input, allResourceParams)
    const fromTemporal = options.ignoreTemporalDetails
      ? {}
      : this.collectFromTemporal(decompositionResult, allResourceParams)
    const fromRules = this.collectFromRules(input.text, allResourceParams)  // ✅ ADDED rules collection

    const fromUserProfile = await userProfileService.collectForParams(
      input.user_id,
      input.app_name,
      allResourceParams
    )

    appLogger.debug('[ParamResolution] Collection summary', {
      fromDefaults: Object.keys(fromDefaults).length,
      fromAttributes: Object.keys(fromAttributes).length,
      fromTemporal: Object.keys(fromTemporal).length,
      fromRules: Object.keys(fromRules).length,
      fromUserProfile: Object.keys(fromUserProfile).length
    })

    // Step 5: Merge with precedence (defaults -> attributes -> temporal -> rules)
    const availableBeforeLLM = this.mergeWithPrecedence([
      { source: 'default', params: fromDefaults },
      { source: 'user_profile', params: fromUserProfile },
      { source: 'attributes', params: fromAttributes },
      { source: 'temporal', params: fromTemporal },
      { source: 'rule', params: fromRules }  // ✅ ADDED rules to merge
    ])

    // Step 6: Track sources
    const sources: Record<string, ParamSource> = {}
    for (const key of Object.keys(fromDefaults)) sources[key] = 'default'
    for (const key of Object.keys(fromUserProfile)) sources[key] = 'user_profile'
    for (const key of Object.keys(fromAttributes)) sources[key] = 'attributes'
    for (const key of Object.keys(fromTemporal)) sources[key] = 'temporal'
    for (const key of Object.keys(fromRules)) sources[key] = 'rule'  // ✅ ADDED rule source

    // Step 7: Find missing required params BEFORE LLM
    const missingRequired = this.findMissingRequiredByOwners(resourceOwners, availableBeforeLLM, plan.tasks || [])

    appLogger.debug('[ParamResolution] Missing params before LLM', {
      missingCount: missingRequired.length,
      missing: missingRequired
    })

    // Step 8: LLM extraction ONLY for missing params
    let fromLLM: Record<string, unknown> = {}
    let llmConfidences: Record<string, number> = {}
    let lowConfidenceParams: string[] = []

    if (missingRequired.length > 0) {
      const missingParams = allResourceParams.filter(p => 
        missingRequired.includes(p.name)
      )

      if (missingParams.length > 0) {
        appLogger.debug('[ParamResolution] Extracting missing params via LLM', {
          missingCount: missingParams.length
        })

        const extractionResult = await paramExtractorService.extractAll(
          input.text,
          missingParams
        )

        fromLLM = extractionResult.params || {}
        llmConfidences = extractionResult.confidences || {}
        lowConfidenceParams = extractionResult.lowConfidenceParams || []

        appLogger.debug('[ParamResolution] LLM extraction completed', {
          extractedCount: Object.keys(fromLLM).length,
          lowConfidenceCount: lowConfidenceParams.length
        })
      }
    } else {
      appLogger.debug('[ParamResolution] No missing params, skipping LLM extraction')
    }

    // Step 9: Fill only params that are still missing. LLM must not overwrite
    // defaults, matched attributes, or temporal details.
    let finalAvailableParams = { ...availableBeforeLLM }
    for (const [key, value] of Object.entries(fromLLM)) {
      if (!this.isMeaningfulValue(finalAvailableParams[key]) && this.isMeaningfulValue(value)) {
        finalAvailableParams[key] = value
        sources[key] = 'llm'
      }
    }

    const optionalSemanticResult = await this.extractOptionalSemanticParams(
      input,
      allResourceParams,
      finalAvailableParams,
      options
    )

    for (const param of optionalSemanticResult.cleared) {
      delete finalAvailableParams[param.name]
      delete sources[param.name]
    }

    for (const [key, value] of Object.entries(optionalSemanticResult.params)) {
      if (this.isMeaningfulValue(value)) {
        finalAvailableParams[key] = value
        sources[key] = 'llm_optional'
      }
    }

    Object.assign(llmConfidences, optionalSemanticResult.confidences)

    const optionalSkillResult = await this.extractOptionalSkillParams(
      input,
      skillParams,
      finalAvailableParams
    )

    for (const [key, value] of Object.entries(optionalSkillResult.params)) {
      if (this.isMeaningfulValue(value)) {
        finalAvailableParams[key] = value
        sources[key] = 'llm_optional'
      }
    }

    Object.assign(llmConfidences, optionalSkillResult.confidences)

    const temporalQuestionType = options.ignoreTemporalDetails
      ? null
      : this.getTemporalQuestionType(input.text)
    let clearedTemporalFilters: string[] = []
    if (temporalQuestionType) {
      const cleanedParams = this.removeTemporalFilterParams(finalAvailableParams)
      clearedTemporalFilters = Object.keys(finalAvailableParams).filter(key => !(key in cleanedParams))
      finalAvailableParams = {
        ...cleanedParams,
        __dateBlind: true,
        __temporalQuestionType: temporalQuestionType,
        __clearedTemporalFilters: clearedTemporalFilters
      }

      for (const key of clearedTemporalFilters) {
        delete sources[key]
      }

      appLogger.info('[ParamResolution] Temporal question detected, clearing temporal filters', {
        temporalQuestionType,
        clearedTemporalFilters,
        remainingParamKeys: Object.keys(cleanedParams)
      })
    }

    // Step 10: Final missing check
    const finalMissing = this.findMissingRequiredByOwners(resourceOwners, finalAvailableParams, plan.tasks || [])
    const missingResourceParams = this.buildMissingResourceParams(resourceOwners, finalAvailableParams, plan.tasks || [])
    const missingToolsParams = await this.buildMissingToolsParams(missingResourceParams)

    appLogger.info('[ParamResolution] Resolution completed', {
      totalParams: Object.keys(finalAvailableParams).length,
      missingCount: finalMissing.length,
      missingResourceCount: missingResourceParams.length,
      sources: {
        default: Object.keys(fromDefaults).length,
        attributes: Object.keys(fromAttributes).length,
        temporal: Object.keys(fromTemporal).length,
        llm: Object.keys(fromLLM).length,
        llm_optional: Object.keys(optionalSemanticResult.params).length + Object.keys(optionalSkillResult.params).length,
        optionalSemanticCleared: optionalSemanticResult.cleared.map(param => param.name)
      }
    })

    return {
      availableParams: finalAvailableParams,
      missingResourceParams,
      missingToolsParams,
      sources,
      confidences: llmConfidences,
      lowConfidenceParams,
      resourceParams: resourceOwners,
      toolParams
    }
  }

  private buildMissingResourceParams(
    resourceOwners: ResourceParamOwner[],
    availableParams: Record<string, unknown>,
    tasks: PlannerTask[] = []
  ): ResourceMissingParams[] {
    return resourceOwners
      .map(owner => {
        const missing = owner.params
          .filter(param =>
            param.isRequired &&
            !this.isRuntimeProvidedSkillDataParam(owner, param.name, tasks) &&
            !(
              availableParams.__dateBlind === true &&
              this.isTemporalFilterParam(param.name)
            ) &&
            !PipelineValidator.validateParamValue(param, availableParams[param.name])
          )
          .map(param => param.name)

        return {
          resource: owner.resource,
          key: owner.key,
          name: owner.name,
          missing,
          params: owner.params
        }
      })
      .filter(item => item.missing.length > 0)
  }

  private async buildMissingToolsParams(
    missingResourceParams: ResourceMissingParams[]
  ): Promise<ToolMissingParams[]> {
    const toolMissing = missingResourceParams.filter(item => item.resource === 'tool')
    if (toolMissing.length === 0) {
      return []
    }

    const tools = await toolService.getToolsBySlugs(toolMissing.map(item => item.key))
    return toolMissing
      .map(item => {
        const tool = tools.find(candidate => candidate.slug === item.key)
        return tool ? { tool, missing: item.missing } : null
      })
      .filter((item): item is ToolMissingParams => item !== null)
  }

  private async extractOptionalSkillParams(
    input: PipelineInput,
    skillParams: ToolParam[],
    currentParams: Record<string, unknown>
  ): Promise<{
    params: Record<string, unknown>
    confidences: Record<string, number>
  }> {
    const candidates = skillParams.filter(param =>
      !param.isRequired &&
      !param.isHidden &&
      this.hasOptionalSkillParamSignal(input.text, param)
    )

    if (candidates.length === 0) {
      return { params: {}, confidences: {} }
    }

    const params: Record<string, unknown> = {}
    const confidences: Record<string, number> = {}
    const unresolvedForLLM: ToolParam[] = []

    for (const param of candidates) {
      const ruleValue = this.extractOptionalSkillParamFromRules(input.text, param)
      if (ruleValue !== undefined) {
        params[param.name] = ruleValue
        confidences[param.name] = 0.9
        continue
      }

      if (!this.isMeaningfulValue(currentParams[param.name])) {
        unresolvedForLLM.push(param)
      }
    }

    if (unresolvedForLLM.length > 0) {
      const extractionResult = await paramExtractorService.extractAll(input.text, unresolvedForLLM)

      for (const param of unresolvedForLLM) {
        const value = extractionResult.params?.[param.name]
        const confidence = extractionResult.confidences?.[param.name] ?? 0

        if (
          confidence >= 0.65 &&
          this.isMeaningfulValue(value) &&
          PipelineValidator.validateParamValue(param, value)
        ) {
          params[param.name] = value
          confidences[param.name] = confidence
        }
      }
    }

    appLogger.debug('[ParamResolution] Optional skill extraction completed', {
      candidates: candidates.map(param => param.name),
      accepted: Object.keys(params),
      attemptedLLM: unresolvedForLLM.map(param => param.name)
    })

    return { params, confidences }
  }

  private hasOptionalSkillParamSignal(text: string, param: ToolParam): boolean {
    const normalizedText = this.normalizeForSignal(text)
    const haystack = this.normalizeForSignal([
      param.name.replace(/_/g, ' '),
      param.label,
      param.description,
      param.extractPrompt
    ].filter(Boolean).join(' '))

    if (!normalizedText || !haystack) {
      return false
    }

    if (param.type === 'boolean' && this.isCapabilityParam(haystack)) {
      return this.hasCapabilityRequestSignal(normalizedText) ||
        this.hasAffirmativeSignal(normalizedText) ||
        this.hasNegativeSignal(normalizedText)
    }

    return haystack
      .split(/\s+/)
      .filter(token => token.length >= 3)
      .some(token => normalizedText.includes(token))
  }

  private extractOptionalSkillParamFromRules(
    text: string,
    param: ToolParam
  ): unknown {
    if (param.type !== 'boolean') {
      return undefined
    }

    const normalizedText = this.normalizeForSignal(text)
    const haystack = this.normalizeForSignal([
      param.name.replace(/_/g, ' '),
      param.label,
      param.description,
      param.extractPrompt
    ].filter(Boolean).join(' '))

    if (this.isCapabilityParam(haystack)) {
      if (this.hasNegativeSignal(normalizedText)) {
        return false
      }

      if (this.hasCapabilityRequestSignal(normalizedText) || this.hasAffirmativeSignal(normalizedText)) {
        return true
      }
    }

    return undefined
  }

  private isCapabilityParam(haystack: string): boolean {
    return ['skill', 'kemampuan', 'capability', 'fitur', 'daftar'].some(token => haystack.includes(token))
  }

  private hasCapabilityRequestSignal(text: string): boolean {
    return [
      'bisa apa',
      'kemampuan',
      'capability',
      'fitur',
      'skill',
      'lihat kemampuan',
      'tampilkan kemampuan',
      'daftar kemampuan'
    ].some(token => text.includes(token))
  }

  private hasAffirmativeSignal(text: string): boolean {
    return /^(ya|iya|boleh|ok|oke|yes|yup|lanjut|tampilkan|lihat|show)$/.test(text)
  }

  private hasNegativeSignal(text: string): boolean {
    return /^(tidak|nggak|enggak|gak|no|nope|jangan|belum)$/.test(text)
  }

  private normalizeForSignal(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  /**
   * Collect from tool defaults
   */
  private collectFromDefaults(
    toolParams: ToolParam[],
    input: PipelineInput
  ): Record<string, unknown> {
    const defaults: Record<string, unknown> = {}

    for (const param of toolParams) {
      const defaultValue = param.defaultValue

      // Skip if no default
      if (defaultValue === undefined || defaultValue === null) {
        continue
      }

      // Skip empty strings for required params
      if (param.isRequired && defaultValue === '') {
        continue
      }

      // Resolve [datenow] token
      if (typeof defaultValue === 'string' && defaultValue === '[datenow]') {
        const timezone = (input.attributes?.timezone as string) || 'Asia/Jakarta'
        defaults[param.name] = this.formatDateInTimezone(new Date(), timezone)
        
        appLogger.debug('[ParamResolution] Resolved [datenow] default', {
          paramName: param.name,
          resolvedValue: defaults[param.name],
          timezone
        })
      } else if (this.isDefaultAllowed(param, defaultValue)) {
        defaults[param.name] = defaultValue
      }
    }

    return defaults
  }

  /**
   * Decide whether a default can satisfy a param before LLM extraction.
   */
  private isDefaultAllowed(
    param: ToolParam,
    defaultValue: unknown
  ): boolean {
    if (!this.isMeaningfulValue(defaultValue)) {
      return false
    }

    return true
  }

  private formatDateInTimezone(date: Date, timezone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date)

    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    const day = parts.find(p => p.type === 'day')?.value

    return `${year}-${month}-${day}`
  }

  /**
   * Collect from input.attributes.params
   */
  private collectFromAttributes(
    input: PipelineInput,
    toolParams: ToolParam[]
  ): Record<string, unknown> {
    const attributes = input.attributes?.params as Record<string, unknown> | undefined
    
    if (!attributes) {
      return {}
    }

    // Filter to only include params that match tool param names
    const matched: Record<string, unknown> = {}
    const toolParamNames = new Set(toolParams.map(p => p.name))

    for (const [key, value] of Object.entries(attributes)) {
      if (toolParamNames.has(key) && this.isMeaningfulValue(value)) {
        matched[key] = value
      }
    }

    appLogger.debug('[ParamResolution] Collected from attributes', {
      totalAttributes: Object.keys(attributes).length,
      matchedCount: Object.keys(matched).length
    })

    return matched
  }

  /**
   * Collect from signals.temporalDetails
   */
  private collectFromTemporal(
    decompositionResult: DecomposedQuery,
    toolParams: ToolParam[]
  ): Record<string, unknown> {
    const signals = decompositionResult?.signals
    const temporalDetails = signals?.temporalDetails

    if (!temporalDetails || temporalDetails.length === 0) {
      return {}
    }

    const temporal: Record<string, unknown> = {}

    for (const detail of temporalDetails) {
      const mappedTemporal = this.mapTemporalDetailToParam(detail, toolParams)
      if (!mappedTemporal) {
        continue
      }

      const { paramName, param, value } = mappedTemporal
      
      if (PipelineValidator.validateParamValue(param, value)) {
        temporal[paramName] = value
        
        appLogger.debug('[ParamResolution] Collected temporal', {
          paramName,
          originalValue: detail.value,
          normalizedValue: value
        })
      } else {
        appLogger.debug('[ParamResolution] Skipped incompatible temporal value', {
          paramName,
          paramType: param.type,
          temporalType: detail.type,
          originalValue: detail.value,
          normalizedValue: detail.normalizedValue
        })
      }
    }

    return temporal
  }

  private mapTemporalDetailToParam(
    detail: NonNullable<DecomposedQuery['signals']['temporalDetails']>[number],
    toolParams: ToolParam[]
  ): { paramName: string; param: ToolParam; value: unknown } | null {
    if (!detail.normalizedValue) {
      return null
    }

    const exactParam = toolParams.find(param => param.name === detail.type)
    if (exactParam) {
      return {
        paramName: exactParam.name,
        param: exactParam,
        value: detail.normalizedValue
      }
    }

    const dateParam = toolParams.find(param => param.name === 'date')
    if (!dateParam) {
      return null
    }

    // Only exact date-like temporal details may fill a date param. Month/year
    // details from rewritten text must not overwrite an ISO date.
    if (detail.type === 'date' || detail.type === 'day') {
      return {
        paramName: 'date',
        param: dateParam,
        value: detail.normalizedValue
      }
    }

    return null
  }

  private async extractOptionalSemanticParams(
    input: PipelineInput,
    toolParams: ToolParam[],
    currentParams: Record<string, unknown>,
    options: ParamResolutionOptions
  ): Promise<{
    params: Record<string, unknown>
    confidences: Record<string, number>
    cleared: ToolParam[]
  }> {
    const candidates = toolParams.filter(param =>
      this.shouldExtractOptionalSemanticParam(param) &&
      (
        !this.isMeaningfulValue(currentParams[param.name]) ||
        options.allowOptionalSemanticOverwrite ||
        options.clearStaleOptionalSemanticParams
      )
    )

    if (candidates.length === 0) {
      return { params: {}, confidences: {}, cleared: [] }
    }

    appLogger.debug('[ParamResolution] Optional semantic params selected', {
      candidates: candidates.map(param => param.name),
      mode: options.mode,
      allowOverwrite: options.allowOptionalSemanticOverwrite,
      clearStale: options.clearStaleOptionalSemanticParams
    })

    const params: Record<string, unknown> = {}
    const confidences: Record<string, number> = {}
    const cleared: ToolParam[] = []
    const unresolvedForLLM: ToolParam[] = []

    for (const param of candidates) {
      const deterministicValue = this.extractSemanticValueFromText(input.text, param, toolParams)

      if (this.isMeaningfulValue(deterministicValue)) {
        params[param.name] = deterministicValue
        confidences[param.name] = 0.9
        continue
      }

      const semanticRemainder = this.normalizeSemanticStringValue(input.text, input.text, param, toolParams)

      if (
        options.mode === 'continuation' &&
        options.clearStaleOptionalSemanticParams &&
        this.isMeaningfulValue(currentParams[param.name]) &&
        !this.isMeaningfulValue(semanticRemainder)
      ) {
        cleared.push(param)
        continue
      }

      if (
        this.isMeaningfulValue(semanticRemainder) &&
        (!this.isMeaningfulValue(currentParams[param.name]) || options.allowOptionalSemanticOverwrite)
      ) {
        unresolvedForLLM.push(param)
      }
    }

    if (unresolvedForLLM.length > 0) {
      const extractionResult = await paramExtractorService.extractAll(input.text, unresolvedForLLM)

      for (const param of unresolvedForLLM) {
        const rawValue = extractionResult.params?.[param.name]
        const confidence = extractionResult.confidences?.[param.name] ?? 0
        const normalized = this.normalizeSemanticStringValue(rawValue, input.text, param, toolParams)
        const hasNormalized = typeof normalized === 'string' && normalized.trim() !== ''

        if (
          confidence >= 0.65 &&
          hasNormalized &&
          PipelineValidator.validateParamValue(param, normalized) &&
          this.isAcceptableSemanticStringValue(normalized)
        ) {
          params[param.name] = normalized
          confidences[param.name] = confidence
        } else if (
          options.mode === 'continuation' &&
          options.clearStaleOptionalSemanticParams &&
          this.isMeaningfulValue(currentParams[param.name])
        ) {
          cleared.push(param)
        }
      }
    }

    appLogger.debug('[ParamResolution] Optional semantic extraction completed', {
      accepted: Object.keys(params),
      cleared: cleared.map(param => param.name),
      attemptedLLM: unresolvedForLLM.map(param => param.name)
    })

    return { params, confidences, cleared }
  }

  private shouldExtractOptionalSemanticParam(param: ToolParam): boolean {
    if (param.isRequired || !param.extractPrompt || param.isHidden) {
      return false
    }

    if (param.type !== 'string' && param.type !== 'text') {
      return false
    }

    if (['date', 'month', 'year', 'timezone'].includes(param.name)) {
      return false
    }

    const haystack = [
      param.name,
      param.label,
      param.description,
      param.extractPrompt
    ].filter(Boolean).join(' ').toLowerCase()

    return [
      'search',
      'keyword',
      'kata kunci',
      'nama',
      'driver',
      'plat',
      'nomor polisi',
      'polisi'
    ].some(token => haystack.includes(token))
  }

  private extractSemanticValueFromText(
    text: string,
    param: ToolParam,
    toolParams: ToolParam[]
  ): string | undefined {
    const normalized = this.normalizeSemanticStringValue(text, text, param, toolParams)
    if (!normalized) {
      return undefined
    }

    // Deterministic extraction is intentionally strict. Generic multi-word
    // residue must go through LLM validation because search semantics depend
    // on each tool's description.
    const titleCaseWords = normalized.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/)
    const plateLike = /\b[A-Z]{1,2}\s?\d{3,4}\s?[A-Z]{1,3}\b/i.test(normalized)

    if (titleCaseWords?.[0]) {
      return titleCaseWords[0].trim()
    }

    if (plateLike) {
      return normalized.trim()
    }

    return undefined
  }

  private normalizeSemanticStringValue(
    value: unknown,
    inputText: string,
    param: ToolParam,
    toolParams: ToolParam[]
  ): string | undefined {
    if (!this.isMeaningfulValue(value)) {
      return undefined
    }

    let text = String(value).trim()
    const originalInput = inputText.trim()

    const statusTerms = this.getSelectTerms(toolParams)
    const removableTerms = [
      'coba', 'cek', 'check', 'tampilkan', 'lihat', 'data',
      'kalau', 'cari', 'apakah', 'ada', 'untuk', 'yang', 'dong', 'tolong',
      'hari ini', 'kemarin', 'besok', 'tanggal berapa', 'tgl berapa',
      'mulai tanggal berapa', 'bulan apa', 'bulan berapa', 'tahun berapa',
      'kapan', ...statusTerms
    ]

    for (const term of removableTerms.sort((a, b) => b.length - a.length)) {
      const pattern = new RegExp(`(^|\\s)${this.escapeRegex(term)}(?=\\s|$)`, 'gi')
      text = text.replace(pattern, ' ')
    }

    text = text
      .replace(/[?.,;:!]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!text) {
      return undefined
    }

    if (text.toLowerCase() === originalInput.toLowerCase()) {
      return undefined
    }

    const minLength = param.config?.minLength ?? 2
    const maxLength = param.config?.maxLength ?? 100

    if (text.length < minLength || text.length > maxLength) {
      return undefined
    }

    return text
  }

  private isAcceptableSemanticStringValue(value: string): boolean {
    const normalized = value.trim()
    if (!normalized) {
      return false
    }

    const titleCaseWords = normalized.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/)
    const plateLike = /\b[A-Z]{1,2}\s?\d{3,4}\s?[A-Z]{1,3}\b/i.test(normalized)
    const words = normalized.split(/\s+/).filter(Boolean)

    if (titleCaseWords?.[0] || plateLike) {
      return true
    }

    if (words.length < 2) {
      return false
    }

    const blockedConnectors = new Set([
      'yang',
      'cari',
      'apakah',
      'ada',
      'untuk',
      'dengan',
      'di',
      'ke',
      'dari',
      'pada'
    ])

    return words.every(word => !blockedConnectors.has(word.toLowerCase()))
  }

  private getSelectTerms(toolParams: ToolParam[]): string[] {
    const terms = new Set<string>()

    for (const param of toolParams) {
      if (param.type !== 'select') {
        continue
      }

      for (const option of param.config?.options || []) {
        terms.add(String(option.value).toLowerCase())
        terms.add(String(option.label).toLowerCase())
      }
    }

    for (const term of ['aktif', 'berjalan', 'cuti', 'izin', 'cuti izin', 'cuti/izin', 'keluar', 'nonaktif', 'berhenti']) {
      terms.add(term)
    }

    return [...terms].filter(Boolean)
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private getTemporalQuestionType(text: string): 'date' | 'month' | 'year' | null {
    const normalized = text.toLowerCase().replace(/[?.,;:!]+/g, ' ').replace(/\s+/g, ' ').trim()

    if (/\b(tanggal|tgl)\s+berapa\b/.test(normalized) || /\bkapan\b/.test(normalized)) {
      return 'date'
    }

    if (/\bbulan\s+(apa|berapa)\b/.test(normalized)) {
      return 'month'
    }

    if (/\btahun\s+berapa\b/.test(normalized)) {
      return 'year'
    }

    return null
  }

  private removeTemporalFilterParams(params: Record<string, unknown>): Record<string, unknown> {
    const temporalKeys = new Set([
      'date',
      'month',
      'year',
      'start_date',
      'end_date',
      'from_date',
      'to_date',
      'tanggal',
      'bulan',
      'tahun'
    ])

    return Object.fromEntries(
      Object.entries(params).filter(([key]) => !temporalKeys.has(key))
    )
  }

  /**
   * Collect from deterministic rules
   * Extracts params that can be deterministically detected from query text
   */
  private collectFromRules(
    text: string,
    toolParams: ToolParam[]
  ): Record<string, unknown> {
    const rules: Record<string, unknown> = {}
    const lowerText = text.toLowerCase()

    const automationRules = this.collectAutomationRules(text, toolParams)
    Object.assign(rules, automationRules)

    // Rule 1: Status detection for select params
    const selectParams = toolParams.filter(p => p.type === 'select' && p.config?.options)
    
    for (const param of selectParams) {
      const statusOptions = param.config?.options || []
      
      for (const option of statusOptions) {
        // Check if query mentions this option (by value or label)
        if (lowerText.includes(option.value.toLowerCase()) || 
            lowerText.includes(option.label.toLowerCase())) {
          rules[param.name] = option.value
          
          appLogger.debug('[ParamResolution] Detected select from rule', {
            paramName: param.name,
            detectedValue: option.value,
            matchedText: option.label
          })
          break  // First match wins
        }
      }
    }

    // Rule 2: Timezone detection for time/location follow-up queries.
    // This must override working memory attributes during refine, e.g.
    // previous timezone Asia/Jakarta + "kalau bali" => Asia/Makassar.
    const timezoneParam = toolParams.find(param =>
      param.name === 'timezone' ||
      param.extractPrompt?.toLowerCase().includes('timezone')
    )

    if (timezoneParam) {
      const timezone = extractTimezoneFromText(text)
      if (timezone) {
        rules[timezoneParam.name] = timezone

        appLogger.debug('[ParamResolution] Detected timezone from rule', {
          paramName: timezoneParam.name,
          timezone
        })
      }
    }

    // Rule 3: Boolean detection
    const boolParams = toolParams.filter(p => p.type === 'boolean')
    
    for (const param of boolParams) {
      if (lowerText.includes(param.name.toLowerCase())) {
        // Check for affirmative/negative patterns
        const affirmative = ['ya', 'yes', 'true', 'aktif', 'on', 'setuju']
        const negative = ['tidak', 'no', 'false', 'nonaktif', 'off', 'tidak ada', 'belum']
        
        const hasAffirmative = affirmative.some(w => lowerText.includes(w))
        const hasNegative = negative.some(w => lowerText.includes(w))
        
        if (hasAffirmative && !hasNegative) {
          rules[param.name] = true
        } else if (hasNegative && !hasAffirmative) {
          rules[param.name] = false
        }
      }
    }

    // Rule 4: Email detection
    const emailParams = toolParams.filter(p => p.type === 'email')
    
    for (const param of emailParams) {
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
      const match = emailRegex.exec(text)
      
      if (match && match[0]) {
        rules[param.name] = match[0]
        
        appLogger.debug('[ParamResolution] Detected email from rule', {
          paramName: param.name,
          email: match[0]
        })
      }
    }

    // Rule 5: Phone detection (basic pattern)
    const phoneParams = toolParams.filter(p => p.type === 'phone')
    
    for (const param of phoneParams) {
      // Basic phone pattern (8-20 digits, spaces, dashes, plus, parentheses)
      const phoneRegex = /[\d\s\-\+\(\)]{8,20}/gi
      const match = phoneRegex.exec(text)
      
      if (match && match[0]) {
        rules[param.name] = match[0].trim()
        
        appLogger.debug('[ParamResolution] Detected phone from rule', {
          paramName: param.name,
          phone: match[0]
        })
      }
    }

    return rules
  }

  private collectAutomationRules(
    text: string,
    toolParams: ToolParam[]
  ): Record<string, unknown> {
    const rules: Record<string, unknown> = {}
    const names = new Set(toolParams.map(param => param.name))

    if (names.has('automation_type')) {
      const normalized = this.normalizeForSignal(text)
      const typeFromLabel = normalizeAutomationTypeLabel(normalized)
      if (typeFromLabel) {
        rules.automation_type = typeFromLabel
      } else if (/\b(reminder|pengingat|ingatkan|remind)\b/i.test(normalized)) {
        rules.automation_type = 'reminder'
      } else if (/\b(scheduled workflow|workflow terjadwal|jadwal|jadwalkan|setiap|tiap|schedule|recurring)\b/i.test(normalized)) {
        rules.automation_type = 'scheduled_workflow'
      } else if (/\b(conditional alert|pantau|monitor|kalau|jika|if|when)\b/i.test(normalized)) {
        rules.automation_type = 'conditional_alert'
      }
    }

    if (names.has('schedule')) {
      const schedule = this.extractScheduleText(text)
      if (schedule) {
        rules.schedule = schedule
      }
    }

    if (names.has('goal')) {
      const goal = this.extractAutomationGoalText(text)
      if (goal) {
        rules.goal = goal
      }
    }

    if (names.has('condition')) {
      const condition = this.extractConditionText(text)
      if (condition) {
        rules.condition = condition
      }
    }

    return rules
  }

  private extractScheduleText(text: string): string | undefined {
    const expressions = parseTemporalExpressions(text, { locale: 'auto', timezone: 'Asia/Jakarta' })
    const expression = expressions.find(item => item.kind === 'datetime' || item.kind === 'recurrence' || item.kind === 'date')
    if (expression?.raw) return expression.raw

    const clockOnly = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/)
    if (clockOnly) return clockOnly[0].replace('.', ':')

    const spokenClock = text.match(/\b(?:jam|pukul)\s+([01]?\d|2[0-3])\s+([0-5]\d)\b/i)
    if (spokenClock) return `${spokenClock[1].padStart(2, '0')}:${spokenClock[2]}`

    return undefined
  }

  private extractAutomationGoalText(text: string): string | undefined {
    let goal = String(text || '')
    const schedule = this.extractScheduleText(goal)
    if (schedule) {
      goal = goal.replace(new RegExp(this.escapeRegex(schedule), 'i'), ' ')
    }

    return cleanAutomationGoalText(goal)
  }

  private extractConditionText(text: string): string | undefined {
    const match = String(text || '').match(/\b(kalau|jika|if|when)\b(.+)$/i)
    return match?.[2]?.trim() || undefined
  }

  /**
   * Merge params with precedence (last wins)
   */
  private mergeWithPrecedence(sources: SourceParams[]): Record<string, unknown> {
    const merged: Record<string, unknown> = {}

    // Apply in order (first to last, last wins)
    for (const { params } of sources) {
      Object.assign(merged, params)
    }

    return merged
  }

  /**
   * Find missing required param names
   */
  private findMissingRequiredByOwners(
    resourceOwners: ResourceParamOwner[],
    availableParams: Record<string, unknown>,
    tasks: PlannerTask[]
  ): string[] {
    const missing = new Set<string>()

    for (const owner of resourceOwners) {
      for (const param of owner.params) {
        if (!param.isRequired) {
          continue
        }

        if (this.isRuntimeProvidedSkillDataParam(owner, param.name, tasks)) {
          continue
        }

        if (availableParams.__dateBlind === true && this.isTemporalFilterParam(param.name)) {
          continue
        }

        if (!PipelineValidator.validateParamValue(param, availableParams[param.name])) {
          missing.add(param.name)
        }
      }
    }

    return [...missing]
  }

  private isRuntimeProvidedSkillDataParam(
    owner: ResourceParamOwner,
    paramName: string,
    tasks: PlannerTask[]
  ): boolean {
    if (owner.resource !== 'skill' || paramName !== 'data') {
      return false
    }

    return tasks.some(task =>
      task.resource === 'skill' &&
      task.key === owner.key &&
      Array.isArray(task.depends_on) &&
      task.depends_on.length > 0
    )
  }


  /**
   * Check if value is meaningful (not empty/null/undefined)
   */
  private isMeaningfulValue(value: any): boolean {
    return value !== undefined 
        && value !== null 
        && value !== 'null'
        && value !== ''
        && !(typeof value === 'string' && value.trim() === '')
  }

  private isTemporalFilterParam(name: string): boolean {
    return [
      'date',
      'month',
      'year',
      'start_date',
      'end_date',
      'from_date',
      'to_date',
      'tanggal',
      'bulan',
      'tahun'
    ].includes(name)
  }
}

// Singleton instance
export const paramResolutionService = new ParamResolutionService()
