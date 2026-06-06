// ============================================================
// Trend Analyzer Chat Service - LLM-Powered Comparison Analysis
// ============================================================
// Provides intelligent trend/comparison analysis between datasets
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

export interface TrendAnalysisResult {
  summary: string;
  baseline: {
    label: string;
    count?: number;
    value?: number;
    percentage?: number;
  };
  comparison: {
    label: string;
    count?: number;
    value?: number;
    percentage?: number;
  };
  delta: {
    absolute: number;
    percentage: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  trends: string[];
  recommendations: string[];
  metadata: {
    analyzedAt: string;
    dataPoints: number;
    language: string;
    confidence: number;
  };
}

// ============================================================
// Trend Analysis Prompt Template
// ============================================================

const TREND_ANALYSIS_SYSTEM_PROMPT = `Anda adalah asisten analis tren profesional dengan keahlian dalam:
1. Perbandingan data antar periode waktu atau kondisi
2. Identifikasi pola perubahan dan trend
3. Perhitungan delta (absolute dan percentage)
4. Memberikan rekomendasi yang actionable

TUGAS ANDA:
- Bandingkan baseline dengan comparison secara teliti
- Hitung delta (absolute change dan percentage change)
- Identifikasi trend (increasing/decreasing/stable)
- Berikan insight yang bernilai dan dapat ditindaklanjuti
- Fokus pada hal yang paling penting (prioritas)

FORMAT RESPON:
{
  "summary": "Ringkasan singkat 2-3 kalimat tentang perbandingan",
  "baseline": {
    "label": "Label baseline (contoh: Kemarin, Last Week)",
    "count": 0,
    "value": 0,
    "percentage": 0
  },
  "comparison": {
    "label": "Label comparison (contoh: Hari ini, This Week)",
    "count": 0,
    "value": 0,
    "percentage": 0
  },
  "delta": {
    "absolute": 0,
    "percentage": 0,
    "trend": "decreasing"
  },
  "trends": [
    "Trend utama 1",
    "Trend utama 2"
  ],
  "recommendations": [
    "Rekomendasi 1",
    "Rekomendasi 2"
  ]
}

PENTING:
- RESPOND ONLY DENGAN JSON VALID (tanpa markdown, tanpa teks tambahan)
- Semua field usahakan ada (summary, baseline, comparison, delta, trends, recommendations)
- Jangan mengarang data yang tidak ada
- Jika data tidak cukup untuk perbandingan, katakan dengan jelas di summary
- Hitung delta dengan benar: comparison - baseline
- Tentukan trend: increasing (naik), decreasing (turun), stable (stabil)
- Prioritaskan insight yang paling berdampak
- Gunakan bahasa Indonesia yang baik dan profesional
`;

// ============================================================
// Trend Analyzer Chat Service
// ============================================================

class TrendAnalyzerChatService {

