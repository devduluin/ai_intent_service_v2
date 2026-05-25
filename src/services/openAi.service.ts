import OpenAI from 'openai'
import { config } from '../config'
import { estimateTokens, estimateMessageTokens, TokenEstimator } from '../utils/token-estimator.utils'

// ============================================================
// Alibaba Model Studio Service — wrapper untuk embed & chat
// ============================================================

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

class OpenAiService {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: config.alibaba.apiKey || process.env.DASHSCOPE_API_KEY,
      baseURL: config.alibaba.baseUrl || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    })
  }

  // Helper method untuk membuat completion dengan handling enable_thinking yang benar
  private async createCompletion(params: {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    enable_thinking?: boolean;
    response_format?: { type: string };
    }) {
    return this.client.chat.completions.create({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.4,
        max_tokens: params.max_tokens ?? 256,
        stream: params.stream ?? false,
        enable_thinking: params.enable_thinking ?? false,
    } as any)
    }

  // ----------------------------------------------------------
  // Generate embedding vector dari teks menggunakan Alibaba
  // NOTE: Alibaba menggunakan model text-embedding-v3 atau text-embedding-v2
  // ----------------------------------------------------------
  async embed(text: string): Promise<number[]> {
    try {
      const response = await this.client.embeddings.create({
        model: config.alibaba.embedModel || "text-embedding-v3",
        input: text,
        // encoding_format: "float",
      })
      
      return response.data[0].embedding as number[]
    } catch (error) {
      console.error('[Alibaba] Embedding error:', error)
      throw error
    }
  }

  // ----------------------------------------------------------
  // Embed banyak teks sekaligus (untuk indexing intent)
  // ----------------------------------------------------------
  async embedBatch(texts: string[]): Promise<number[][]> {
    const embeddings = await Promise.all(texts.map((t) => this.embed(t)))
    return embeddings
  }

  // ----------------------------------------------------------
  // Naturalisasi JSON result dari API jadi kalimat manusia
  // ----------------------------------------------------------
  async naturalize(
    apiResult: unknown,
    originalQuery: string,
    userName: string,
    language = 'Indonesia',
    systemPrompt: string,

    llmModel: string,
    options: { temperature?: number; num_predict?: number } = {}
  ): Promise<string> {

    // ⏱️ start timer
    const start = Date.now()

    const isMultiResult = this.isMultiResult(apiResult)
    const firstName = userName.split(' ')[0]
    const firstNameContext = firstName
      ? `Nama pengguna: "${firstName}"`
      : '';

    // Build system message (role: 'system')
    const systemMessage = `${systemPrompt}

Role: Natural language generator yang mengubah hasil handler/tools/knowledge execution menjadi jawaban yang mudah dimengerti oleh manusia.

Guidelines:
- Gunakan data JSON sebagai referensi untuk menjawab dengan natural dalam bahasa ${language}.
- Jika ADA hasil generator lampirkan downloadUrl agar user bisa langsung mengunduh hasilnya.
- Jangan mengarang url jika tidak ada.
- Jika data JSON berisi pesan error jangan berikan pesan error, cukup berikan pesan yang mudah dimengerti.
- Jika data api berisi bahasa inggris, ubah ke bahasa ${language}.
- Tawarkan bantuan lain jika bentuknya pertanyaan.`.trim()

    // Build user message (role: 'user')
    let userMessage: string

    if (isMultiResult) {
      // Multi-result: ada beberapa tool/knowledge yang dijalankan
      const resultsObj = apiResult as Record<string, unknown>

      const resultsList = Object.entries(resultsObj)
        .map(([tool, result]) => {
          // Handle nested error
          if (result && typeof result === 'object' && 'error' in result) {
            return `- ${tool}: ERROR - ${(result as any).error}`
          }
          return `- ${tool}: ${JSON.stringify(result)}`
        })
        .join('\n\n')

      userMessage = `
${firstNameContext}

Percakapan:
"${originalQuery}"

Data JSON:
${resultsList}`.trim()

    } else {
      // Single result: hanya satu API/tool yang dijalankan
      userMessage = `
${firstNameContext}

Percakapan: "${originalQuery}"

Data JSON:
${JSON.stringify(apiResult, null, 2)}`.trim()
    }

    // Separate system and user messages for better role separation
    const messages = [
      { role: 'system' as const, content: systemMessage },
      { role: 'user' as const, content: userMessage }
    ]

    console.log(`[Alibaba naturalize] System message length: ${systemMessage.length} chars`)
    console.log(`[Alibaba naturalize] User message length: ${userMessage.length} chars`)

    const completion = await this.createCompletion({
      model: llmModel,
      messages: messages,
      temperature: options.temperature ?? 0.6,
      max_tokens: options.num_predict ?? 512,
    })

    const duration = Date.now() - start
    const totalMessageLength = systemMessage.length + userMessage.length
    const estimatedPromptTokens = estimateTokens(systemMessage + userMessage, 'alibaba')
    const estimatedresponseTokens = estimateTokens(completion.choices[0]?.message?.content || '', 'alibaba')
    // const detailedEstimate = TokenEstimator.estimateDetailed(prompt, { modelType: 'alibaba' })

    console.log(`[Alibaba naturalize] Total message length: ${totalMessageLength} chars`)
    console.log(`[Alibaba naturalize] Estimated prompt tokens: ${estimatedPromptTokens}`)
    console.log(`[Alibaba naturalize] Estimated response tokens: ${estimatedresponseTokens}`)
    // console.log(`[Alibaba naturalize] Token details:`, detailedEstimate)

    console.log(`[Alibaba naturalize] with model ${llmModel} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return completion.choices[0]?.message?.content || ''
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

  // ----------------------------------------------------------
  // Extract parameter dari user input berdasarkan prompt
  // Returns: { value: unknown, confidence: number }
  // ----------------------------------------------------------
  async extractParam(
    userInput: string,
    paramDescription: string,
    paramType: string,
    defaultValue: any,
  ): Promise<{ value: unknown; confidence: number }> {
    const prompt = `
Tugas: Ekstrak nilai untuk parameter "${paramDescription}" dari input pengguna.

Input Pengguna: "${userInput}"

Tipe Target: ${paramType}

Instruksi:
1. Ekstrak nilai yang relevan untuk "${paramDescription}" dari input pengguna.
2. Berikan confidence score (0.0 - 1.0) yang menunjukkan seberapa yakin Anda bahwa nilai tersebut benar-benar disebutkan oleh pengguna.
3. Confidence tinggi (0.8-1.0): Nilai disebutkan secara eksplisit dan jelas.
4. Confidence sedang (0.5-0.7): Nilai dapat disimpulkan tetapi tidak eksplisit.
5. Confidence rendah (0.0-0.4): Nilai tidak ditemukan atau sangat tidak jelas.

Format output JSON (HANYA JSON, tidak ada teks lain):
{
  "value": <nilai yang diekstrak, atau null jika tidak ada>,
  "confidence": <angka 0.0 sampai 1.0>
}

Contoh:
- Input: "Saya ingin ke Bandung besok" untuk parameter "kota" -> {"value": "Bandung", "confidence": 0.95}
- Input: "Saya ingin pergi besok" untuk parameter "kota" -> {"value": null, "confidence": 0.1}
- Input: "Mungkin sekitar Jakarta" untuk parameter "kota" -> {"value": "Jakarta", "confidence": 0.6}

Output:`.trim()

    console.log(`[Extract parameter] Prompt for "${paramDescription}": ${prompt}`)
    const response = await this.generateJson(prompt)

    console.log(`[Extract parameter] Raw JSON response: ${response}`)

    try {
      const parsed = JSON.parse(response)
      let rawValue = parsed.value

      // Confidence dari response
      let confidence = typeof parsed.confidence === 'number' 
        ? Math.max(0, Math.min(1, parsed.confidence)) 
        : 0.5

      console.log(`[Extract parameter] Parsed value: ${rawValue}, confidence: ${confidence}`)

      // Handle null/low confidence
      if (rawValue === null || rawValue === undefined || rawValue === '') {
        confidence = Math.min(confidence, 0.3) // Cap confidence for null values
        return { value: null, confidence }
      }

      // Clean string value
      if (typeof rawValue === 'string') {
        rawValue = rawValue.replace(/^['"]|['"]$/g, '').trim()
        if (rawValue.endsWith('.')) {
          rawValue = rawValue.slice(0, -1)
        }
        if (rawValue.toLowerCase() === 'null' || rawValue === '') {
          return { value: null, confidence: Math.min(confidence, 0.3) }
        }
      }

      return { value: rawValue, confidence }
    } catch (error) {
      console.error(`[Extract parameter] JSON parse error for "${paramDescription}":`, error)
      return { value: null, confidence: 0.2 }
    }
  }

  // ===========================================================
  // Generic chat helper (dipakai banyak service)
  // ===========================================================
  async chat(
    provider: string,
    llmModel: string,
    prompt: string,
    options: { temperature?: number; num_predict?: number } = {}
  ): Promise<string> {

    const start = Date.now()
    
    const completion = await this.createCompletion({
      model: llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.num_predict ?? 128,
    })

    const duration = Date.now() - start
    const estimatedPromptTokens = estimateTokens(prompt, 'alibaba')
    const estimatedresponseTokens = estimateTokens(completion.choices[0]?.message?.content?.trim() || '', 'alibaba')

    
    console.log(`[Chat] Estimated prompt tokens: ${estimatedPromptTokens}`)
    console.log(`[Chat] Estimated response tokens: ${estimatedresponseTokens}`)
    console.log(`[Chat Alibaba] ${llmModel} with options ${JSON.stringify(options)} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return completion.choices[0]?.message?.content?.trim() || ''
  }

  // ===========================================================
  // NEW: MESSAGE-BASED CHAT (FOR RAG / AGENT)
  // ===========================================================
  async chatMessage(
    messages: ChatMessage[],
    llmModel: string = config.alibaba.llmModel || "qwen3-8b",
    options: { temperature?: number; num_predict?: number } = {}
  ): Promise<string> {
   
    const start = Date.now()

    const completion = await this.createCompletion({
      model: llmModel,
      messages: messages,
      temperature: options.temperature ?? 0.5,
      max_tokens: options.num_predict ?? 512,
    })

    const duration = Date.now() - start
    const estimatedPromptTokens = estimateMessageTokens(messages, 'alibaba')
    const estimatedresponseTokens = estimateTokens(completion.choices[0]?.message?.content?.trim() || '', 'alibaba')

    
    console.log(`[Message] Estimated prompt tokens: ${estimatedPromptTokens}`)
    console.log(`[Message] Estimated response tokens: ${estimatedresponseTokens}`)
    
    console.log(`[Message] ${llmModel} with options ${JSON.stringify(options)} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return completion.choices[0]?.message?.content?.trim() || ''
  }

  // ===========================================================
  // STRICT JSON GENERATOR (FOR PLANNER / EXTRACTOR / CLASSIFIER)
  // ===========================================================
  async generateJson(prompt: string, options: { temperature?: number; num_predict?: number } = {}): Promise<string> {
    console.log(`[Alibaba model generateJson]:`, config.alibaba.llmModel)
    const start = Date.now()

    const response = await this.createCompletion({
      model: config.alibaba.llmModel || "qwen3-8b",
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature ?? 0,
      response_format: { type: 'json_object' },
      max_tokens: options.num_predict ?? 120,
    })

    const duration = Date.now() - start
    const estimatedPromptTokens = estimateTokens(prompt, 'alibaba')
    const estimatedresponseTokens = estimateTokens(response.choices[0]?.message?.content?.trim() || '', 'alibaba')
    // const detailedEstimate = TokenEstimator.estimateDetailed(prompt, { modelType: 'alibaba' })

    
    console.log(`[Planner] Estimated prompt tokens: ${estimatedPromptTokens}`)
    console.log(`[Planner] Estimated response tokens: ${estimatedresponseTokens}`)
    console.log(`[Planner] response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)
    
    const text = response.choices[0]?.message?.content?.trim() || '{}'

    return this.repairJson(text)
  }

  // ===========================================================
  // AUTO JSON REPAIR (very important for local LLM)
  // ===========================================================
  private repairJson(text: string): string {
    try {
      JSON.parse(text)
      return text
    } catch {}

    text = text.replace(/```json/g, '').replace(/```/g, '').trim()

    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        JSON.parse(match[0])
        return match[0]
      } catch {}
    }

    return "{}"
  }

  // ----------------------------------------------------------
  // Health check — pastikan Alibaba API bisa diakses
  // ----------------------------------------------------------
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.models.list()
      return true
    } catch (error) {
      console.error('[Alibaba] Health check failed:', error)
      return false
    }
  }
}

export const openAiService = new OpenAiService()