// src/services/naturalization.service.ts
import { openAiService } from './openAi.service'
import { ollamaService } from './ollama.service'
import { config } from '../config'
import type { Agent } from '../types/agent.types'

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
    agent: Agent,
    apiResult: unknown,
    originalQuery: string,
    userName: string,
    language: string = 'Indonesia',
  ): Promise<string> {
    const start = Date.now()
    
    console.log(`[Naturalization] Agent: ${agent.llmModel?.modelCode}`)
    // Pilih service berdasarkan config.default.provider
    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'

    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel

    const temperature = agent.llmModel?.temperature || config.default?.temperature

    const systemPrompt = agent.systemPrompt || config.default?.systemPrompt
    const customPrompt = agent.customPrompt || "ROLE: Assistant JSON extractor: "
    
    let result: string
    
    if (provider === 'qwen') {
      result = await openAiService.naturalize(
        apiResult,
        originalQuery,
        userName,
        language,
        customPrompt,
        llmModel,
        {
          temperature: temperature || 0.6,
          num_predict: config.default?.numPredict,
        }
      )
    } else {
      result = await ollamaService.naturalize(
        apiResult,
        originalQuery,
        userName,
        language,
        llmModel,
        {
          temperature: 0.6,
          num_predict: config.default?.numPredict,
        }
      )
    }
    
    const duration = Date.now() - start
    console.log(`[Naturalization] ${provider} response time: ${duration}ms (${(duration/1000).toFixed(2)}s)`)
    
    return result
  }
}

export const naturalizationService = new NaturalizationService()