// src/services/naturalization.service.ts
import { openAiService } from './openAi.service'
import { ollamaService } from './ollama.service'
import { config } from '../config'
import type { Agent } from '../types/agent.types'
import type { PipelineInput } from '../types'
import type { ChatMessage } from './openAi.service'
import type { ContextCache } from './cores/stages/types/context-cache'
import { trimChatHistory } from '../utils/trim-chat'
import { emotionToneService } from './emotion-tone.service'

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
    input: PipelineInput,
    userName: string,
    language: string = 'Indonesia',
    contextCache?: ContextCache,
  ): Promise<string> {
    const start = Date.now()
    
    console.log(`[Naturalization] Agent: ${agent.llmModel?.modelCode}`)

    const profileRecallResponse = this.tryNaturalizeUserProfileRecall(apiResult, input, contextCache);
    if (profileRecallResponse) {
      const adapted = emotionToneService.adaptShortMessage(profileRecallResponse, contextCache?.emotion);
      console.log(`[Naturalization] User profile fast response time: ${Date.now() - start}ms`)
      console.log(`[Naturalization] Final response : ${adapted}`)
      return adapted;
    }

    // Pilih service berdasarkan config.default.provider
    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'

    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel

    const temperature = config.default?.temperature

    const customPrompt = agent.customPrompt || agent.systemPrompt || config.default?.systemPrompt || "ROLE: Assistant JSON extractor: "
    
    let result: string
    
    if (provider === 'qwen') {
      const messages = this.buildMessages(
        agent,
        apiResult,
        input,
        userName,
        language,
        customPrompt,
        contextCache
      )

      result = await openAiService.chatMessage(
        messages,
        llmModel,
        {
          temperature: temperature || 0.6,
          num_predict: config.default?.numPredict,
        }
      )
    } else {
      result = await ollamaService.naturalize(
        apiResult,
        input.text,
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
    console.log(`[Naturalization] Final response : ${result}`)
    
    return result
  }

  private buildMessages(
    agent: Agent,
    apiResult: unknown,
    input: PipelineInput,
    userName: string,
    language: string,
    customPrompt: string,
    contextCache?: ContextCache
  ): ChatMessage[] {
    const systemMessage = this.buildSystemMessage(customPrompt, language, contextCache)
    const userMessage = this.buildUserMessage(apiResult, input, userName, contextCache)
    const messages: ChatMessage[] = [{ role: 'system', content: systemMessage }]

    messages.push({ role: 'user', content: userMessage })

    return messages
  }

  private buildSystemMessage(
    customPrompt: string,
    language: string,
    contextCache?: ContextCache
  ): string {
    const parts: string[] = [
      customPrompt,
      `Role: Naturalize execution JSON into a clear answer in ${language}.`,
      [
        'Rules:',
        '- Ground answer on latest Data JSON.',
        '- Use working memory/history only to resolve references like "kalau", "yang tadi", "sebelumnya".',
        '- If JSON has location/timezone, treat it as valid data.',
        '- Include downloadUrl only when present; never invent URLs.',
        '- Convert API English terms to target language.',
        '- Hide raw technical errors; explain failure simply.',
        '- If data is truncated, say not all data can be shown.',
        '- Do not offer operational next actions unless Allowed Offer is provided.',
        '- If Allowed Offer is provided, include one concise question using its suggestedText meaning.',
        '- If Allowed Offer is not provided, do not invent specific operational follow-up actions.',
        '- If Data JSON contains memory_recall, answer only from its items/summary.',
        '- If memory_recall.isEmpty=true, say no matching conversation memory was found; do not invent past questions.'
      ].join('\n')
    ].filter(Boolean)

    if (contextCache?.workingMemory) {
      const { activeIntent, activeEntities, activeTool, continuationHints } = contextCache.workingMemory
      parts.push(`Context: ${this.compactJson({
        activeIntent: activeIntent || undefined,
        activeTool: activeTool || undefined,
        activeEntities,
        continuationHints
      }, 900)}`)
    }

    if (contextCache?.previousToolResults) {
      parts.push(`Previous data for context only: ${this.compactJson(contextCache.previousToolResults, 1200)}`)
    }

    if (contextCache?.allowedOffer) {
      parts.push(`Allowed Offer: ${this.compactJson(contextCache.allowedOffer, 500)}`)
    }

    if (contextCache?.recoveryContext) {
      parts.push([
        'Recovery Guard:',
        `- Detected issue: ${contextCache.recoveryContext.detectedIssue || 'none'}.`,
        `- Reason: ${contextCache.recoveryContext.reason || 'none'}.`,
        '- If execution data does not prove success, do not say the action succeeded.',
        '- If recovery is unresolved, explain the specific missing/inconsistent part and ask one focused follow-up question.'
      ].join('\n'))
    }

    const emotionInstruction = emotionToneService.buildSystemInstruction(contextCache?.emotion)
    if (emotionInstruction) {
      parts.push(emotionInstruction)
    }

    return parts.join('\n\n').trim()
  }

  private buildUserMessage(
    apiResult: unknown,
    input: PipelineInput,
    userName: string,
    contextCache?: ContextCache
  ): string {
    const firstName = userName.split(' ')[0]
    const firstNameContext = firstName ? `Nama pengguna: "${firstName}"` : ''
    const previousUserQueries = trimChatHistory(input.chat_history, {
      maxMessages: 3,
      maxLength: 256,
      filterRole: 'user'
    })
      ?.map((item: any) => `- ${item.content}`)
      .join('\n')

    // ✅ CHECK: Is this a data_analyzer result?
    const isAnalysis = this.isAnalysisResult(apiResult);
    
    // ✅ CHECK: Is this a trend_analyzer result?
    const isTrend = this.isTrendAnalysis(apiResult);
    const isMemoryRecall = this.isMemoryRecallResult(apiResult);
    const isUserProfileRecall = this.isUserProfileRecallResult(apiResult);

    let formattingInstructions = '';

    if (isUserProfileRecall) {
      formattingInstructions = `
PENTING: Ini adalah hasil user_profile_recall.

Aturan:
1. Jawab hanya berdasarkan summary dan facts.
2. Jika answerable=false atau facts kosong, katakan data profil tersebut belum ditemukan.
3. Jangan menawarkan "ubah", "perbarui", "gunakan email", "pakai salah satu", atau aksi operasional lain kecuali Allowed Offer tersedia.
4. Jika ada lebih dari satu fakta, tampilkan ringkas dalam daftar.
5. Jangan mengarang profil yang tidak ada di facts.
`;
    } else if (isMemoryRecall) {
      formattingInstructions = `
PENTING: Ini adalah hasil memory_recall.

Aturan:
1. Jawab hanya berdasarkan field summary dan items.
2. Jika isEmpty=true, sampaikan bahwa tidak ada riwayat percakapan yang ditemukan untuk periode/topik tersebut.
3. Jangan mengarang pertanyaan, topik, atau data yang tidak ada di items.
4. Jangan menanyakan "mau saya tampilkan/jalankan" kecuali Allowed Offer tersedia.
5. Buat jawaban singkat dan jelas.
`;
    } else if (isTrend) {
      // ✅ SPECIAL INSTRUCTIONS FOR TREND/COMPARISON RESULTS
      formattingInstructions = `
PENTING: Ini adalah hasil analisa trend/perbandingan. Pertahankan strukturnya:

1. Mulai dengan **Ringkasan** perbandingan
2. Tampilkan **Baseline** dengan label dan nilai (gunakan format: "**Baseline (Label):** nilai")
3. Tampilkan **Comparison** dengan label dan nilai (gunakan format: "**Comparison (Label):** nilai")
4. Tampilkan **Delta** (perubahan absolute dan percentage) dengan header "**Perubahan:**"
5. Tampilkan **Trend** (increasing/decreasing/stable) dengan header "**Trend:**"
6. Tampilkan **Trends** sebagai bullet points dengan header "**Analisa Trend:**"
7. Tampilkan **Rekomendasi** sebagai numbered list dengan header "**Rekomendasi:**"

Gunakan format markdown:
- Tebalkan header section dan label
- Gunakan bullet points untuk trend analysis
- Gunakan numbered lists untuk recommendations
- Sertakan percentage change dan trend direction
- Pertahankan struktur agar mudah dicerna

Jangan ringkas menjadi satu paragraf. Pertahankan sections terpisah dengan jelas.
`;
    } else if (isAnalysis) {
      // ✅ SPECIAL INSTRUCTIONS FOR ANALYSIS RESULTS
      formattingInstructions = `
PENTING: Ini adalah hasil analisa terstruktur. Pertahankan strukturnya:

1. Mulai dengan **Ringkasan** dari summary
2. Tampilkan **insights** sebagai bullet points dengan header "**Wawasan Utama:**"
3. Tampilkan **patterns** sebagai bullet points dengan header "**Pola Terdeteksi:**"
4. Tampilkan **recommendations** sebagai numbered list dengan header "**Rekomendasi:**"
5. Tampilkan **caveats** di akhir jika ada

Gunakan format markdown:
- Tebalkan header section
- Gunakan bullet points untuk lists
- Gunakan numbered lists untuk recommendations
- Pertahankan struktur agar mudah discan

Jangan ringkas menjadi satu paragraf. Pertahankan sections terpisah.
`;
    } else {
      // Generic naturalization
      formattingInstructions = `
Berikan respons yang natural dan conversational.
Fokus untuk menjawab query user secara langsung.
`;
    }

    return `
${firstNameContext}

Percakapan terbaru: "${input.text}"
${previousUserQueries ? `\nPertanyaan user sebelumnya:\n${previousUserQueries}` : ''}
${contextCache?.originalQuery ? `\nOriginal context query: "${contextCache.originalQuery}"` : ''}
${contextCache?.allowedOffer ? `\nAllowed offer to mention: ${JSON.stringify(contextCache.allowedOffer)}` : ''}

${formattingInstructions}

Data JSON:
${this.formatApiResult(apiResult)}`.trim()
  }

  private formatApiResult(apiResult: unknown): string {
    if (!this.isMultiResult(apiResult)) {
      return JSON.stringify(apiResult, null, 2)
    }

    const resultsObj = apiResult as Record<string, unknown>

    return Object.entries(resultsObj)
      .map(([tool, result]) => {
        if (result && typeof result === 'object' && 'error' in result) {
          return `- ${tool}: ERROR - ${(result as any).error}`
        }

        return `- ${tool}: ${JSON.stringify(result, null, 2)}`
      })
      .join('\n\n')
  }

  private isMultiResult(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false

    const obj = result as Record<string, unknown>
    const keys = Object.keys(obj)

    if (keys.length === 0) return false
    if (keys.length === 1) return false

    const singleResultKeys = ['error', 'message', 'data', 'status', 'code', 'result']
    if (keys.every(k => singleResultKeys.includes(k))) return false

    const looksLikeSlugs = keys.every(k => /^[a-z_]+$/.test(k))
    if (looksLikeSlugs) return true

    return keys.length > 3
  }

  private isUserProfileRecallResult(result: unknown): boolean {
    const obj = result as any;
    if (!obj || typeof obj !== 'object') return false;
    if (obj.kind === 'user_profile_recall') return true;
    return Object.values(obj).some((value: any) =>
      value && typeof value === 'object' && value.kind === 'user_profile_recall'
    );
  }

  private tryNaturalizeUserProfileRecall(
    apiResult: unknown,
    input: PipelineInput,
    contextCache?: ContextCache
  ): string | null {
    const result = this.extractUserProfileRecall(apiResult);
    if (!result) return null;

    if (result.answerable === false || !Array.isArray(result.facts) || result.facts.length === 0) {
      return 'Saya belum menemukan data itu di profil Anda. Kalau informasinya ingin disimpan, beri tahu saya dalam bentuk sederhana, misalnya "nama saya ...".';
    }

    const normalizedText = String(input.text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const facts = result.facts;
    const nameFact = facts.find((fact: any) => fact?.key === 'name');

    if (nameFact && /^(siapa\s+(saya|aku)|who\s+am\s+i)$/i.test(normalizedText)) {
      return `Anda adalah ${nameFact.value}. Jika ada informasi lain yang ingin Anda cek, saya siap bantu.`;
    }

    if (facts.length === 1) {
      const fact = facts[0] as any;
      return `${this.profileFactLabel(fact)} Anda adalah ${fact.value}. Jika perlu informasi profil lain, saya siap bantu.`;
    }

    return [
      'Saya menemukan beberapa data profil Anda:',
      '',
      ...facts.map((fact: any, index: number) => `${index + 1}. ${this.profileFactLabel(fact)}: ${fact.value}`),
      '',
      'Jika ada informasi lain yang ingin Anda cek, saya siap bantu.'
    ].join('\n');
  }

  private extractUserProfileRecall(apiResult: unknown): any | null {
    const obj = apiResult as any;
    if (!obj || typeof obj !== 'object') return null;
    if (obj.kind === 'user_profile_recall') return obj;

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && (value as any).kind === 'user_profile_recall') {
        return value;
      }
    }

    return null;
  }

  private profileFactLabel(fact: any): string {
    const key = String(fact?.key || '')
      .replace(/^contact\./, '')
      .replace(/^relationship\./, '')
      .replace(/^preference\./, '')
      .replace(/[._-]+/g, ' ')
      .trim();

    if (!key) return 'Data profil';

    return key
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private compactJson(value: unknown, maxLength: number): string {
    const json = JSON.stringify(value)
    if (!json || json.length <= maxLength) return json || ''
    return `${json.slice(0, Math.max(0, maxLength - 20))}... [truncated]`
  }

  /**
   * Check if result is a data_analyzer analysis result
   */
  private isAnalysisResult(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;

    const analysisResult = result as any;

    // Check for direct analysis structure
    if (
      analysisResult.analysis !== undefined &&
      typeof analysisResult.analysis === 'object' &&
      Array.isArray(analysisResult.analysis.insights) &&
      Array.isArray(analysisResult.analysis.recommendations)
    ) {
      return true;
    }

    // Check for nested data_analyzer structure
    if (
      analysisResult.data_analyzer !== undefined &&
      typeof analysisResult.data_analyzer === 'object' &&
      analysisResult.data_analyzer.analysis !== undefined &&
      Array.isArray(analysisResult.data_analyzer.analysis.insights)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if result is a trend_analyzer comparison result
   */
  private isTrendAnalysis(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;

    const analysisResult = result as any;

    // Check for trend analysis structure (baseline, comparison, delta)
    if (
      analysisResult.analysis?.baseline !== undefined &&
      analysisResult.analysis?.comparison !== undefined &&
      analysisResult.analysis?.delta !== undefined
    ) {
      return true;
    }

    if (
      analysisResult.trend_analyzer?.analysis?.baseline !== undefined &&
      analysisResult.trend_analyzer?.analysis?.comparison !== undefined &&
      analysisResult.trend_analyzer?.analysis?.delta !== undefined
    ) {
      return true;
    }

    return false;
  }

  private isMemoryRecallResult(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false;

    const memoryResult = result as any;
    if (memoryResult.kind === 'memory_recall') return true;

    return (
      memoryResult.memory_recall !== undefined &&
      typeof memoryResult.memory_recall === 'object' &&
      memoryResult.memory_recall.kind === 'memory_recall'
    );
  }
}

export const naturalizationService = new NaturalizationService()


