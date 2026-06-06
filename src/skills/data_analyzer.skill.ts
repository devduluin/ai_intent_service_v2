// ============================================================
// DATA ANALYZER SKILL
// ============================================================
// Provides intelligent data analysis with LLM-powered insights
// ============================================================

import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import type { ToolParameterConfig } from '../database/models/Tools-parameter.model';
import { analyzerChatService } from '../services/analyzerChat.service';
import { appLogger } from '../utils/logger.util';

// ============================================================
// SKILL METADATA (for auto-discovery)
// ============================================================

export const dataAnalyzerSkill: InternalSkillMetadata = {
  name: 'Data Analyzer',
  slug: 'data_analyzer',
  description: 'Lakukan analisa data dengan AI-powered insights',
  handlerKey: 'handleDataAnalysis',
  version: '1.0.0',
  tags: ['analysis', 'data', 'ai', 'insights'],
  category: 'analytics',
  isHidden: false,

  capabilities: {
    actionTypes: ['detail', 'analyze', 'summarize', 'insight'],
    outputFormats: ['insight', 'analysis', 'summary', 'recommendation'],
    triggers: [
      'analisa', 'analyze', 'analisis', 'analysis',
      'summary', 'summarize', 'ringkas', 'rangkum',
      'insight', 'insights', 'detail', 'jelaskan',
      'coba analisa', 'lihat pola', 'temukan trend'
    ],
    context: ['data_analysis', 'insight_generation', 'post_execution'],
    priority: 8,
    requiresData: true
  },
  
  paramSchema: [
    {
      name: 'data',
      type: 'text',
      description: 'Data yang akan dianalisa (JSON, array, object)',
      isRequired: true,
      label: 'Data',
      order: 1
    },
    {
      name: 'userQuery',
      type: 'string',
      description: 'Pertanyaan user (optional)',
      isRequired: false,
      label: 'Pertanyaan',
      order: 2
    },
    {
      name: 'language',
      type: 'select',
      description: 'Bahasa output',
      isRequired: false,
      defaultValue: 'id',
      label: 'Bahasa',
      order: 3,
      config: {
        options: [
          { label: 'Indonesia', value: 'id' },
          { label: 'English', value: 'en' }
        ]
      } as ToolParameterConfig
    },
    {
      name: 'analysisDepth',
      type: 'select',
      description: 'Kedalaman analisa',
      isRequired: false,
      defaultValue: 'standard',
      label: 'Kedalaman',
      order: 4,
      config: {
        options: [
          { label: 'Singkat', value: 'brief' },
          { label: 'Standar', value: 'standard' },
          { label: 'Detail', value: 'detailed' }
        ]
      } as ToolParameterConfig
    }
  ]
};

// ============================================================
// HANDLER IMPLEMENTATION
// ============================================================

