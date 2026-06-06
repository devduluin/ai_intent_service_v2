// ============================================================
// LLM Entity Detector Service
// ============================================================
// Detects entity changes using LLM with full context awareness
// Collaborates with query-decomposition.service.ts and paramExtractor.service.ts
// ============================================================

import { queryDecompositionService, extractTemporalDetails } from '../../query-decomposition.service';
import { paramExtractorService } from '../../paramExtractor.service';
import { openAiService } from '../../openAi.service';
import { ollamaService } from '../../ollama.service';
import { config } from '../../../config';
import { appLogger } from '../../../utils/logger.util';
import { isKnownCity, isKnownDateRef, isKnownTimezone } from '../../../utils/hash.util';
import { toolParamConfigService } from '../../tool-param-config.service';
import type { ToolParam } from '../../../types';

// ============================================================
// Types
// ============================================================

export interface EntityChangeDetection {
  detected: boolean;
  type?: string;
  oldValue?: string;
  newValue?: string;
  confidence: number;
  reasoning?: string;
  
  // Multiple entity changes
  multipleChanges?: Array<{
    type: string;
    oldValue?: string;
    newValue: string;
    confidence: number;
  }>;
  
  // Temporal change detection
  temporalChange?: {
    type: 'day' | 'week' | 'month' | 'year' | 'quarter';
    oldValue?: string;
    newValue: string;
    normalizedValue?: string;
  };
}

export interface EntityDetectionContext {
  previousEntities: Record<string, unknown>;
  previousIntent?: string;
  conversationHistory?: any;
  domainKnowledge?: any[];

  // From query-decomposition
  temporalHints?: string[];
  temporalDetails?: Array<{
    type: string;
    value: string;
    normalizedValue?: string;
    direction?: 'current' | 'past' | 'future'
  }>;
  entityHints?: string[];
  actionHints?: string[];

  // From paramExtractor
  extractedEntities?: Record<string, unknown>;

  // NEW: Tool parameters with config
  toolParams?: ToolParam[];
}

// ============================================================
// LLM Entity Detector Service
// ============================================================

class LlmEntityDetectorService {
  
