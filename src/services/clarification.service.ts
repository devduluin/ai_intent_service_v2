import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { Intent, Tool, ToolParam, PipelineInput, ResourceMissingParams } from '../types'
import type { Agent } from '../types/agent.types'
import { config } from '../config'
import { getDisplayNameFromInput, getFirstName } from '../utils/user-display-name.util'

class ClarificationService {

  // =========================================================
  // PRIVATE helper → call small LLM
  // =========================================================
  private async generate(provider: string, llmModel: string, prompt: string, options?: { num_predict?: number }) {
    // Pilih service berdasarkan config.default.provider
    
    if (provider === 'qwen') {
      const response = await openAiService.chat(provider, llmModel,
         prompt,
        {
          temperature: 0.1,
          num_predict: options?.num_predict ?? 64,
        }
      )
      return response.trim()
    } else {
      const response = await ollamaService.chat(
        provider,
        llmModel,
        prompt,
        {
          temperature: 0.4,
          num_predict: options?.num_predict ?? 64,
        }
      )
      return response.trim()
    }
  }

  private buildTypeHint(paramDef?: ToolParam): string {
    const paramType = paramDef?.type || 'string'

    if (paramType === 'date') {
      return paramDef?.config?.format ? `(format: ${paramDef.config.format})` : '(tanggal)'
    }

    if (paramType === 'email') {
      return '(alamat email)'
    }

    if (paramType === 'phone') {
      return '(nomor telepon)'
    }

    if (paramType === 'select' && paramDef?.config?.options) {
      const options = paramDef.config.options.map(o => o.label).join(' atau ')
      return `(${options})`
    }

    if (paramType === 'boolean') {
      return '(ya atau tidak)'
    }

    if (paramType === 'number') {
      return '(angka)'
    }

    return ''
  }

  private getModel(agent: Agent): { provider: string; llmModel: string } {
    return {
      provider: agent.llmModel?.provider || config.default?.provider || 'ollama',
      llmModel: agent.llmModel?.modelCode || config.ollama?.llmModel
    }
  }

  private getUserContext(input: PipelineInput): string {
    const userName = getDisplayNameFromInput(input)
    const firstName = getFirstName(userName)
    return firstName ? `Nama pengguna: "${firstName}"` : ''
  }

  // =========================================================
  // 1️ Ask for single parameter from a TOOL
  // =========================================================
  async askForParameterFromTool(
    provider: string,
    llmModel: string,
    input: PipelineInput,
    tool: Tool,
    paramName: string,
    paramDef?: ToolParam,
    language = 'Indonesia'
  ): Promise<string> {
    // Use label if available, fallback to name
    const paramLabel = paramDef?.label || paramDef?.name || paramName
    const paramDescription = paramDef?.description || paramName
    const typeHint = this.buildTypeHint(paramDef)
    const userContext = this.getUserContext(input)
    
    const prompt = `
${userContext}
Kamu sedang membantu user menggunakan tool "${tool.name}".

Tool ini membutuhkan parameter "${paramLabel}" ${typeHint} - ${paramDescription}.

Buat 1 pertanyaan singkat dan natural dalam bahasa ${language}
untuk meminta parameter tersebut.

Aturan Ketat:
1. Jawaban HARUS 2 kalimat pendek saja.
2. Beri sapaan hanya jika ada nama pengguna.
    `.trim()



    return this.generate(provider, llmModel, prompt)
  }

  // =========================================================
  // 1.5 Ask for single parameter from any RESOURCE
  // =========================================================
  async askForParameterFromResource(
    provider: string,
    llmModel: string,
    input: PipelineInput,
    resource: ResourceMissingParams,
    paramName: string,
    paramDef?: ToolParam,
    language = 'Indonesia'
  ): Promise<string> {
    const paramLabel = paramDef?.label || paramDef?.name || paramName
    const paramDescription = paramDef?.description || paramName
    const typeHint = this.buildTypeHint(paramDef)
    const userContext = this.getUserContext(input)
    const resourceType = resource.resource === 'skill' ? 'skill internal' : 'tool'
    const resourceName = resource.name || resource.key

    const prompt = `
${userContext}
Kamu sedang membantu user menggunakan ${resourceType} "${resourceName}".

Resource ini membutuhkan parameter "${paramLabel}" ${typeHint} - ${paramDescription}.

Buat 1 pertanyaan singkat dan natural dalam bahasa ${language}
untuk meminta parameter tersebut.

Aturan Ketat:
1. Jawaban HARUS 2 kalimat pendek saja.
2. Beri sapaan hanya jika ada nama pengguna.
    `.trim()

    return this.generate(provider, llmModel, prompt)
  }

