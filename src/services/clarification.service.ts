import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { Intent, Tool, ToolParam, PipelineInput } from '../types'
import { config } from '../config'

class ClarificationService {

  // =========================================================
  // PRIVATE helper → call small LLM
  // =========================================================
  private async generate(prompt: string, options?: { num_predict?: number }) {
    // Pilih service berdasarkan config.default.provider
    const provider = config.default?.provider || 'ollama'

    if (provider === 'openai') {
      const response = await openAiService.chat(prompt, 
        config.alibaba?.llmModel || "qwen3-8b",
        {
          temperature: 0.4,
          num_predict: options?.num_predict ?? 64,
        }
      )
      return response.trim()
    } else {
      const response = await ollamaService.chat(prompt, 
        config.ollama?.llmModel,
        {
          temperature: 0.4,
          num_predict: options?.num_predict ?? 64,
        }
      )
      return response.trim()
    }
  }

  // =========================================================
  // 1️ Ask for single parameter from a TOOL
  // =========================================================
  async askForParameterFromTool(
    input: PipelineInput,
    tool: Tool,
    paramName: string,
    paramDef?: ToolParam,
    language = 'Indonesia'
  ): Promise<string> {
    const paramDescription = paramDef?.description || paramName
    const userName = input.attributes?.name as string ?? ''
    const firstName = userName.split(' ')[0]
    const userContext = firstName 
    ? `Nama pengguna: "${firstName}"` 
    : '';
    const prompt = `
${userContext}
Kamu sedang membantu user menggunakan tool "${tool.name}".

Tool ini membutuhkan parameter "${paramName}" (${paramDescription}).

Buat 1 pertanyaan singkat dan natural dalam bahasa ${language} 
untuk meminta parameter tersebut.

Aturan Ketat:
1. Jawaban HARUS 1 kalimat pendek saja.
2. Beri sapaan hanya jika ada nama pengguna.
    `.trim()

    return this.generate(prompt)
  }

  // =========================================================
  // 2️ Ask for multiple parameters from MULTIPLE TOOLS
  // =========================================================
  async askForMultipleParametersFromTools(
    input: PipelineInput,
    missingToolsParams: Array<{ tool: Tool; missing: string[] }>,
    language = 'Indonesia'
  ): Promise<string> {
    // Flatten dan deduplicate semua missing params
    const allMissing = missingToolsParams.flatMap(m => m.missing)
    const uniqueMissing = [...new Set(allMissing)]
    
    // Case 1: Hanya 1 parameter yang missing dari 1 tool
    if (uniqueMissing.length === 1 && missingToolsParams.length === 1) {
      const tool = missingToolsParams[0].tool
      const paramName = uniqueMissing[0]
      const paramDef = tool.parameters?.find(p => p.name === paramName)
      
      return this.askForParameterFromTool(input, tool, paramName, paramDef, language)
    }
    
    // Case 2: Multiple parameters dari multiple tools
    const toolsList = missingToolsParams.map(m => m.tool.name).join(' dan ')
    
    const userName = input.attributes?.name as string ?? ''
    const firstName = userName.split(' ')[0]
    const userContext = firstName 
    ? `Nama pengguna: "${firstName}"` 
    : '';
    
    const prompt = `
${userContext}
User perlu memberikan parameter: ${uniqueMissing.join(', ')} 
untuk menjalankan tools: ${toolsList}

Buat 1 pertanyaan singkat dalam bahasa ${language} yang meminta SEMUA parameter di atas sekaligus.
Contoh: "Untuk mengecek cuaca dan waktu, di kota mana dan jam berapa?"

Rules:
- Maksimal 15 kata
- Ramah
- Sapa jika ada nama pengguna dan Langsung ke poin
    `.trim()
    
    return this.generate(prompt, { num_predict: 100 })
  }

  // =========================================================
  // 3 Ambiguous intent clarification
  // =========================================================
  async askForAmbiguousIntent(
    userText: string,
    matches: Array<{ intent: Intent; score: number }>,
    language = 'Indonesia'
  ): Promise<string> {
    const options = matches.slice(0, 3).map((m, i) => `${i + 1}. ${m.intent.name}`).join('\n')
    
    const prompt = `
User bertanya: "${userText}"

Intent yang terdeteksi:
${options}

Buat pertanyaan klarifikasi singkat dalam bahasa ${language} untuk memilih intent mana yang dimaksud user.
Maksimal 1 kalimat.
    `.trim()
    
    return this.generate(prompt, { num_predict: 80 })
  }

  // =========================================================
  // 7️⃣ Hard fallback jika tidak ada intent cocok
  // =========================================================
  fallback(language = 'Indonesia'): string {
    if (language.toLowerCase().includes('english')) {
      return "Sorry, I didn't understand your request. Could you explain it in more detail?"
    }

    return "Maaf, saya belum memahami maksud Anda. Bisa dijelaskan lebih detail?"
  }
}

export const clarificationService = new ClarificationService()