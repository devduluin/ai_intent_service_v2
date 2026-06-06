// ============================================================
// XLS GENERATOR SKILL
// ============================================================
// Generate Excel/CSV files from data with LLM-powered formatting
// ============================================================

import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import type { ToolParameterConfig } from '../database/models/Tools-parameter.model';
import { fileGeneratorService } from '../services/fileGenerator.service';
import { appLogger } from '../utils/logger.util';
import { detectFormatFromContext } from '../utils/format-detector.util';

// ============================================================
// SKILL METADATA (for auto-discovery)
// ============================================================

export const xlsGeneratorSkill: InternalSkillMetadata = {
  name: 'XLS Generator',
  slug: 'xls_generator',
  description: 'Generate Excel/CSV file dari data dengan formatting profesional',
  handlerKey: 'handleGenerateXls',
  version: '1.0.0',
  tags: ['export', 'excel', 'csv', 'file', 'document'],
  category: 'export',
  isHidden: false,

  capabilities: {
    actionTypes: ['export', 'generate'],
    outputFormats: ['xlsx', 'xls', 'csv', 'excel'],
    triggers: [
      'export', 'download', 'excel', 'xlsx', 'xls', 'csv',
      'simpan', 'save', 'buat excel', 'jadikan excel'
    ],
    context: ['file_generation', 'data_export'],
    priority: 9,
    requiresData: true
  },
  
  paramSchema: [
    {
      name: 'data',
      type: 'text',
      description: 'Data yang akan di-export (JSON, array, object)',
      isRequired: true,
      label: 'Data',
      order: 1
    },
    {
      name: 'filename',
      type: 'string',
      description: 'Nama file output (optional, default: export_{timestamp})',
      isRequired: false,
      label: 'Filename',
      order: 2,
      config: {
        pattern: '^[a-zA-Z0-9_-]+$',
        placeholder: 'export_data'
      } as ToolParameterConfig
    },
    {
      name: 'format',
      type: 'select',
      description: 'Format output file',
      isRequired: false,
      defaultValue: 'xlsx',
      label: 'Format',
      order: 3,
      config: {
        options: [
          { label: 'Excel (.xlsx)', value: 'xlsx' },
          { label: 'CSV (.csv)', value: 'csv' }
        ]
      } as ToolParameterConfig
    },
    {
      name: 'sheetName',
      type: 'string',
      description: 'Nama sheet (untuk Excel)',
      isRequired: false,
      defaultValue: 'Sheet1',
      label: 'Sheet Name',
      order: 4,
      config: {
        maxLength: 31,
        placeholder: 'Sheet1'
      } as ToolParameterConfig
    }
  ]
};

// ============================================================
// HANDLER IMPLEMENTATION
// ============================================================

export const handleGenerateXls: ApiHandlerFn = async (params, context, data) => {
  appLogger.info('[XLS Generator] Received request', {
    paramKeys: Object.keys(params || {}),
    hasContext: !!context,
    hasDependencyData: data !== undefined
  });

  try {
    // Check if there's any data to export
    if ((!params || Object.keys(params).length === 0) && data === undefined) {
      appLogger.warn('[XLS Generator] No data to export');
      return {
        success: false,
        message: '❌ Tidak ada data yang dapat di-export'
      };
    }

    // Detect format from context
    const detectedFormat = params?.format ? undefined : detectFormatFromContext(context);

    // Normalize parameters
    const normalizedParams = normalizeParams(params, detectedFormat, data);

    appLogger.debug('[XLS Generator] Normalized params', {
      dataKeys: normalizedParams.data ? Object.keys(normalizedParams.data) : [],
      filename: normalizedParams.filename,
      format: normalizedParams.format,
      sheetName: normalizedParams.sheetName
    });

    // Validate data
    if (!normalizedParams.data) {
      appLogger.warn('[XLS Generator] Data is empty after normalization');
      return {
        success: false,
        message: '❌ Data tidak boleh kosong'
      };
    }

    // Generate file using file generator service
    const result = await fileGeneratorService.generateExcelFile(context, {
      data: normalizedParams.data,
      filename: normalizedParams.filename,
      sheetName: normalizedParams.sheetName,
      savePath: normalizedParams.savePath,
      format: normalizedParams.format
    });

    if (result.success) {
      appLogger.info('[XLS Generator] File generated successfully', {
        filename: result.filename,
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        fileSize: result.fileSize,
        format: normalizedParams.format,
        downloadUrl: result.downloadUrl
      });

      return {
        success: true,
        message: '✅ File Excel berhasil dibuat',
        downloadUrl: result.downloadUrl
      };
    } else {
      appLogger.error('[XLS Generator] File generation failed', {
        error: result.error
      });

      return {
        success: false,
        message: '❌ Gagal membuat file Excel'
      };
    }

  } catch (error) {
    appLogger.error('[XLS Generator] Unexpected error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return {
      success: false,
      message: '❌ Terjadi kesalahan saat membuat file Excel'
    };
  }
};

// ============================================================
// HELPER: Normalize parameters
// ============================================================

function normalizeParams(
  params: Record<string, any> | undefined,
  detectedFormat?: string | 'default',
  dependencyData?: unknown
): {
  data: any;
  filename?: string;
  sheetName: string;
  savePath: string;
  format: 'xlsx' | 'csv';
} {
  let data: any = extractDependencyPayload(dependencyData);

  if (!data) {
    data = params?.data;
  }

  // Fallback: use entire params as data (excluding option keys)
  if (!data && params) {
    const optionKeys = ['filename', 'sheetName', 'savePath', 'format', 'data'];
    data = {};

    for (const [key, value] of Object.entries(params)) {
      if (!optionKeys.includes(key)) {
        data[key] = value;
      }
    }

    // If only one key-value pair, use the value directly
    if (Object.keys(data).length === 1) {
      const firstKey = Object.keys(data)[0];
      data = data[firstKey];
    }
  }

  // Determine format: explicit param > detected from context > default (xlsx)
  let format: 'xlsx' | 'csv';

  if (params?.format === 'csv') {
    format = 'csv';
  } else if (params?.format === 'xlsx') {
    format = 'xlsx';
  } else if (detectedFormat === 'csv') {
    format = 'csv';
  } else {
    format = 'xlsx'; // Default to xlsx
  }

  return {
    data: data || null,
    filename: params?.filename,
    sheetName: params?.sheetName || 'Sheet1',
    savePath: params?.savePath || './uploads/xls/',
    format
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
  metadata: xlsGeneratorSkill,
  handler: handleGenerateXls
} as InternalSkillModule;