  /**
   * Detect entity change with full context
   */
  async detectEntityChange(
    query: string,
    context: EntityDetectionContext
  ): Promise<EntityChangeDetection> {
    try {
      // Step 1: Get temporal & entity hints from query-decomposition
      const decomposition = await queryDecompositionService.decompose(query);
      const signals = decomposition.signals;

      appLogger.info(`Detected signals: ${JSON.stringify(signals)}`);

      // Step 2: Extract temporal details
      const temporalDetails = extractTemporalDetails(query);

      // Step 3: Get additional entities from paramExtractor
      // Use toolParams from context if available, otherwise generate generic types
      let toolParams: ToolParam[] = context.toolParams || []
      
      if (toolParams.length === 0) {
        const entityTypes = await this.getAllEntityTypes();
        toolParams = entityTypes.map(type => ({
          name: type,
          type: 'string' as const,
          description: `Extract ${type} from user query`,
          isRequired: false
        }));
      }

      const extractedEntities = await paramExtractorService.extractAll(
        query,
        toolParams
      );

      // Step 4: Build enhanced prompt with ALL context including tool config
      const prompt = this.buildEnhancedPrompt(query, {
        ...context,
        temporalHints: signals.temporalHints,
        temporalDetails: temporalDetails,
        entityHints: signals.entityHints,
        actionHints: signals.actionHints,
        extractedEntities: extractedEntities.params,
        toolParams: toolParams  // Pass tool params with config
      });

      // Step 5: Call LLM
      const response = await this.callLLM(prompt);
      const llmDetection = this.parseDetectionResponse(response);

      // Step 6: Log detection result
      appLogger.info('[LlmEntityDetector] Entity detection completed', {
        query,
        detected: llmDetection.detected,
        type: llmDetection.type,
        confidence: llmDetection.confidence,
        hasTemporalChange: !!llmDetection.temporalChange,
        hasMultipleChanges: !!llmDetection.multipleChanges
      });

      return llmDetection;

    } catch (error) {
      appLogger.error('[LlmEntityDetector] Detection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Fallback to rule-based detection
      return this.fallbackDetect(query, context);
    }
  }

  /**
   * Build enhanced prompt with temporal & entity context
   */
  private buildEnhancedPrompt(
    query: string,
    context: EnhancedEntityDetectionContext
  ): string {
    // Build tool params description with config
    let toolParamsDescription = ''
    if (context.toolParams && context.toolParams.length > 0) {
      toolParamsDescription = context.toolParams.map(param => {
        const label = param.label || param.name
        const type = param.type
        const config = param.config
        
        let desc = `- ${label} (${type})`
        
        if (type === 'select' && config?.options) {
          const options = config.options.map(o => `${o.label} (${o.value})`).join(', ')
          desc += ` [Options: ${options}]`
        }
        
        if (type === 'date' && config?.format) {
          desc += ` [Format: ${config.format}]`
          if (config?.allowRelative) {
            desc += ` [Accepts: kemarin, besok, minggu depan, etc.]`
          }
        }
        
        if (type === 'number' && (config?.min !== undefined || config?.max !== undefined)) {
          const range = []
          if (config?.min !== undefined) range.push(`>= ${config.min}`)
          if (config?.max !== undefined) range.push(`<= ${config.max}`)
          desc += ` [Range: ${range.join(' ')}]`
        }
        
        if (config?.pattern) {
          desc += ` [Pattern: ${config.pattern}]`
        }
        
        return desc
      }).join('\n')
    }

    return `
Analyze if the user query indicates a change in entity from previous context.

PREVIOUS CONTEXT:
- Intent: ${context.previousIntent || 'unknown'}
- Previous Entities: ${JSON.stringify(context.previousEntities)}

CURRENT QUERY ANALYSIS:
- Query: "${query}"
- Temporal Hints: ${JSON.stringify(context.temporalHints || [])}
- Temporal Details: ${JSON.stringify(context.temporalDetails || [])}
- Entity Hints: ${JSON.stringify(context.entityHints || [])}
- Action Hints: ${JSON.stringify(context.actionHints || [])}
- Extracted Entities: ${JSON.stringify(context.extractedEntities || {})}

${toolParamsDescription ? `EXPECTED PARAMETERS:\n${toolParamsDescription}` : ''}

TASK:
1. Determine if user is changing/substituting an entity
2. Identify the entity type (city, date, timezone, employee, department, etc.)
3. Extract old and new values
4. Consider temporal context (e.g., "besok" changes date from "hari ini")
5. Detect multiple changes if present
6. Provide confidence score (0-1)
7. ${toolParamsDescription ? 'Validate extracted values against parameter constraints (options, formats, patterns)' : ''}

RESPOND WITH JSON:
{
  "detected": true/false,
  "type": "city|date|timezone|employee|department|...",
  "oldValue": "previous value",
  "newValue": "new value",
  "confidence": 0.0-1.0,
  "reasoning": "explanation",
  "temporalChange": {
    "type": "day|week|month|year",
    "oldValue": "hari ini",
    "newValue": "besok",
    "normalizedValue": "2026-05-28"
  },
  "multipleChanges": [
    { "type": "city", "oldValue": "jakarta", "newValue": "bandung", "confidence": 0.95 },
    { "type": "date", "oldValue": "hari ini", "newValue": "besok", "confidence": 0.90 }
  ]
}

EXAMPLES:
- Query: "kalau bandung?" → detected: true, type: "city", oldValue: "jakarta", newValue: "bandung"
- Query: "besok?" → detected: true, type: "date", oldValue: "hari ini", newValue: "besok"
- Query: "di surabaya?" → detected: true, type: "location", oldValue: "jakarta", newValue: "surabaya"
- Query: "kalau bandung besok?" → detected: true, multipleChanges: [{type:"city",...}, {type:"date",...}]
${toolParamsDescription ? `- Query: "kendaraan exit" with status param [Options: Aktif (active), Cuti/Izin (leave), Keluar (exit)] → detected: true, type: "status", newValue: "exit"` : ''}

RESPOND:
`.trim();
  }

  /**
   * Call LLM for detection
   */
  private async callLLM(prompt: string): Promise<string> {
    const messages = [
      { role: 'system' as const, content: 'You are an entity change detection assistant. Respond with JSON only.' },
      { role: 'user' as const, content: prompt }
    ];

    try {
      // Use Qwen or Ollama based on config
      if (config.alibaba?.llmModel) {
        return await openAiService.chatMessage(
          messages,
          config.alibaba.llmModel,
          { temperature: 0.1, num_predict: 500 }
        );
      } else {
        return await ollamaService.chatMessage(
          messages,
          config.ollama?.llmModel,
          { temperature: 0.1, num_predict: 500 }
        );
      }
    } catch (error) {
      appLogger.error('[LlmEntityDetector] LLM call failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Parse LLM response
   */
  private parseDetectionResponse(response: string): EntityChangeDetection {
    try {
      const parsed = JSON.parse(response);
      
      return {
        detected: parsed.detected === true,
        type: parsed.type,
        oldValue: parsed.oldValue,
        newValue: parsed.newValue,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
        reasoning: parsed.reasoning,
        multipleChanges: parsed.multipleChanges,
        temporalChange: parsed.temporalChange
      };
    } catch (error) {
      appLogger.warn('[LlmEntityDetector] Failed to parse LLM response', {
        response: response.substring(0, 100)
      });
      
      // Return low-confidence detection
      return {
        detected: false,
        confidence: 0
      };
    }
  }

  /**
   * Fallback to rule-based detection
   */
  private fallbackDetect(
    query: string,
    context: EntityDetectionContext
  ): EntityChangeDetection {
    const normalizedQuery = query.toLowerCase().trim();
    
    // Check for common patterns
    const patterns = [
      { pattern: /\bkalau\s+(\w+)/i, type: 'alternative' },
      { pattern: /\bdi\s+(\w+)/i, type: 'location' },
      { pattern: /\bbesok\b/i, type: 'date' },
      { pattern: /\bkemarin\b/i, type: 'date' },
      { pattern: /\blusa\b/i, type: 'date' }
    ];
    
    for (const { pattern, type } of patterns) {
      const match = normalizedQuery.match(pattern);
      if (match) {
        const value = match[1] || match[0];
        const normalizedValue = value.toLowerCase().trim();
        
        // Check against known entities
        if (type === 'alternative' || type === 'location') {
          if (isKnownCity(normalizedValue)) {
            const oldValue = String(context.previousEntities.city || context.previousEntities.location || 'unknown');
            return {
              detected: true,
              type: 'city',
              oldValue,
              newValue: normalizedValue,
              confidence: 0.7
            };
          }
        }
        
        if (type === 'date') {
          if (isKnownDateRef(normalizedValue)) {
            const oldValue = String(context.previousEntities.date || 'unknown');
            return {
              detected: true,
              type: 'date',
              oldValue,
              newValue: normalizedValue,
              confidence: 0.7
            };
          }
        }
      }
    }
    
    return { detected: false, confidence: 0 };
  }

  /**
   * Get all entity types for paramExtractor
   */
  private async getAllEntityTypes(): Promise<string[]> {
    return [
      'city',
      'location',
      'date',
      'timezone',
      'employee',
      'department',
      'product',
      'service'
    ];
  }
}

// Enhanced context type
type EnhancedEntityDetectionContext = EntityDetectionContext & {
  temporalHints?: string[];
  temporalDetails?: Array<{
    type: string;
    value: string;
    normalizedValue?: string;
    direction?: 'current' | 'past' | 'future'
  }>;
  entityHints?: string[];
  actionHints?: string[];
  extractedEntities?: Record<string, unknown>;
};

// Singleton instance
export const llmEntityDetectorService = new LlmEntityDetectorService();
