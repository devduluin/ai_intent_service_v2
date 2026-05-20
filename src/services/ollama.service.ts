import { Ollama } from 'ollama'
import { config } from '../config'

// ============================================================
// Ollama Service — wrapper untuk embed & chat
// ============================================================

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

class OllamaService {
  private client: Ollama

  constructor() {
    this.client = new Ollama({ host: config.ollama.baseUrl })
  }

  // ----------------------------------------------------------
  // Generate embedding vector dari teks menggunakan Nomic
  // ----------------------------------------------------------
  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings({
      model: config.ollama.embedModel,
      prompt: text,
    })
    return response.embedding
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
    llmModel = config.ollama.llmModel,
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
      ? '\nPENTING: HANYA gunakan data JSON di atas. JANGAN tambahkan informasi dari luar.\n'
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

    console.log(`[Ollama prompt]:`, prompt)
    const response = await this.client.chat({
      model: llmModel,
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: options.temperature ?? 0.4,   // rendah agar konsisten
        num_predict: options.num_predict ?? 256,   // batasi output agar cepat
      },
    })

    const duration = Date.now() - start
    console.log(`[Planner] ${llmModel} with options ${JSON.stringify(options)} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return response.message.content
  }

  private isMultiResult(result: unknown): boolean {
    if (!result || typeof result !== 'object') return false
    
    // Check if it looks like { toolSlug: result, toolSlug2: result }
    // Multi-result biasanya punya keys yang semuanya string & values yang bervariasi
    const obj = result as Record<string, unknown>
    const keys = Object.keys(obj)
    
    if (keys.length === 0) return false
    
    // Jika hanya 1 key, anggap single result
    if (keys.length === 1) return false
    
    // Deteksi: jika ada key seperti 'error', 'message', 'data' → mungkin single result terstruktur
    const singleResultKeys = ['error', 'message', 'data', 'status', 'code', 'result']
    if (keys.every(k => singleResultKeys.includes(k))) return false
    
    // Deteksi: jika keys terlihat seperti intent slugs (underscore, lowercase)
    const looksLikeSlugs = keys.every(k => /^[a-z_]+$/.test(k))
    if (looksLikeSlugs) return true
    
    // Default: jika lebih dari 3 keys, anggap multi
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

  // console.log(`[Ollama] Extracting param "${paramDescription}" with prompt:`, prompt)

    const response = await this.client.chat({
      model: config.ollama.naturalModel,
      messages: [{ role: 'user', content: prompt }],
      options: { 
        temperature: 0, 
        num_predict: 30 
      },
    })

    let raw = response.message.content.trim();
    
    // Membersihkan karakter yang sering ikut muncul
    raw = raw.replace(/['"]+/g, '').trim();

    // Jika ingin menghapus titik di akhir kalimat saja (bukan di tengah)
    if (raw.endsWith('.')) {
      raw = raw.slice(0, -1);
    }

    // console.log(`[Ollama] Raw output for ${paramDescription}: "${raw}"`);

    // Validasi hasil
    if (raw.toLowerCase() === 'null' || raw === '') {
      // Gunakan defaultValue jika tersedia (bukan undefined/null)
      if (defaultValue !== undefined && defaultValue !== null) {
        console.log(`[Ollama] Using defaultValue for "${paramDescription}":`, defaultValue);
        // return defaultValue;
      }
      return null;
    }

    return raw;
  }

  // ===========================================================
  // Generic chat helper (dipakai banyak service)
  // ===========================================================
  async chat(
    prompt: string,
    llmModel: string = config.ollama.llmModel,
    options: { temperature?: number; num_predict?: number } = {}
  ): Promise<string> {
    console.log(`[Ollama] Chatting with prompt:`, prompt)
    // ⏱️ start timer
    const start = Date.now()
    const response = await this.client.chat({
      model: llmModel,
      messages: [{ role: 'user', content: prompt }],
      options: {
        temperature: options.temperature ?? 0.4,
        num_predict: options.num_predict ?? 128,
      },
    })

    const duration = Date.now() - start
    console.log(`[Chat Ollama] ${llmModel} with options ${JSON.stringify(options)} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return response.message.content.trim()
  }

  // ===========================================================
  // NEW: MESSAGE-BASED CHAT (FOR RAG / AGENT / MODFILE)
  // ===========================================================
  async chatMessage(
    messages: ChatMessage[],
    llmModel: string = config.ollama.llmModel,
    options: { temperature?: number; num_predict?: number } = {}
  ): Promise<string> {
   
    // ⏱️ start timer
    const start = Date.now()

    const response = await this.client.chat({
      model: llmModel,
      messages,
      options: {
        temperature: options.temperature ?? 0.5,
        num_predict: options.num_predict ?? 512,
      },
    })

    const duration = Date.now() - start
    console.log(`[Planner] ${llmModel} with options ${JSON.stringify(options)} response time: ${duration} ms (${(duration/1000).toFixed(2)} s)`)

    return response.message.content.trim()
  }

  // ===========================================================
  // STRICT JSON GENERATOR (FOR PLANNER / EXTRACTOR / CLASSIFIER)
  // ===========================================================
  async generateJson(prompt: string): Promise<string> {
     console.log(`[Ollama model generateJson]:`, config.ollama.llmModel)
    const response = await this.client.chat({
      model: config.ollama.llmModel,
      messages: [
        { role: 'user', content: `Return JSON only:\n${prompt}` },
      ],
      options: {
        temperature: 0,
        num_predict: 64,
      },
    })

    const text = response.message.content.trim()

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

    // remove markdown fences
    text = text.replace(/```json/g, '').replace(/```/g, '').trim()

    // extract first json block
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      return match[0]
    }

    return "{}"
  }

  // ----------------------------------------------------------
  // Health check — pastikan Ollama bisa diakses
  // ----------------------------------------------------------
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.list()
      return true
    } catch {
      return false
    }
  }
}

export const ollamaService = new OllamaService()
