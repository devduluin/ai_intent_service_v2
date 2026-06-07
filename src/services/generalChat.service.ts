import { ollamaService, ChatMessage } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PipelineInput } from '../types'
import { Agent } from '../types/agent.types'
import { config } from '../config'
import { trimChatHistory } from '../utils/trim-chat'
import type { ContextCache } from './cores/stages/types/context-cache'
import { applyGeneralChatGuard, buildProfilePromptSection, buildCudProhibitionPrompt, buildEmotionPromptSection, buildIdentityPromptSection } from '../utils/general-chat-guard.util'
import type { UserProfileContext } from '../types/user-profile.types'
// ============================================================
// TYPES
// ============================================================


// ============================================================
// GENERAL CHAT SERVICE (RAG + HISTORY + MODEFILE SAFE)
// ============================================================

class GeneralChatService {

  async handle(
    input: PipelineInput,
    agent: Agent,
    contextCache?: ContextCache,
    numPredict?: number,
    userProfile?: UserProfileContext
  ): Promise<string> {

    const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'
    const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel
    const temperature = agent.llmModel?.temperature || config.default?.temperature
    const systemPrompt = agent.systemPrompt || config.default?.systemPrompt
    const numPredictFinal = numPredict || config.default?.numPredict

    try {
      // 🔒 CUD ACTION GUARD — block before LLM (0ms latency)
      const guardResponse = applyGeneralChatGuard(input.text, {
        hasPendingConfirmation: !!(contextCache as any)?.hasPendingConfirmation,
        hasPendingSlot: !!(contextCache as any)?.hasPendingSlot,
        hasActiveGodMode: (contextCache as any)?.activeGodMode,
        userProfile,
      });
      if (guardResponse) {
        return guardResponse;
      }

      const guardedResponse = this.buildOperationalDataGuardResponse(input, contextCache)
      if (guardedResponse) {
        return guardedResponse
      }

      const messages = this.buildMessages(input, systemPrompt, contextCache, userProfile)

      let response: string;

      console.log(`[GeneralChat] Sending to ${provider} (${llmModel}) with temperature=${temperature} and num_predict=${numPredictFinal}`);
      console.log('[GeneralChat] Messages:', messages);

      if (provider === 'qwen') {
        response = await openAiService.chatMessage(messages,
          llmModel,
          {
            temperature: temperature,
            num_predict: numPredictFinal,
          }
        )
      } else {
        response = await ollamaService.chatMessage(messages,
          config.ollama.llmModel,
          {
            temperature: temperature,
            num_predict: numPredictFinal,
          }
        )
      }

      // Ensure response is not empty or generic "tidak tahu"
      // With improved system prompt, this should rarely trigger
      if (!response || response.trim().length === 0) {
        response = "Baik, ada yang bisa saya bantu terkait pertanyaan Anda?";
        console.log('[GeneralChat] Empty response detected, using default');
      }

      return response;

    } catch (err) {
      console.error('[GeneralChat] Error:', err)
      return "Baik, ada yang bisa saya bantu? Silakan tanyakan sesuatu."
    }
  }

  // =========================================================
  // 🔥 MESSAGE BUILDER (CORE)
  // =========================================================
  private buildMessages(
    input: PipelineInput,
    systemPrompt?: string,
    contextCache?: ContextCache,
    userProfile?: UserProfileContext
  ): ChatMessage[] {

    const messages: ChatMessage[] = []
    const isOperationalDataQuestion = this.isOperationalDataQuestion(input.text, contextCache)

    // 1 SYSTEM MESSAGE (with context + profile if available)
    const knowledge = this.formatKnowledgeContext(systemPrompt, contextCache, isOperationalDataQuestion, userProfile, input.text)
    if (knowledge) {
      messages.push({
        role: 'system',
        content: knowledge,
      })
    }

    // 2 CHAT HISTORY (role asli)
    const trimmedHistory = trimChatHistory(input.chat_history, {
      maxMessages: isOperationalDataQuestion ? 3 : 3,
      maxLength: 200
    })

    if (trimmedHistory?.length) {
      const historyForPrompt = isOperationalDataQuestion
        ? trimmedHistory.filter((h: any) => h.role === 'user')
        : trimmedHistory

      historyForPrompt.forEach((h: any) => {
        messages.push({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.content,
        })
      })
    }

    // 3 USER MESSAGE TERBARU (clean, no duplication)
    messages.push({
      role: 'user',
      content: input.text,
    })

    return messages
  }

