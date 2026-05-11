// src/services/naturalization.service.ts
import { openAiService } from './openAi.service'
import { ollamaService } from './ollama.service'
import { config } from '../config'
import type { PipelineInput } from '../types'

// ============================================================
// Naturalization Service — Mengubah API result menjadi natural language
// ============================================================

class NaturalizationService {
  
  /**
   * Naturalize API result to human readable text
   * @param apiResult - Result from API/tools/knowledge execution
   * @param originalQuery - Original user query
   * @param userName - User name
   * @param language - Response language
   * @param llmModel - Optional custom model
   * @returns Human readable response
   */
  async naturalize(
    apiResult: unknown,
    originalQuery: string,
    userName: string,
    language: string = 'Indonesia',
    llmModel?: string
  ): Promise<string> {
    const start = Date.now()
    
    // Pilih service berdasarkan config.default.provider
    const provider = config.default?.provider || 'ollama'
    
    let result: string
    
    if (provider === 'openai') {
      result = await openAiService.naturalize(
        apiResult,
        originalQuery,
        userName,
        language,
        llmModel || config.alibaba?.naturalModel
      )
    } else {
      result = await ollamaService.naturalize(
        apiResult,
        originalQuery,
        userName,
        language,
        llmModel || config.ollama?.llmModel
      )
    }
    
    const duration = Date.now() - start
    console.log(`[Naturalization] ${provider} response time: ${duration}ms (${(duration/1000).toFixed(2)}s)`)
    
    return result
  }
}

export const naturalizationService = new NaturalizationService()