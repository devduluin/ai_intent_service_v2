// ============================================================
// LLM Fallback Service
// ============================================================
// Provides LLM-based fallback when analyzers fail or are uncertain
// Used for:
// - Semantic similarity estimation (when embedding fails)
// - Entity extraction (when confidence is low)
// - Workflow continuation determination (when ambiguous)
// - Final arbitration (for borderline scores)
// ============================================================

import { openAiService } from '../../openAi.service';
import { ollamaService } from '../../ollama.service';
import { config } from '../../../config';
import { appLogger } from '../../../utils/logger.util';
import type { ChatMessage } from '../../ollama.service';

// ============================================================
// Types
// ============================================================

export interface SemanticSimilarityEstimate {
  similarity: number;  // 0.0-1.0
  confidence: number;  // 0.0-1.0
  reasoning: string;
}

export interface EntityExtractionResult {
  entities: Record<string, string>;
  confidence: number;
  extractedEntities: Array<{
    type: string;
    value: string;
    confidence: number;
  }>;
}

export interface WorkflowContinuationDecision {
  isContinuation: boolean;
  confidence: number;
  reasoning: string;
}

export interface FinalArbitrationResult {
  isContinuation: boolean;
  confidence: number;
  reasoning: string;
  scores: {
    keyword: number;
    entity: number;
    semantic: number;
    workflow: number;
  };
}

export interface LlmFallbackOptions {
  timeout?: number;  // Timeout in ms (default: 2000)
  useQwen?: boolean; // Use Qwen instead of Ollama (default: false)
}

// ============================================================
// LLM Fallback Service
// ============================================================

class LlmFallbackService {

