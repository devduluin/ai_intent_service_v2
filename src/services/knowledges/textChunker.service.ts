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
      let end = start + chunkSize

      // If not at end of text, try to break at newline or space
      if (end < text.length) {
        const after = text.slice(end, end + 50)
        const newlinePos = after.indexOf('\n')
        if (newlinePos >= 0 && newlinePos < 20) {
          end += newlinePos + 1
        } else {
          // Fallback: find last space before chunk boundary
          const before = text.slice(Math.max(0, end - 30), end)
          const lastSpace = before.lastIndexOf(' ')
          if (lastSpace >= 0) {
            end = end - (before.length - lastSpace)
          }
        }
      }

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