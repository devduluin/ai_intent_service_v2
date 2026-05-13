// services/textChunker.service.ts
export interface TextChunk {
  content: string
  tokenCount: number
}

class TextChunkerService {

  private estimateTokens(text: string): number {
    // approx 1 token ≈ 4 chars (cukup untuk RAG)
    return Math.ceil(text.length / 4)
  }

  split(text: string, chunkSize = 500, overlap = 80): TextChunk[] {
    const chunks: TextChunk[] = []
    let start = 0

    while (start < text.length) {
      const end = start + chunkSize
      const slice = text.slice(start, end)

      chunks.push({
        content: slice.trim(),
        tokenCount: this.estimateTokens(slice),
      })

      start += chunkSize - overlap
    }

    return chunks
  }
}

export const textChunkerService = new TextChunkerService()