export const handleDataAnalysis: ApiHandlerFn = async (params, context, data) => {
  appLogger.info('[Data Analyzer] Received request', {
    paramKeys: Object.keys(params || {}),
    hasContext: !!context,
    hasDependencyData: data !== undefined,
    language: params?.language || 'id'
  });

  try {
    // Extract and normalize parameters
    const normalizedParams = normalizeParams(params, context, data);

    appLogger.debug('[Data Analyzer] Normalized params', {
      dataKeys: normalizedParams.data ? Object.keys(normalizedParams.data) : [],
      userQuery: normalizedParams.userQuery,
      intent: normalizedParams.intent,
      language: normalizedParams.language,
      analysisDepth: normalizedParams.analysisDepth
    });

    // Validate data
    if (!normalizedParams.data) {
      appLogger.error('[Data Analyzer] Missing data parameter');
      return {
        success: false,
        error: 'Data is required',
        message: 'Data tidak boleh kosong'
      };
    }

    // Perform analysis using analyzerChat service
    const analysisResult = await analyzerChatService.analyze(
      normalizedParams.data,
      {
        userQuery: normalizedParams.userQuery,
        language: normalizedParams.language,
        intent: normalizedParams.intent,
        appName: context?.app_name
      }
    );

    appLogger.info('[Data Analyzer] Analysis completed', {
      summaryLength: analysisResult.summary.length,
      insightsCount: analysisResult.insights.length,
      recommendationsCount: analysisResult.recommendations.length,
      confidence: analysisResult.metadata.confidence,
      language: analysisResult.metadata.language
    });

    // Return ONLY analysis object (NO DUPLICATE FIELDS)
    return {
      success: true,
      analysis: analysisResult,
      metadata: {
        analyzedAt: analysisResult.metadata.analyzedAt,
        dataPoints: analysisResult.metadata.dataPoints,
        language: analysisResult.metadata.language,
        confidence: analysisResult.metadata.confidence,
        analysisDepth: normalizedParams.analysisDepth
      }
    };

  } catch (error) {
    appLogger.error('[Data Analyzer] Unexpected error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: '❌ Terjadi kesalahan saat menganalisa data'
    };
  }
};

// ============================================================
// HELPER: Normalize parameters
// ============================================================

function normalizeParams(
  params: Record<string, any> | undefined,
  context?: any,
  dependencyData?: unknown
): {
  data: any;
  userQuery?: string;
  intent?: string;
  language: 'id' | 'en';
  analysisDepth: 'brief' | 'standard' | 'detailed';
} {
  if (!params) {
    return {
      data: null,
      language: 'id',
      analysisDepth: 'standard'
    };
  }

  let data: any = extractDependencyPayload(dependencyData);

  // Fallback: use params.data if exists
  if (data === undefined && params.data !== undefined) {
    data = params.data;
  }

  // Fallback: use entire params as data (excluding known option keys)
  if (data === undefined) {
    const optionKeys = [
      'userQuery', 'query', 'intent', 'language',
      'analysisDepth', 'includeRecommendations', 'data'
    ];
    data = {};

    for (const [key, value] of Object.entries(params)) {
      if (!optionKeys.includes(key)) {
        data[key] = value;
      }
    }

    if (Object.keys(data).length === 1) {
      const firstKey = Object.keys(data)[0];
      data = data[firstKey];
    }
  }

  // Determine language
  let language: 'id' | 'en' = 'id';
  if (params.language === 'en') {
    language = 'en';
  } else if (context?.language === 'en') {
    language = 'en';
  }

  // Determine analysis depth
  let analysisDepth: 'brief' | 'standard' | 'detailed' = 'standard';
  if (params.analysisDepth === 'brief') {
    analysisDepth = 'brief';
  } else if (params.analysisDepth === 'detailed') {
    analysisDepth = 'detailed';
  }

  return {
    data: data || null,
    userQuery: params.userQuery || params.query || context?.text,
    intent: params.intent || context?.intent,
    language,
    analysisDepth
  };
}

function extractDependencyPayload(dependencyData: unknown): any {
  if (!dependencyData || typeof dependencyData !== 'object') {
    return undefined;
  }

  const record = dependencyData as {
    primary?: unknown;
    values?: unknown[];
    byKey?: Record<string, unknown>;
    byId?: Record<string, unknown>;
  };

  if (record.primary !== undefined) {
    return record.primary;
  }

  if (Array.isArray(record.values) && record.values.length > 0) {
    return record.values.length === 1 ? record.values[0] : record.values;
  }

  if (record.byKey && Object.keys(record.byKey).length > 0) {
    return record.byKey;
  }

  if (record.byId && Object.keys(record.byId).length > 0) {
    return record.byId;
  }

  return undefined;
}

// ============================================================
// DEFAULT EXPORT (for auto-discovery)
// ============================================================

export default {
  metadata: dataAnalyzerSkill,
  handler: handleDataAnalysis
} as InternalSkillModule;
