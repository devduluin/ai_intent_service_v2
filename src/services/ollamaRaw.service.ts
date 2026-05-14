import { config } from '../config'

class OllamaService {

  private async post(url: string, body: any) {
    console.log('POST →', url)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Ollama Gateway Error: ${text}`)
    }

    return res.json()
  }

  // =============================
  // EMBEDDING VIA API GATEWAY
  // =============================
  async embed(text: string): Promise<number[]> {
    console.log('Embedding text:', text)
    //add env raw if error
    const res = await this.post(config.ollama.baseUrlRaw+'/embeddings', {
      model: config.ollama.embedModel,
      prompt: text,
    })

    // console.log('EMBED RAW RESPONSE:', JSON.stringify(res, null, 2))

    return res.embedding
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.embed(t)))
  }

  // =============================
  // CHAT VIA API GATEWAY
  // =============================
  async chat(messages: any[]): Promise<string> {
    const res = await this.post(config.ollama.baseUrlRaw+'/chat', {
      model: config.ollama.llmModel,
      messages,
      stream: false,
    })

    return res.message?.content || res.response || ''
  }

  // =============================
  // HEALTH CHECK
  // =============================
  async isHealthy(): Promise<boolean> {
    try {
      await this.embed('health check')
      return true
    } catch {
      return false
    }
  }
}

export const ollamaService = new OllamaService()