import OpenAI from 'openai'
import { config } from '../config'

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
        encoding_format: "float",
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
    llmModel = config.alibaba.naturalModel || "qwen3-8b",
    options: { temperature?: number; num_predict?: number } = {},
    appName?: string
  ): Promise<string> {
    
    // ⏱️ start timer
    const start = Date.now()

    const isMultiResult = this.isMultiResult(apiResult)
    let prompt: string
    const firstName = userName.split(' ')[0]
    const userContext = firstName 
      ? `Nama pengguna: "${firstName}"` 
      : '';

    const strictRule = appName === 'hris_company'
      ? '\nPENTING: HANYA gunakan data JSON di atas. JANGAN tambahkan informasi dari luar.\nJika Data JSON mengandung LINK/URL → WAJIB sertakan URL tersebut PERSIS seperti di data (jangan diubah, dipotong, atau ditambahi).\n'
      : '';
    
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
      
      prompt = `
Kamu adalah asisten yang mengubah data JSON menjadi kalimat.
${userContext}
Pengguna Bertanya: "${originalQuery}"

Hasil JSON beberapa Tools/Knowledge:
${resultsList}

Tugas: Gunakan data JSON diatas sebagai referensi untuk menjawab dengan natural dalam bahasa ${language}.
Langsung jawab dengan kalimat yang ramah dan informatif.${strictRule}
`.trim()
      
    } else {
      // Single result: hanya satu API/tool yang dijalankan
      prompt = `
Kamu adalah asisten yang mengubah data JSON menjadi kalimat.
${userContext}
Pengguna Bertanya: "${originalQuery}"

Data JSON:
${JSON.stringify(apiResult, null, 2)}

Tugas: Gunakan data JSON sebagai referensi untuk menjawab dengan natural dalam bahasa ${language}.
Jika data api berisi bahasa inggris, ubah ke bahasa ${language}.
Langsung jawab dengan kalimat yang ramah dan informatif.
Tawarkan bantuan lain jika perlu.${strictRule}
`.trim()
    }

    console.log(`[Alibaba naturalize] prompt: ${prompt}`)

    const completion = await this.createCompletion({
      model: llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.6,
      max_tokens: options.num_predict ?? 512,
    })

    const duration = Date.now() - start
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
  // ----------------------------------------------------------
  async extractParam(
    userInput: string,
    paramDescription: string,
    paramType: string,
    defaultValue: any,
  ): Promise<unknown> {
    const prompt = `
Tugas: Ambil nilai untuk "${paramDescription}" dari input pengguna di bawah ini.
Input dari Pengguna: "${userInput}"
Tipe Target: ${paramType}

Aturan Ketat:
1. Kembalikan HANYA nilai aslinya saja.
2. Jika informasi "${paramDescription}" TIDAK ADA dalam input pengguna, jawab dengan kata "null".
3. Jangan berikan penjelasan, jangan berikan contoh tambahan.
4. Jangan gunakan tanda baca atau karakter tambahan.
5. JANGAN menebak atau menggunakan nilai default jika tidak disebutkan secara eksplisit.

Nilai:`.trim()

    const response = await this.createCompletion({
      model: config.alibaba.naturalModel || "qwen3-8b",
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 60,
    })

    let raw = response.choices[0]?.message?.content?.trim() || '';
    
    raw = raw.replace(/^['"]|['"]$/g, '').trim();

    if (raw.endsWith('.')) {
      raw = raw.slice(0, -1);
    }

    if (raw.toLowerCase() === 'null' || raw === '') {
    //   if (defaultValue !== undefined && defaultValue !== null) {
    //     console.log(`[Alibaba] Using defaultValue for "${paramDescription}":`, defaultValue);
    //     return defaultValue;
    //   }
      return null;
    }

    return raw;
  }

  // ===========================================================
  // Generic chat helper (dipakai banyak service)
  // ===========================================================
  async chat(
    prompt: string,
    llmModel: string = config.alibaba.llmModel || "qwen3-8b",
    options: { temperature?: number; num_predict?: number } = {}
  ): Promise<string> {
    console.log(`[Alibaba] Chatting with prompt length:`, prompt.length)
    const start = Date.now()
    
    const completion = await this.createCompletion({
      model: llmModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.num_predict ?? 128,
    })

    const duration = Date.now() - start
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
    console.log(`[Planner] ${llmModel} with options ${JSON.stringify(options)} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return completion.choices[0]?.message?.content?.trim() || ''
  }

  // ===========================================================
  // STRICT JSON GENERATOR (FOR PLANNER / EXTRACTOR / CLASSIFIER)
  // ===========================================================
  async generateJson(prompt: string): Promise<string> {
    console.log(`[Alibaba model generateJson]:`, config.alibaba.llmModel)
    
    const response = await this.createCompletion({
      model: config.alibaba.llmModel || "qwen3-8b",
      messages: [
        { role: 'user', content: `Return JSON only:\n${prompt}` },
      ],
      temperature: 0,
      max_tokens: 64,
    })
    
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