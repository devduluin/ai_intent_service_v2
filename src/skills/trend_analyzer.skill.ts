// ============================================================
// TREND ANALYZER SKILL
// ============================================================
// Trend/comparison analysis between datasets or time periods
// Example: "bandingkan kendaraan exit hari ini dengan kemarin"
// ============================================================

import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import { trendAnalyzerChatService } from '../services/trendAnalyzerChat.service';
import { appLogger } from '../utils/logger.util';

// ============================================================
// SKILL METADATA (for auto-discovery)
// ============================================================

export const trendAnalyzerSkill: InternalSkillMetadata = {
  name: 'Trend Analyzer',
  slug: 'trend_analyzer',
  description: 'Analisa perbandingan dan trend antar periode waktu atau kondisi (contoh: hari ini vs kemarin, this week vs last week)',
  handlerKey: 'handleTrendAnalysis',
  version: '1.0.0',
  tags: ['comparison', 'trend', 'analysis', 'delta', 'perbandingan'],
  category: 'analytics',
  isHidden: false,
  
  // ✅ CAPABILITIES FOR SKILL MATCHER
  capabilities: {
    actionTypes: ['compare', 'trend', 'analysis'],
    triggers: ['bandingkan', 'dibandingkan', 'compare', 'vs', 'versus', 'trend', 'perbandingan', 'dibanding', 'delta'],
    outputFormats: ['json', 'summary', 'comparison'],
    requiresData: true,
    priority: 8,  // High priority for comparison queries
    context: ['post_execution', 'comparison', 'multi_step']
  },
  
  // ✅ PARAMETER SCHEMA
  paramSchema: [
    {
      name: 'data',
      type: 'text',
      description: 'Data untuk dianalisa (harus berisi baseline dan comparison, atau data time-series)',
      isRequired: true,
      label: 'Data',
      order: 1
    },
    {
      name: 'baselineLabel',
      type: 'string',
      description: 'Label untuk baseline (contoh: "Kemarin", "Last Week", "Before")',
      isRequired: false,
      defaultValue: 'Baseline',
      label: 'Label Baseline',
      order: 2
    },
    {
      name: 'comparisonLabel',
      type: 'string',
      description: 'Label untuk comparison (contoh: "Hari ini", "This Week", "After")',
      isRequired: false,
      defaultValue: 'Comparison',
      label: 'Label Comparison',
      order: 3
    },
    {
      name: 'language',
      type: 'select',
      description: 'Bahasa output',
      isRequired: false,
      defaultValue: 'id',
      label: 'Bahasa',
      order: 4,
      config: {
        options: [
          { label: 'Indonesia', value: 'id' },
          { label: 'English', value: 'en' }
        ]
      }
    }
  ]
};

// ============================================================
// HANDLER IMPLEMENTATION
// ============================================================

export const handleTrendAnalysis: ApiHandlerFn = async (params, context, data) => {
  const analysisData = params?.data ?? normalizeDependencyData(data);

  appLogger.info('[Trend Analyzer] Received request', {
    paramKeys: Object.keys(params || {}),
    hasContext: !!context,
    hasData: !!analysisData,
    hasDependencyData: data !== undefined && data !== null,
    language: params?.language || 'id'
  });

  try {
    // Validate data
    if (!analysisData) {
      appLogger.warn('[Trend Analyzer] Missing data parameter');
      return {
        success: false,
        error: 'Data is required for trend analysis',
        message: 'Data tidak boleh kosong. Silakan provide data yang berisi baseline dan comparison.'
      };
    }

    // Prepare data for trend analysis
    const preparedData = prepareDataForTrendAnalysis({
      ...params,
      data: analysisData
    });

    appLogger.debug('[Trend Analyzer] Prepared data', {
      hasBaseline: !!preparedData.baseline,
      hasComparison: !!preparedData.comparison,
      dataPoints: Object.keys(preparedData).length
    });

    // Perform trend analysis
    const trendResult = await trendAnalyzerChatService.analyze(
      preparedData,
      {
        userQuery: params.userQuery || context?.text,
        language: params.language || 'id',
        intent: 'trend_analysis',
        appName: context?.app_name
      }
    );

    appLogger.info('[Trend Analyzer] Analysis completed', {
      summaryLength: trendResult.summary.length,
      trendsCount: trendResult.trends.length,
      recommendationsCount: trendResult.recommendations.length,
      trend: trendResult.delta.trend,
      deltaPercentage: trendResult.delta.percentage
    });

    // Return structured trend analysis
    return {
      success: true,
      analysis: trendResult,
      metadata: {
        analyzedAt: trendResult.metadata.analyzedAt,
        dataPoints: trendResult.metadata.dataPoints,
        language: trendResult.metadata.language,
        confidence: trendResult.metadata.confidence,
        analysisType: 'trend_comparison'
      }
    };

  } catch (error) {
    appLogger.error('[Trend Analyzer] Unexpected error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: '❌ Terjadi kesalahan saat menganalisa trend.'
    };
  }
};