  // =========================================================
  // 2️ Ask for multiple parameters from MULTIPLE TOOLS
  // ==============================================;===========
  async askForMultipleParametersFromTools(
    agent: Agent,
    input: PipelineInput,
    missingToolsParams: Array<{ tool: Tool; missing: string[] }>,
    language = 'Indonesia'
  ): Promise<string> {
    const resources: ResourceMissingParams[] = missingToolsParams.map(item => ({
      resource: 'tool',
      key: item.tool.slug,
      name: item.tool.name,
      missing: item.missing,
      params: item.tool.parameters || []
    }))

    return this.askForMultipleParametersFromResources(agent, input, resources, language)
  }

  // =========================================================
  // 2.5 Ask for multiple parameters from TOOL/SKILL resources
  // =========================================================
  async askForMultipleParametersFromResources(
    agent: Agent,
    input: PipelineInput,
    missingResourceParams: ResourceMissingParams[],
    language = 'Indonesia'
  ): Promise<string> {
    // Flatten dan deduplicate semua missing params
    const allMissing = missingResourceParams.flatMap(m => m.missing)
    const uniqueMissing = [...new Set(allMissing)]
    const { provider, llmModel } = this.getModel(agent)
    
    // Case 1: Hanya 1 parameter yang missing dari 1 resource
    if (uniqueMissing.length === 1 && missingResourceParams.length === 1) {
      const resource = missingResourceParams[0]
      const paramName = uniqueMissing[0]
      const paramDef = resource.params?.find(p => p.name === paramName)
      
      return this.askForParameterFromResource(provider, llmModel, input, resource, paramName, paramDef, language)
    }
    
    // Case 2: Multiple parameters dari multiple resources
    const resourcesList = missingResourceParams
      .map(m => `${m.resource === 'skill' ? 'skill' : 'tool'} ${m.name || m.key}`)
      .join(' dan ')
    const paramLabels = uniqueMissing.map(paramName => {
      const resource = missingResourceParams.find(item => item.missing.includes(paramName))
      const paramDef = resource?.params?.find(p => p.name === paramName)
      return paramDef?.label || paramDef?.description || paramName
    })
    const userContext = this.getUserContext(input)
    
    const prompt = `
${userContext}
User perlu memberikan parameter: ${paramLabels.join(', ')} 
untuk menjalankan resource: ${resourcesList}

Buat 2 pertanyaan singkat dalam bahasa ${language} yang meminta SEMUA parameter di atas sekaligus.

Rules:
- Maksimal 15 kata
- Ramah
- Sapa jika ada nama pengguna dan Langsung ke poin
    `.trim()
    
    return this.generate(provider, llmModel, prompt, { num_predict: 100 })
  }

  // =========================================================
  // 3 Ambiguous intent clarification
  // =========================================================
//   async askForAmbiguousPlan(
//     agent: Agent,
//     input: PipelineInput,
//     matches: Array<{ intent: Intent; score: number }>,
//     language = 'Indonesia'
//   ): Promise<string> {
//     const provider = agent.llmModel?.provider || config.default?.provider || 'ollama'

//     const llmModel = agent.llmModel?.modelCode || config.ollama?.llmModel
    
//     const options = matches.slice(0, 3).map((m, i) => `${i + 1}. ${m.intent.name}`).join('\n')
    
//     const prompt = `
// User bertanya: "${input.text}"

// Resources yang terdeteksi:
// ${options}

// Buat pertanyaan klarifikasi singkat dalam bahasa ${language} untuk memilih resources mana yang dimaksud user.
// Maksimal 1 kalimat.
//     `.trim()
    
//     return this.generate(provider, llmModel, prompt, { num_predict: 80 })
//   }

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