  /**
   * Format system prompt with context cache (if available)
   * Context is ONLY added here (in system message), not in user message
   */
  private formatKnowledgeContext(
    systemPrompt?: string,
    contextCache?: ContextCache,
    isOperationalDataQuestion: boolean = false,
    userProfile?: UserProfileContext,
    userText?: string
  ): string {
    // Start with base system prompt (concise)
    let basePrompt = `

TUGAS:
1. Bantu user dengan ramah dan informatif
2. Gunakan data/konteks yang tersedia jika ada dan relevan
3. Berikan jawaban yang helpful dan actionable
4. Jangan menawarkan aksi operasional seperti "mau saya tampilkan", "mau saya ubah", "mau saya jalankan", atau "mau saya buatkan" kecuali ada instruksi eksplisit dari sistem/tool.
5. Jika user hanya bertanya tentang identitas/arsitektur, jawab pertanyaannya saja tanpa membuat offer lanjutan.

`.trim();

    // ✅ EXISTING: Add context cache info in system message
    if (contextCache?.previousToolResults) {
      const intent = contextCache.previousIntent || 'unknown';
      const data = contextCache.previousToolResults;
      const entities = contextCache.entities || {};

      basePrompt += `

KONTEKS DATA:

Topic: ${intent}
Data Sebelumnya: ${JSON.stringify(data, null, 2)}
${Object.keys(entities).length > 0 ? `Entitas: ${JSON.stringify(entities, null, 2)}` : ''}

GUNAKAN DATA JIKA:
- Menjawab pertanyaan jika relevan
- Memberikan insight atau analisa singkat
- JANGAN ucapkan JSON, bilang saja data tidak tersedia

ATURAN WAJIB:
- Anda bukan eksekutor, katakan "saya tidak bisa menjalankan perintah, tapi saya bisa membantu menjawab pertanyaan terkait data tersebut" jika user meminta eksekusi
- Anda tidak bisa create, update, delete, cancel, action atau modifikasi data apapun
- Dilarang mengarang jawaban

Hint: jika user salah menggunakan command berikut yang benar:
 automation manager, /reminder -> /automation manager
`;
    }

    // ✅ ADD: User profile context
    const profileSection = buildProfilePromptSection(userProfile);
    if (profileSection) {
      basePrompt += profileSection;
    }

    // ✅ ADD: Emotion context (LLM adapts tone naturally)
    if (userText) {
      basePrompt += buildEmotionPromptSection(userText);
    }

    // ✅ ADD: Strict CUD prohibition
    basePrompt += '\n\n' + buildCudProhibitionPrompt();

    // ✅ ADD: VIPER identity (self-knowledge, cached, only for identity questions)
    basePrompt += buildIdentityPromptSection(userText);

    return basePrompt;
  }

  private isIdentityQuestion(text: string): boolean {
    const n = text.toLowerCase().replace(/\s+/g, ' ').trim();
    return (
      /^(siapa|apa)\s+(anda|kamu|viper|ini)$/i.test(n) ||
      /^(kamu|anda)\s+(itu|ini)?\s*(siapa|apa)$/i.test(n) ||
      /^(who are you|what are you|who is this|what is this)$/i.test(n) ||
      /^(apakah\s+)?(anda|kamu)\s+(manusia|robot|ai|bot|asli|program)$/i.test(n) ||
      /^are you (human|real|a robot|ai|a bot)$/i.test(n) ||
      /^(bagaimana|gimana)\s+(anda|kamu|viper)\s+(bekerja|kerja|didesain|dibangun|dibuat|berfungsi|arsitektur|berpikir|berfikir)$/i.test(n) ||
      /^bagaimana\s+cara\s+(anda|kamu|viper)\s+(berpikir|berfikir|bekerja|think|work|reason)$/i.test(n) ||
      /^how (do you work|are you designed|are you built)$/i.test(n) ||
      /^(jelaskan|jelasin|ceritakan)\s+(dirimu|tentang kamu|tentang anda|tentang viper|arsitekturmu|arsitektur anda)$/i.test(n) ||
      /^(explain|describe|tell me about)\s+(yourself|your architecture)$/i.test(n) ||
      /^(kenalan dong|introduce yourself|perkenalkan dirimu|ceritakan tentang dirimu)$/i.test(n)
    );
  }

  private isOperationalDataQuestion(text: string, contextCache?: ContextCache): boolean {
    const normalized = text.toLowerCase()

    // Dynamic: check if working memory has an active tool (most reliable signal)
    const hasActiveOperationalTool = !!contextCache?.workingMemory?.activeTool
    if (hasActiveOperationalTool) return true

    // Dynamic: check if contextCache has previous tool results
    if (contextCache?.previousToolResults) return true

    // Fallback: detect data-related question patterns
    const askPatterns = /\b(cari|apakah ada|siapa|nama|berapa|data|daftar|tampilkan|cek|lihat|sebelumnya|tadi)\b/i
    return askPatterns.test(normalized)
  }

  private buildOperationalDataGuardResponse(
    input: PipelineInput,
    contextCache?: ContextCache
  ): string | null {
    // Skip guard for identity/self-awareness questions
    if (this.isIdentityQuestion(input.text)) return null;

    if (!this.isOperationalDataQuestion(input.text, contextCache)) {
      return null
    }

    const normalized = input.text.toLowerCase()
    const isNameQuestion = /\b(siapa|nama|daftar nama|siapa saja|apakah ada|ada yang)\b/i.test(normalized)
    if (!isNameQuestion) {
      return null
    }

    const data = contextCache?.previousToolResults
    if (this.hasRecordArray(data)) {
      return null
    }

    return 'Saya tidak bisa memastikan nama dari konteks yang tersedia, karena data sebelumnya tidak berisi daftar record/nama yang bisa diverifikasi. Silakan jalankan ulang query datanya agar saya bisa menampilkan nama berdasarkan hasil tool yang valid.'
  }

  private hasRecordArray(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.some(item => item && typeof item === 'object' && !Array.isArray(item))
    }

    if (!value || typeof value !== 'object') {
      return false
    }

    return Object.values(value as Record<string, unknown>).some(item => this.hasRecordArray(item))
  }
}

export const generalChatService = new GeneralChatService()