  /**
   * Estimate semantic similarity using LLM
   * Used when embedding model fails or is unavailable
   */
  async estimateSemanticSimilarity(
    currentQuery: string,
    previousQuery: string,
    prevIntent: string
  ): Promise<SemanticSimilarityEstimate> {
    const prompt = this.buildSemanticSimilarityPrompt(
      currentQuery,
      previousQuery,
      prevIntent
    );

    try {
      const response = await this.callLLM(prompt, 'semantic_similarity');
      return this.parseSemanticSimilarityResponse(response);
    } catch (error) {
      appLogger.error('[LlmFallback] Semantic similarity estimation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Return conservative estimate
      return {
        similarity: 0.5,
        confidence: 0.3,
        reasoning: 'LLM fallback failed, using conservative estimate'
      };
    }
  }

  /**
   * Extract entities from query using LLM
   * Used when entity confidence is low
   */
  async extractEntities(
    query: string,
    prevEntities: Record<string, unknown>
  ): Promise<EntityExtractionResult> {
    const prompt = this.buildEntityExtractionPrompt(query, prevEntities);

    try {
      const response = await this.callLLM(prompt, 'entity_extraction');
      return this.parseEntityExtractionResponse(response);
    } catch (error) {
      appLogger.error('[LlmFallback] Entity extraction failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        entities: {},
        confidence: 0.3,
        extractedEntities: []
      };
    }
  }

  /**
   * Determine if query is workflow continuation using LLM
   * Used when workflow confidence is low (< 0.6)
   */
  async isWorkflowContinuation(
    query: string,
    prevIntent: string,
    prevEntities: Record<string, unknown>
  ): Promise<WorkflowContinuationDecision> {
    const prompt = this.buildWorkflowContinuationPrompt(
      query,
      prevIntent,
      prevEntities
    );

    try {
      const response = await this.callLLM(prompt, 'workflow_continuation');
      return this.parseWorkflowContinuationResponse(response);
    } catch (error) {
      appLogger.error('[LlmFallback] Workflow continuation check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        isContinuation: false,
        confidence: 0.3,
        reasoning: 'LLM fallback failed, assuming not continuation'
      };
    }
  }

  /**
   * Final arbitration for borderline scores (0.4-0.7)
   * LLM makes final decision based on all available information
   */
  async finalDecision(params: {
    query: string;
    prevIntent: string;
    prevEntities: Record<string, unknown>;
    scores: {
      keyword: number;
      entity: number;
      semantic: number;
      workflow: number;
    };
  }): Promise<FinalArbitrationResult> {
    const prompt = this.buildFinalArbitrationPrompt(params);

    try {
      const response = await this.callLLM(prompt, 'final_arbitration');
      return this.parseFinalArbitrationResponse(response);
    } catch (error) {
      appLogger.error('[LlmFallback] Final arbitration failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Default to not continuation on failure
      return {
        isContinuation: false,
        confidence: 0.5,
        reasoning: 'LLM fallback failed, defaulting to not continuation',
        scores: params.scores
      };
    }
  }

  /**
   * Call LLM with timeout
   */
  private async callLLM(
    prompt: string,
    taskType: string,
    options?: LlmFallbackOptions
  ): Promise<string> {
    const timeout = options?.timeout || 2000;
    const useQwen = options?.useQwen ?? false;

    appLogger.debug('[LlmFallback] Calling LLM', {
      taskType,
      timeout,
      provider: useQwen ? 'qwen' : 'ollama',
      promptLength: prompt.length
    });

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a conversation flow analyzer. Respond with JSON only.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    try {
      if (useQwen && config.alibaba?.llmModel) {
        return await openAiService.chatMessage(messages, config.alibaba.llmModel, {
          temperature: 0.1,
          num_predict: 500
        });
      } else {
        return await ollamaService.chatMessage(messages, config.ollama?.llmModel, {
          temperature: 0.1,
          num_predict: 500
        });
      }
    } catch (error) {
      appLogger.error('[LlmFallback] LLM call failed', {
        taskType,
        provider: useQwen ? 'qwen' : 'ollama',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  // ============================================================
  // Prompt Builders
  // ============================================================

  private buildSemanticSimilarityPrompt(
    currentQuery: string,
    previousQuery: string,
    prevIntent: string
  ): string {
    return `
Analyze the semantic similarity between two queries in a conversation.

PREVIOUS CONTEXT:
- Intent: ${prevIntent}
- Query: "${previousQuery}"

CURRENT QUERY:
"${currentQuery}"

TASK:
Estimate how semantically similar the current query is to the previous context.

RESPOND WITH JSON:
{
  "similarity": 0.0-1.0,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

GUIDELINES:
- similarity=1.0: Exact same topic/intent
- similarity=0.7-0.9: Related topic, same general domain
- similarity=0.4-0.6: Somewhat related, but different focus
- similarity=0.0-0.3: Completely different topic

RESPOND:
`.trim();
  }

  private buildEntityExtractionPrompt(
    query: string,
    prevEntities: Record<string, unknown>
  ): string {
    return `
Extract entities from the user query that might represent entity substitution.

PREVIOUS ENTITIES:
${JSON.stringify(prevEntities, null, 2)}

CURRENT QUERY:
"${query}"

TASK:
Identify any entities in the current query that might be substituting previous entities.

RESPOND WITH JSON:
{
  "entities": {
    "entity_type": "entity_value"
  },
  "confidence": 0.0-1.0,
  "extractedEntities": [
    {
      "type": "city|date|timezone|location",
      "value": "extracted value",
      "confidence": 0.0-1.0
    }
  ]
}

EXAMPLES:
- "kalau bandung?" → { "city": "bandung" }
- "besok?" → { "date": "besok" }
- "di surabaya?" → { "location": "surabaya" }

RESPOND:
`.trim();
  }

  private buildWorkflowContinuationPrompt(
    query: string,
    prevIntent: string,
    prevEntities: Record<string, unknown>
  ): string {
    return `
Determine if the current query is a continuation of a multi-step workflow.

PREVIOUS CONTEXT:
- Intent: ${prevIntent}
- Entities: ${JSON.stringify(prevEntities, null, 2)}

CURRENT QUERY:
"${query}"

TASK:
Determine if this query continues a multi-step workflow from the previous context.

RESPOND WITH JSON:
{
  "isContinuation": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

GUIDELINES:
- isContinuation=true: Query uses connectors like "lalu", "kemudian", "setelah itu"
- isContinuation=true: Query is next logical step in workflow
- isContinuation=false: Query starts new topic/workflow

RESPOND:
`.trim();
  }

  private buildFinalArbitrationPrompt(params: {
    query: string;
    prevIntent: string;
    prevEntities: Record<string, unknown>;
    scores: {
      keyword: number;
      entity: number;
      semantic: number;
      workflow: number;
    };
  }): string {
    return `
Make a final decision about whether this query is a continuation of the previous conversation.

PREVIOUS CONTEXT:
- Intent: ${params.prevIntent}
- Entities: ${JSON.stringify(params.prevEntities, null, 2)}

CURRENT QUERY:
"${params.query}"

ANALYZER SCORES:
- Keyword Match: ${params.scores.keyword}
- Entity Continuity: ${params.scores.entity}
- Semantic Similarity: ${params.scores.semantic}
- Workflow Continuity: ${params.scores.workflow}

TASK:
Based on all available information, decide if this is a conversation continuation.

RESPOND WITH JSON:
{
  "isContinuation": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "scores": {
    "keyword": ${params.scores.keyword},
    "entity": ${params.scores.entity},
    "semantic": ${params.scores.semantic},
    "workflow": ${params.scores.workflow}
  }
}

GUIDELINES:
- Consider all scores together
- High entity continuity (>0.5) suggests continuation
- Pattern keywords ("kalau", "besok", "di") suggest continuation
- Low scores across all dimensions suggest new topic

RESPOND:
`.trim();
  }

  // ============================================================
  // Response Parsers
  // ============================================================

  private parseSemanticSimilarityResponse(response: string): SemanticSimilarityEstimate {
    try {
      const parsed = JSON.parse(response);
      return {
        similarity: Math.max(0, Math.min(1, parsed.similarity || 0.5)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning || 'LLM estimation'
      };
    } catch (error) {
      appLogger.warn('[LlmFallback] Failed to parse semantic similarity response', {
        response: response.substring(0, 100)
      });
      
      return {
        similarity: 0.5,
        confidence: 0.3,
        reasoning: 'Failed to parse LLM response'
      };
    }
  }

  private parseEntityExtractionResponse(response: string): EntityExtractionResult {
    try {
      const parsed = JSON.parse(response);
      return {
        entities: parsed.entities || {},
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        extractedEntities: parsed.extractedEntities || []
      };
    } catch (error) {
      appLogger.warn('[LlmFallback] Failed to parse entity extraction response', {
        response: response.substring(0, 100)
      });
      
      return {
        entities: {},
        confidence: 0.3,
        extractedEntities: []
      };
    }
  }

  private parseWorkflowContinuationResponse(response: string): WorkflowContinuationDecision {
    try {
      const parsed = JSON.parse(response);
      return {
        isContinuation: parsed.isContinuation === true,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning || 'LLM determination'
      };
    } catch (error) {
      appLogger.warn('[LlmFallback] Failed to parse workflow continuation response', {
        response: response.substring(0, 100)
      });
      
      return {
        isContinuation: false,
        confidence: 0.3,
        reasoning: 'Failed to parse LLM response'
      };
    }
  }

  private parseFinalArbitrationResponse(response: string): FinalArbitrationResult {
    try {
      const parsed = JSON.parse(response);
      return {
        isContinuation: parsed.isContinuation === true,
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning || 'LLM arbitration',
        scores: {
          keyword: parsed.scores?.keyword || 0,
          entity: parsed.scores?.entity || 0,
          semantic: parsed.scores?.semantic || 0,
          workflow: parsed.scores?.workflow || 0
        }
      };
    } catch (error) {
      appLogger.warn('[LlmFallback] Failed to parse final arbitration response', {
        response: response.substring(0, 100)
      });
      
      return {
        isContinuation: false,
        confidence: 0.5,
        reasoning: 'Failed to parse LLM response',
        scores: {
          keyword: 0,
          entity: 0,
          semantic: 0,
          workflow: 0
        }
      };
    }
  }
}

// Singleton instance
export const llmFallbackService = new LlmFallbackService();
