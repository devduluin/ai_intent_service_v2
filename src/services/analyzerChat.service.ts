// ============================================================
// Analyzer Chat Service - LLM-Powered Data Analysis
// ============================================================
// Provides intelligent data analysis with insights and recommendations
// Uses LLM for pattern recognition and actionable insights
// ============================================================

import { ollamaService, ChatMessage } from './ollama.service';
import { openAiService } from './openAi.service';
import { config } from '../config';
import { appLogger } from '../utils/logger.util';
import { withTimeout } from '../utils/async-helpers.util';

// ============================================================
// Types
// ============================================================

export interface AnalysisContext {
  userQuery?: string;
  language?: string;  // 'id' or 'en'
  intent?: string;
  appName?: string;
}

export interface AnalysisResult {
  summary: string;
  insights: string[];
  patterns?: string[];
  recommendations: string[];
  caveats?: string[];
  metadata: {
    analyzedAt: string;
    dataPoints: number;
    language: string;
    confidence: number;
  };
}

// ============================================================
// Analysis Prompt Template
// ============================================================

const ANALYSIS_SYSTEM_PROMPT = `Anda adalah asisten analis data profesional dengan keahlian dalam:
1. Interpretasi data bisnis dan operasional
2. Identifikasi pola dan tren
3. Memberikan rekomendasi yang actionable

TUGAS ANDA:
- Analisa data yang diberikan dengan teliti
- Identifikasi insight yang bernilai dan dapat ditindaklanjuti
- Fokus pada hal yang paling penting (prioritas)

FORMAT RESPON:
{
  "summary": "Ringkasan singkat 2-3 kalimat",
  "insights": [
    "Insight utama 1",
    "Insight utama 2",
  ],
  "patterns": [
    "Pola atau tren yang terlihat"
  ],
  "recommendations": [
    "Rekomendasi 1",
    "Rekomendasi 2"
  ],
  "caveats": [
    "Keterbatasan atau pertimbangan"
  ]
}

PENTING:
- RESPOND ONLY DENGAN JSON VALID (tanpa markdown, tanpa teks tambahan)
- Semua field usahakan ada (summary, insights, recommendations)
- Jangan mengarang data yang tidak ada
- Jika data tidak cukup, katakan dengan jelas di summary
- Prioritaskan insight yang paling berdampak
- Gunakan bahasa Indonesia yang baik dan profesional
`;

// ============================================================
// Analyzer Chat Service
// ============================================================

class AnalyzerChatService {

