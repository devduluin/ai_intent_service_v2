import type { ApiHandlerFn } from '../types';
import { fileGeneratorService } from '../services/fileGenerator.service';
import { appLogger } from '../utils/logger.util';
import { detectFormatFromContext, getExtensionForFormat } from '../utils/format-detector.util';

// ============================================================
// XLS INTENT HANDLER
// Generate Excel file from data with LLM-powered formatting
// ============================================================

export const xlsHandlerKey = 'handleGenerateXls';

/**
 * Parameters expected:
 * - data: Any data structure (object, array, nested)
 * - filename: string (optional, default: 'export_{timestamp}.xlsx')
 * - sheetName: string (optional, default: 'Sheet1')
 * - savePath: string (optional, default: './uploads/xls/')
 * - format: 'xlsx' | 'csv' (optional, default: 'xlsx')
 * - useLlmFormat: boolean (optional, default: true) - Use LLM to format data
 *
 * Special handling:
 * - If data contains dependency results (e.g., { '1': {...}, '2': {...} }),
 *   the service will intelligently extract and format the data
 */
export const handleGenerateXls: ApiHandlerFn = async (params, context) => {
  appLogger.info('[XLS Handler] Received request', {
    paramKeys: Object.keys(params || {}),
    hasContext: !!context
  });

  try {
    // Detect format from context.text
    const detectedFormat = detectFormatFromContext(context);
    
    // Extract and normalize parameters
    const normalizedParams = normalizeParams(params, detectedFormat);

    appLogger.debug('[XLS Handler] Normalized params', {
      dataKeys: normalizedParams.data ? Object.keys(normalizedParams.data) : [],
      filename: normalizedParams.filename,
      sheetName: normalizedParams.sheetName,
      format: normalizedParams.format,
      detectedFromContext: detectedFormat,
      useLlmFormat: normalizedParams.useLlmFormat
    });

    // Validate data
    if (!normalizedParams.data) {
      return {
        success: false,
        error: 'Data is required',
        message: 'Data tidak boleh kosong'
      };
    }

    // Generate Excel file using file generator service
    const result = await fileGeneratorService.generateExcelFile(context, {
      data: normalizedParams.data,
      filename: normalizedParams.filename,
      sheetName: normalizedParams.sheetName,
      savePath: normalizedParams.savePath,
      format: normalizedParams.format
    });

    if (result.success) {
      appLogger.info('[XLS Handler] File generated successfully', {
        filename: result.filename,
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        fileSize: result.fileSize,
        format: normalizedParams.format
      });

      const fileTypeLabel = normalizedParams.format === 'csv' ? 'CSV' : 'Excel';
      
      return {
        success: true,
        filename: result.filename,
        filePath: result.filePath,
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        fileSize: result.fileSize,
        sheetName: normalizedParams.sheetName,
        message: `✅ File ${fileTypeLabel} berhasil dibuat: ${result.filename}`,
        downloadUrl: result.downloadUrl,
        metadata: {
          generatedAt: new Date().toISOString(),
          format: normalizedParams.format,
          llmFormatted: normalizedParams.useLlmFormat,
          detectedFromContext: detectedFormat !== 'default'
        }
      };
    } else {
      appLogger.error('[XLS Handler] File generation failed', {
        error: result.error
      });

      return {
        success: false,
        error: result.error,
        message: '❌ Gagal membuat file Excel'
      };
    }

  } catch (error) {
    appLogger.error('[XLS Handler] Unexpected error', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: '❌ Terjadi kesalahan saat membuat file Excel'
    };
  }
};

// ============================================================
// HELPER: Normalize parameters from various input formats
// ============================================================

function normalizeParams(
  params: Record<string, any> | undefined,
  detectedFormat?: string | 'default'
): {
  data: any;
  filename?: string;
  sheetName: string;
  savePath: string;
  format: 'xlsx' | 'csv';
  useLlmFormat: boolean;
} {
  if (!params) {
    return {
      data: null,
      sheetName: 'Sheet1',
      savePath: './uploads/xls/',
      format: detectedFormat === 'csv' ? 'csv' : 'xlsx',
      useLlmFormat: true
    };
  }

  // Check if params contain dependency results (numbered keys like '1', '2', etc.)
  const dependencyKeys = Object.keys(params).filter(k => /^\d+$/.test(k));

  let data: any;

  if (dependencyKeys.length > 0) {
    // Multiple dependency results - merge into single data structure
    const mergedData: Record<string, any> = {};

    for (const key of dependencyKeys) {
      const value = params[key];
      if (typeof value === 'object' && value !== null) {
        // If it's the first/only dependency, use it directly
        if (dependencyKeys.length === 1) {
          data = value;
        } else {
          // Merge multiple dependencies
          mergedData[`task_${key}`] = value;
        }
      }
    }

    if (dependencyKeys.length > 1) {
      data = mergedData;
    }
  }

  // Fallback: use params.data if exists
  if (data === undefined && params.data !== undefined) {
    data = params.data;
  }

  // Fallback: use entire params as data (excluding known option keys)
  if (data === undefined) {
    const optionKeys = ['filename', 'sheetName', 'savePath', 'format', 'data', 'useLlmFormat'];
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

  // Determine final format: explicit param > detected from context > default (xlsx)
  let format: 'xlsx' | 'csv';

  if (params.format === 'csv') {
    format = 'csv';
  } else if (params.format === 'xlsx') {
    format = 'xlsx';
  } else if (detectedFormat === 'csv') {
    format = 'csv';
  } else {
    format = 'xlsx'; // Default to xlsx
  }

  return {
    data: data || null,
    filename: params.filename,
    sheetName: params.sheetName || 'Sheet1',
    savePath: params.savePath || './uploads/xls/',
    format,
    useLlmFormat: params.useLlmFormat !== false  // Default to true
  };
}

// ============================================================
// EXPORT HELPERS FOR TESTING
// ============================================================

export { normalizeParams };