  /**
   * Analyze data trends and provide comparison insights
   *
   * @param data - Data to analyze (should contain baseline and comparison)
   * @param context - Analysis context (query, language, intent)
   * @returns Structured trend analysis result with delta and recommendations
   */
  async analyze(
    data: unknown,
    context?: AnalysisContext
  ): Promise<TrendAnalysisResult> {
    const start = Date.now();

    try {
      appLogger.info('[TrendAnalyzer] Starting trend analysis', {
        dataType: typeof data,
        language: context?.language || 'id',
        userQuery: context?.userQuery?.substring(0, 50)
      });

      // Build LLM prompt
      const prompt = this.buildTrendAnalysisPrompt(data, context || {});

      // Get LLM response
      const llmResponse = await this.getLLMResponse(prompt, context?.language);

      // Parse LLM response into structured result
      const trendResult = this.parseTrendAnalysisResponse(llmResponse, data);

      const duration = Date.now() - start;
      appLogger.info('[TrendAnalyzer] Trend analysis completed', {
        durationMs: duration,
        trendsCount: trendResult.trends.length,
        recommendationsCount: trendResult.recommendations.length,
        trend: trendResult.delta.trend,
        deltaPercentage: trendResult.delta.percentage
      });

      return trendResult;

    } catch (error) {
      appLogger.error('[TrendAnalyzer] Trend analysis failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return fallback trend analysis
      return this.getFallbackTrendAnalysis(data, context);
    }
  }

  /**
   * Build prompt for trend analysis
   */
  private buildTrendAnalysisPrompt(
    data: unknown,
    context: AnalysisContext
  ): string {
    const language = context.language === 'en' ? 'English' : 'Indonesia';
    const userQuery = context.userQuery || 'Analisa trend ini';

    const dataString = JSON.stringify(data, null, 2);

    return `
${TREND_ANALYSIS_SYSTEM_PROMPT}

---

DATA YANG DIANALISA:
${dataString}

---

KONTEKS:
- Pertanyaan User: "${userQuery}"
- Bahasa: ${language}

---

Silakan berikan analisa trend/perbandingan dalam format JSON yang sudah ditentukan.
Fokus pada perbandingan yang jelas dan insight yang actionable.

RESPON ANDA:
`.trim();
  }

  /**
   * Get response from LLM
   */
  private async getLLMResponse(
    prompt: string,
    language: string = 'id'
  ): Promise<string> {
    const provider = config.default?.provider || 'ollama';
    const llmModel = provider === 'qwen'
      ? config.alibaba?.llmModel
      : config.ollama?.llmModel;

    const messages: ChatMessage[] = [
      { role: 'system' as const, content: TREND_ANALYSIS_SYSTEM_PROMPT },
      { role: 'user' as const, content: prompt }
    ];

    try {
      if (provider === 'qwen') {
        return await openAiService.chatMessage(
          messages,
          llmModel,
          {
            temperature: 0.3,  // Lower temperature for more consistent calculations
            num_predict: 2048
          }
        );
      } else {
        return await ollamaService.chatMessage(
          messages,
          llmModel,
          {
            temperature: 0.3,
            num_predict: 2048
          }
        );
      }
    } catch (error) {
      appLogger.error('[TrendAnalyzer] LLM call failed', {
        provider,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Parse LLM response into structured TrendAnalysisResult
   */
  private parseTrendAnalysisResponse(
    llmResponse: string,
    data: unknown
  ): TrendAnalysisResult {
    try {
      // Try to extract JSON from response
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and build result
      const result: TrendAnalysisResult = {
        summary: parsed.summary || 'Analisa trend tidak tersedia.',
        baseline: {
          label: parsed.baseline?.label || 'Baseline',
          count: parsed.baseline?.count || 0,
          value: parsed.baseline?.value || 0,
          percentage: parsed.baseline?.percentage || 0
        },
        comparison: {
          label: parsed.comparison?.label || 'Comparison',
          count: parsed.comparison?.count || 0,
          value: parsed.comparison?.value || 0,
          percentage: parsed.comparison?.percentage || 0
        },
        delta: {
          absolute: parsed.delta?.absolute || 0,
          percentage: parsed.delta?.percentage || 0,
          trend: this.validateTrend(parsed.delta?.trend)
        },
        trends: Array.isArray(parsed.trends) ? parsed.trends : ['Tidak ada trend yang teridentifikasi.'],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        metadata: {
          analyzedAt: new Date().toISOString(),
          dataPoints: this.countDataPoints(data),
          language: 'id',
          confidence: 0.8
        }
      };

      // ✅ AUTO-CALCULATE DELTA IF NOT PROVIDED
      if (parsed.delta === undefined && result.baseline.count !== undefined && result.comparison.count !== undefined) {
        result.delta.absolute = result.comparison.count - result.baseline.count;
        result.delta.percentage = result.baseline.count !== 0
          ? ((result.comparison.count - result.baseline.count) / result.baseline.count) * 100
          : 0;
        result.delta.trend = this.calculateTrend(result.delta.absolute);
      }

      return result;

    } catch (error) {
      appLogger.warn('[TrendAnalyzer] Failed to parse LLM response', {
        error: error instanceof Error ? error.message : 'Unknown error',
        responseLength: llmResponse.length
      });

      // Return calculated trend analysis
      return this.calculateSimpleTrendAnalysis(data);
    }
  }

  /**
   * Validate trend value
   */
  private validateTrend(trend: string): 'increasing' | 'decreasing' | 'stable' {
    const validTrends = ['increasing', 'decreasing', 'stable'];
    if (validTrends.includes(trend?.toLowerCase())) {
      return trend.toLowerCase() as any;
    }
    return 'stable';
  }

  /**
   * Calculate trend direction from delta
   */
  private calculateTrend(delta: number): 'increasing' | 'decreasing' | 'stable' {
    if (delta > 0) return 'increasing';
    if (delta < 0) return 'decreasing';
    return 'stable';
  }

  /**
   * Count data points in data
   */
  private countDataPoints(data: unknown): number {
    if (!data || typeof data !== 'object') return 0;

    if (Array.isArray(data)) {
      return data.length;
    }

    return Object.keys(data).length;
  }

  /**
   * Calculate simple trend analysis (fallback when LLM fails)
   */
  private calculateSimpleTrendAnalysis(data: unknown): TrendAnalysisResult {
    const dataObj = data as any;

    // Try to extract baseline and comparison from data
    const baseline = dataObj?.baseline || dataObj?.data?.baseline || {};
    const comparison = dataObj?.comparison || dataObj?.data?.comparison || {};

    const baselineCount = baseline.count || baseline.value || 0;
    const comparisonCount = comparison.count || comparison.value || 0;
    const delta = comparisonCount - baselineCount;
    const percentage = baselineCount !== 0 ? (delta / baselineCount) * 100 : 0;

    return {
      summary: `Perbandingan antara ${baseline.label || 'baseline'} dan ${comparison.label || 'comparison'}.`,
      baseline: {
        label: baseline.label || 'Baseline',
        count: baselineCount,
        value: baselineCount,
        percentage: 100
      },
      comparison: {
        label: comparison.label || 'Comparison',
        count: comparisonCount,
        value: comparisonCount,
        percentage: baselineCount !== 0 ? (comparisonCount / baselineCount) * 100 : 0
      },
      delta: {
        absolute: delta,
        percentage: percentage,
        trend: this.calculateTrend(delta)
      },
      trends: [
        delta > 0 ? `Peningkatan ${Math.abs(percentage).toFixed(1)}% dibandingkan baseline.` :
        delta < 0 ? `Penurunan ${Math.abs(percentage).toFixed(1)}% dibandingkan baseline.` :
        'Tidak ada perubahan signifikan dibandingkan baseline.'
      ],
      recommendations: [
        'Monitor trend ini untuk periode berikutnya.',
        'Investigasi penyebab perubahan jika signifikan.'
      ],
      metadata: {
        analyzedAt: new Date().toISOString(),
        dataPoints: this.countDataPoints(data),
        language: 'id',
        confidence: 0.6  // Lower confidence for calculated analysis
      }
    };
  }

  /**
   * Fallback trend analysis when LLM fails
   */
  private getFallbackTrendAnalysis(
    data: unknown,
    context?: AnalysisContext
  ): TrendAnalysisResult {
    appLogger.warn('[TrendAnalyzer] Using fallback trend analysis', {
      reason: 'LLM analysis failed'
    });

    return this.calculateSimpleTrendAnalysis(data);
  }
}

// ============================================================
// Singleton Instance
// ============================================================

export const trendAnalyzerChatService = new TrendAnalyzerChatService();