  /**
   * Analyze data and provide insights
   *
   * @param data - Data to analyze (any format)
   * @param context - Analysis context (query, language, intent)
   * @returns Structured analysis result with insights and recommendations
   */
  async analyze(
    data: unknown,
    context?: AnalysisContext
  ): Promise<AnalysisResult> {
    const start = Date.now();

    try {
      appLogger.info('[AnalyzerChat] Starting analysis', {
        dataType: typeof data,
        dataKeys: this.getDataKeys(data),
        language: context?.language || 'id',
        intent: context?.intent
      });

      // Build LLM prompt
      const prompt = this.buildAnalysisPrompt(data, context || {});

      // Get LLM response
      const llmResponse = await this.getLLMResponse(prompt, context?.language);

      // Parse LLM response into structured format
      const analysisResult = this.parseAnalysisResponse(llmResponse, data);

      // Add metadata
      analysisResult.metadata = {
        analyzedAt: new Date().toISOString(),
        dataPoints: this.countDataPoints(data),
        language: context?.language || 'id',
        confidence: this.calculateConfidence(analysisResult)
      };

      const duration = Date.now() - start;
      appLogger.info('[AnalyzerChat] Analysis completed', {
        duration,
        insightsCount: analysisResult.insights.length,
        recommendationsCount: analysisResult.recommendations.length,
        confidence: analysisResult.metadata.confidence
      });

      return analysisResult;

    } catch (error) {
      appLogger.error('[AnalyzerChat] Analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        dataType: typeof data
      });

      // Return basic analysis on error
      return this.getFallbackAnalysis(data, context);
    }
  }

  /**
   * Build prompt for LLM analysis
   * NOTE: System prompt already contains JSON format instructions
   */
  private buildAnalysisPrompt(
    data: unknown,
    context: AnalysisContext
  ): string {
    const language = context.language === 'id' ? 'Indonesia' : 'English';
    const userQuery = context.userQuery || 'Analisa data ini';
    const intent = context.intent || 'unknown';

    // Prepare data for LLM (limit size to avoid token limits)
    const dataString = this.prepareDataForLLM(data);

    // ✅ NO SYSTEM PROMPT HERE (already in system role with JSON format)
    return `
DATA YANG DIANALISA:
${dataString}

---

KONTEKS:
- Pertanyaan User: "${userQuery}"
- Intent Asli: ${intent}
- Bahasa: ${language}

---

Silakan berikan analisa Anda dalam format JSON.
`.trim();
  }

  /**
   * Prepare data for LLM (truncate if too large)
   */
  private prepareDataForLLM(data: unknown, maxChars: number = 5000): string {
    let dataString = JSON.stringify(data, null, 2);

    if (dataString.length > maxChars) {
      // Truncate and add note
      dataString = dataString.substring(0, maxChars) + '\n... [data truncated due to size]';
    }

    return dataString;
  }

  /**
   * Get response from LLM using generateJson for STRUCTURED output
   * Includes timeout protection
   */
  private async getLLMResponse(
    prompt: string,
    language: string = 'id'
  ): Promise<string> {
    const provider = config.default?.provider || 'ollama';
    const llmModel = provider === 'qwen'
      ? config.alibaba?.llmModel
      : config.ollama?.llmModel;

    try {
      // ✅ USE generateJson FOR STRUCTURED OUTPUT (Qwen only)
      if (provider === 'qwen') {
        // Combine system prompt + user prompt into single prompt
        const fullPrompt = `${ANALYSIS_SYSTEM_PROMPT}\n\n${prompt}`;
        
        // ✅ Add timeout protection (12s)
        return await withTimeout(
          openAiService.generateJson(
            fullPrompt,  // ✅ Single prompt string (not messages array)
            {
              temperature: 0.7,
              num_predict: 2500
            }
          ),
          12000,  // 12 second timeout
          'analyzerChat.generateJson'
        );
      } else {
        // Fallback to chatMessage for Ollama (doesn't support generateJson)
        const messages: ChatMessage[] = [
          { role: 'system' as const, content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user' as const, content: prompt }
        ];
        
        return await ollamaService.chatMessage(messages, llmModel, {
          temperature: 0.7,
          num_predict: 2048
        });
      }
    } catch (error) {
      appLogger.error('[AnalyzerChat] LLM call failed', {
        provider,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Parse LLM response into structured AnalysisResult
   * Handles both JSON (from generateJson) and markdown (from chatMessage)
   */
  private parseAnalysisResponse(
    llmResponse: string,
    data: unknown
  ): AnalysisResult {
    const result: AnalysisResult = {
      summary: '',
      insights: [],
      patterns: [],
      recommendations: [],
      caveats: [],
      metadata: {
        analyzedAt: new Date().toISOString(),
        dataPoints: this.countDataPoints(data),
        language: 'id',
        confidence: 0.8
      }
    };

    // ✅ TRY 1: Parse as JSON first (from generateJson)
    try {
      const jsonResponse = JSON.parse(llmResponse);
      
      if (jsonResponse.summary && Array.isArray(jsonResponse.insights)) {
        appLogger.debug('[AnalyzerChat] Parsed JSON response successfully');
        
        result.summary = String(jsonResponse.summary || '');
        result.insights = Array.isArray(jsonResponse.insights) ? jsonResponse.insights : [];
        result.patterns = Array.isArray(jsonResponse.patterns) ? jsonResponse.patterns : [];
        result.recommendations = Array.isArray(jsonResponse.recommendations) ? jsonResponse.recommendations : [];
        result.caveats = Array.isArray(jsonResponse.caveats) ? jsonResponse.caveats : [];
        
        // ✅ VALIDATE: Ensure we have meaningful content
        if (result.summary.length > 10 && result.insights.length > 0) {
          return result;  // ✅ JSON parsing successful
        }
      }
    } catch (jsonError) {
      appLogger.debug('[AnalyzerChat] JSON parse failed, trying markdown parsing');
      // Continue to markdown parsing
    }

    // ✅ TRY 2: Parse as markdown (fallback for chatMessage)
    const sections = this.extractSections(llmResponse);

    // Extract summary
    result.summary = sections.summary || this.extractSummary(llmResponse);

    // ✅ CLEAN: Remove markdown artifacts from summary
    result.summary = this.cleanMarkdown(result.summary);

    // Extract insights
    result.insights = sections.insights || this.extractBulletPoints(llmResponse, 'insight');

    // Extract patterns
    result.patterns = sections.patterns || this.extractBulletPoints(llmResponse, 'pattern');

    // Extract recommendations
    result.recommendations = sections.recommendations ||
                            this.extractBulletPoints(llmResponse, 'recommendation');

    // Extract caveats
    result.caveats = sections.caveats || this.extractBulletPoints(llmResponse, 'caveat');

    // ✅ VALIDATE: Reject headers-only or malformed content
    if (result.insights.length === 0 ||
        (result.insights.length > 0 && result.insights[0]?.startsWith('###'))) {
      appLogger.warn('[AnalyzerChat] Parsing failed - headers only or malformed, using fallback');
      return this.getFallbackAnalysis(data);
    }

    // ✅ VALIDATE: Clean markdown from all fields
    result.patterns = result.patterns?.map(p => this.cleanMarkdown(p));
    result.recommendations = result.recommendations?.map(r => this.cleanMarkdown(r));
    result.caveats = result.caveats?.map(c => this.cleanMarkdown(c));

    // Fallback if parsing failed completely
    if (result.insights.length === 0 && result.recommendations.length === 0) {
      appLogger.warn('[AnalyzerChat] No insights/recommendations extracted, using fallback');
      return this.getFallbackAnalysis(data);
    }

    return result;
  }

  /**
   * Clean markdown formatting from text
   * Safe for any input type (string, number, object, array)
   */
  private cleanMarkdown(text: unknown): string {
    // ✅ Type guard: only process strings
    if (typeof text !== 'string') {
      return String(text || '');  // Convert non-strings safely
    }
    
    if (!text) return '';
    
    return text
      .replace(/###\s*/g, '')           // Remove ### headers
      .replace(/##\s*/g, '')            // Remove ## headers
      .replace(/#\s*/g, '')             // Remove # headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove **bold**
      .replace(/\*([^*]+)\*/g, '$1')     // Remove *italic*
      .replace(/^[-*•]\s*/gm, '')       // Remove bullet points
      .replace(/^\d+\.\s*/gm, '')       // Remove numbered lists
      .trim();
  }

  /**
   * Extract sections from LLM response
   * Supports BOTH **Section** and ### Section formats
   */
  private extractSections(response: string): {
    summary?: string;
    insights?: string[];
    patterns?: string[];
    recommendations?: string[];
    caveats?: string[];
  } {
    const sections: any = {};
    
    // Support BOTH **Section** and ### Section formats
    const sectionPatterns = {
      summary: [
        /\*\*Summary\*\*:\s*([\s\S]*?)(?=###|\*\*|$)/i,
        /###\s*Summary\s*\n([\s\S]*?)(?=###|\*\*|$)/i
      ],
      insights: [
        /\*\*Key Insights\*\*:\s*([\s\S]*?)(?=###|\*\*|$)/i,
        /###\s*(?:Key\s+)?Insights\s*\n([\s\S]*?)(?=###|\*\*|$)/i
      ],
      patterns: [
        /\*\*Patterns\*\*:\s*([\s\S]*?)(?=###|\*\*|$)/i,
        /###\s*Patterns\s*\n([\s\S]*?)(?=###|\*\*|$)/i
      ],
      recommendations: [
        /\*\*Recommendations\*\*:\s*([\s\S]*?)(?=###|\*\*|$)/i,
        /###\s*Recommendations\s*\n([\s\S]*?)(?=###|\*\*|$)/i
      ],
      caveats: [
        /\*\*Caveats\*\*:\s*([\s\S]*?)(?=###|\*\*|$)/i,
        /###\s*Caveats\s*\n([\s\S]*?)(?=###|\*\*|$)/i
      ]
    };
    
    for (const [sectionName, patterns] of Object.entries(sectionPatterns)) {
      for (const pattern of patterns) {
        const match = response.match(pattern);
        if (match && match[1]) {
          const content = match[1].trim();
          const parsed = this.parseBulletPoints(content);
          
          // Only add if we got actual content (not headers)
          if (parsed.length > 0 && !parsed[0]?.startsWith('###')) {
            sections[sectionName] = parsed;
          }
          break;  // Found this section
        }
      }
    }
    
    return sections;
  }

  /**
   * Parse bullet points from text
   * Skips section headers and extracts only actual content
   */
  private parseBulletPoints(text: string): string[] {
    const lines = text.split('\n');
    const bulletPoints: string[] = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip section headers (###, **, etc.)
      if (trimmed.startsWith('###') || trimmed.startsWith('**')) {
        continue;  // ✅ Skip headers
      }
      
      // Skip empty lines
      if (trimmed.length === 0) {
        continue;
      }
      
      // Remove bullet markers (-, *, •, 1., etc.)
      const cleanLine = trimmed.replace(/^[-*•]\s*|^\d+\.\s*/, '').trim();
      
      // Only add if meaningful content (min 10 chars)
      if (cleanLine.length > 10) {
        bulletPoints.push(cleanLine);
      }
    }
    
    return bulletPoints;
  }

  /**
   * Extract summary from response (fallback)
   */
  private extractSummary(response: string): string {
    // Take first 2-3 sentences as summary
    const sentences = response.split(/[.!?]+/);
    const summary = sentences.slice(0, 3).join('. ').trim();
    return summary || response.substring(0, 300);
  }

  /**
   * Extract bullet points by keyword (fallback)
   */
  private extractBulletPoints(
    response: string,
    keyword: string
  ): string[] {
    const lines = response.split('\n');
    const points: string[] = [];

    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes(keyword) && line.trim().length > 10) {
        const point = line.replace(/^[-*•]\s*|^\d+\.\s*/, '').trim();
        points.push(point);
      }
    }

    return points.slice(0, 5);  // Limit to 5 points
  }

  /**
   * Count data points in data
   */
  private countDataPoints(data: unknown): number {
    if (!data || typeof data !== 'object') {
      return 0;
    }

    if (Array.isArray(data)) {
      return data.length;
    }

    return Object.keys(data).length;
  }

  /**
   * Get data keys for logging
   */
  private getDataKeys(data: unknown): string[] {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return [];
    }

    return Object.keys(data).slice(0, 10);  // Limit to 10 keys
  }

  /**
   * Calculate confidence score based on analysis quality
   */
  private calculateConfidence(result: AnalysisResult): number {
    let confidence = 0.5;  // Base confidence

    // Boost for having insights
    if (result.insights.length > 0) {
      confidence += 0.1;
    }
    if (result.insights.length >= 3) {
      confidence += 0.1;
    }

    // Boost for having recommendations
    if (result.recommendations.length > 0) {
      confidence += 0.1;
    }
    if (result.recommendations.length >= 2) {
      confidence += 0.1;
    }

    // Boost for having summary
    if (result.summary && result.summary.length > 50) {
      confidence += 0.1;
    }

    // Cap at 0.95
    return Math.min(0.95, confidence);
  }

  /**
   * Get fallback analysis when LLM fails
   */
  private getFallbackAnalysis(
    data: unknown,
    context?: AnalysisContext
  ): AnalysisResult {
    const dataPoints = this.countDataPoints(data);
    const dataKeys = this.getDataKeys(data);

    return {
      summary: `Data tersedia dengan ${dataPoints} poin data.`,
      insights: [
        `Data memiliki ${dataKeys.length} field: ${dataKeys.join(', ')}`,
        'Analisis detail tidak tersedia karena kendala teknis',
        'Silakan coba lagi atau hubungi support jika masalah berlanjut'
      ],
      recommendations: [
        'Periksa kembali data yang dimasukkan',
        'Coba lagi dalam beberapa saat'
      ],
      metadata: {
        analyzedAt: new Date().toISOString(),
        dataPoints,
        language: context?.language || 'id',
        confidence: 0.5
      }
    };
  }
}

// Singleton instance
export const analyzerChatService = new AnalyzerChatService();