// ============================================================
// HELPER: Prepare data for trend analysis
// ============================================================

function prepareDataForTrendAnalysis(params: any): any {
  const data = params.data;

  if (data?.comparison?.baseline && data?.comparison?.target) {
    return {
      baseline: {
        label: params.baselineLabel || data.comparison.baseline?.label || 'Baseline',
        ...data.comparison.baseline
      },
      comparison: {
        label: params.comparisonLabel || data.comparison.target?.label || 'Comparison',
        ...data.comparison.target
      }
    };
  }

  // If data already has baseline/comparison structure, use it directly
  if (data.baseline || data.comparison) {
    return {
      baseline: {
        label: params.baselineLabel || data.baseline?.label || 'Baseline',
        ...data.baseline
      },
      comparison: {
        label: params.comparisonLabel || data.comparison?.label || 'Comparison',
        ...data.comparison
      }
    };
  }

  // If data is time-series, extract baseline and comparison
  if (Array.isArray(data) && data.length >= 2) {
    return {
      baseline: {
        label: params.baselineLabel || 'Periode 1',
        ...data[0]
      },
      comparison: {
        label: params.comparisonLabel || 'Periode 2',
        ...data[data.length - 1]  // Use last period as comparison
      }
    };
  }

  // If data has time-based keys (today/yesterday, this_week/last_week)
  if (typeof data === 'object') {
    const dataObj = data as any;
    
    // Check for common time period keys
    const baselineKeys = ['yesterday', 'last_week', 'last_month', 'before', 'previous', 'kemarin'];
    const comparisonKeys = ['today', 'this_week', 'this_month', 'after', 'current', 'hari_ini', 'sekarang'];
    
    const baselineKey = baselineKeys.find(k => dataObj[k] !== undefined);
    const comparisonKey = comparisonKeys.find(k => dataObj[k] !== undefined);
    
    if (baselineKey && comparisonKey) {
      return {
        baseline: {
          label: params.baselineLabel || baselineKey,
          ...dataObj[baselineKey]
        },
        comparison: {
          label: params.comparisonLabel || comparisonKey,
          ...dataObj[comparisonKey]
        }
      };
    }
  }

  // Fallback: Use data as-is (LLM will try to extract)
  return data;
}

function normalizeDependencyData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data;

  const record = data as any;
  if (record.primary !== undefined) return normalizeDependencyData(record.primary);

  if (Array.isArray(data)) {
    if (data.length === 1) return data[0];
    return data;
  }

  if (record.values && Array.isArray(record.values)) {
    if (record.values.length === 1) return record.values[0];
    return record.values;
  }

  return data;
}

// ============================================================
// DEFAULT EXPORT (for auto-discovery)
// ============================================================

export default {
  metadata: trendAnalyzerSkill,
  handler: handleTrendAnalysis
} as InternalSkillModule;
