/**
 * Token estimation utilities for various LLM models
 * Note: This is an approximation. For precise token counting, use model-specific tokenizers.
 */

export interface TokenEstimationOptions {
  /**
   * Average characters per token (default: 3.5 for mixed language)
   * - English: ~4 chars/token
   * - Indonesian: ~3.5 chars/token
   * - Chinese/Japanese: ~1.5-2 chars/token
   */
  charsPerToken?: number
  
  /**
   * Average tokens per word (default: 1.3)
   */
  tokensPerWord?: number
  
  /**
   * Model type for more accurate estimation
   */
  modelType?: 'openai' | 'claude' | 'llama' | 'alibaba'
}

export class TokenEstimator {
  private static readonly DEFAULT_CHARS_PER_TOKEN = 3.5
  private static readonly DEFAULT_TOKENS_PER_WORD = 1.3
  
  // Model-specific configurations
  private static readonly MODEL_CONFIGS: Record<string, { charsPerToken: number; tokensPerWord: number }> = {
    openai: { charsPerToken: 4, tokensPerWord: 1.3 },
    claude: { charsPerToken: 3.8, tokensPerWord: 1.3 },
    llama: { charsPerToken: 3.5, tokensPerWord: 1.3 },
    alibaba: { charsPerToken: 3.5, tokensPerWord: 1.3 }, // Qwen series
    default: { charsPerToken: 3.5, tokensPerWord: 1.3 }
  }

  /**
   * Estimate tokens from text
   */
  static estimate(text: string, options: TokenEstimationOptions = {}): number {
    if (!text) return 0
    
    const charsPerToken = options.charsPerToken || 
                          (options.modelType ? this.MODEL_CONFIGS[options.modelType]?.charsPerToken : null) ||
                          this.DEFAULT_CHARS_PER_TOKEN
    
    const tokensPerWord = options.tokensPerWord ||
                          (options.modelType ? this.MODEL_CONFIGS[options.modelType]?.tokensPerWord : null) ||
                          this.DEFAULT_TOKENS_PER_WORD
    
    // Method 1: Based on characters
    const tokenEstimateByChar = Math.ceil(text.length / charsPerToken)
    
    // Method 2: Based on words
    const words = text.trim().split(/\s+/).length
    const tokenEstimateByWord = Math.ceil(words * tokensPerWord)
    
    // Method 3: Weighted average (char method more accurate for non-Latin scripts)
   const isLatinScript = /^[A-Za-z\s\d\p{P}]+$/u.test(text)
    const charWeight = isLatinScript ? 0.5 : 0.7
    const wordWeight = 1 - charWeight
    
    const estimatedTokens = Math.ceil(
      (tokenEstimateByChar * charWeight) + (tokenEstimateByWord * wordWeight)
    )
    
    return Math.max(1, estimatedTokens)
  }

  /**
   * Estimate tokens for an array of messages (like OpenAI format)
   */
  static estimateMessages(messages: Array<{ role: string; content: string }>, options?: TokenEstimationOptions): number {
    if (!messages || messages.length === 0) return 0
    
    let totalTokens = 0
    
    for (const message of messages) {
      // Base tokens for message format (role, structure)
      totalTokens += 4 // Approximate overhead per message
      totalTokens += this.estimate(message.content, options)
    }
    
    // Reply overhead for assistant
    totalTokens += 2
    
    return totalTokens
  }

  /**
   * Get detailed token estimation breakdown
   */
  static estimateDetailed(text: string, options?: TokenEstimationOptions): {
    total: number
    byChar: number
    byWord: number
    charCount: number
    wordCount: number
    method: 'weighted'
  } {
    if (!text) {
      return {
        total: 0,
        byChar: 0,
        byWord: 0,
        charCount: 0,
        wordCount: 0,
        method: 'weighted'
      }
    }
    
    const charsPerToken = options?.charsPerToken || this.DEFAULT_CHARS_PER_TOKEN
    const tokensPerWord = options?.tokensPerWord || this.DEFAULT_TOKENS_PER_WORD
    
    const charCount = text.length
    const wordCount = text.trim().split(/\s+/).length
    
    const byChar = Math.ceil(charCount / charsPerToken)
    const byWord = Math.ceil(wordCount * tokensPerWord)
    
    const total = this.estimate(text, options)
    
    return {
      total,
      byChar,
      byWord,
      charCount,
      wordCount,
      method: 'weighted'
    }
  }
}

// Convenience function for quick estimation
export function estimateTokens(text: string, modelType?: 'openai' | 'claude' | 'llama' | 'alibaba'): number {
  return TokenEstimator.estimate(text, { modelType })
}

// Convenience function for messages
export function estimateMessageTokens(
  messages: Array<{ role: string; content: string }>, 
  modelType?: 'openai' | 'claude' | 'llama' | 'alibaba'
): number {
  return TokenEstimator.estimateMessages(messages, { modelType })
}

// Default export
export default TokenEstimator