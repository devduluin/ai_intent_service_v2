import { appLogger } from './logger.util'

// ============================================================
// Format Detection Types
// ============================================================

export type DetectedFormat = 'xlsx' | 'csv' | 'txt' | 'json' | 'pdf' | 'default'

export interface FormatDetectionResult {
  format: DetectedFormat
  confidence: 'high' | 'medium' | 'low'
  detectedFrom: 'keyword' | 'extension' | 'mimetype' | 'context'
  message?: string
}

// ============================================================
// Format Keywords Configuration
// ============================================================

interface FormatKeywords {
  csv: string[]
  xlsx: string[]
  txt: string[]
  json: string[]
  pdf: string[]
}

const FORMAT_KEYWORDS: FormatKeywords = {
  csv: [
    'csv',
    'comma separated',
    'comma-separated',
    'nilai dipisah koma',
    'pisah koma',
    'format csv',
    'text csv',
    'data csv'
  ],
  xlsx: [
    'excel',
    'xlsx',
    'xls',
    'spreadsheet',
    'lembar kerja',
    'file excel',
    'format excel',
    'sheet excel'
  ],
  txt: [
    'txt',
    'text',
    'plain text',
    'teks biasa',
    'file text',
    'format text'
  ],
  json: [
    'json',
    'javascript object',
    'json format',
    'format json'
  ],
  pdf: [
    'pdf',
    'portable document',
    'adobe pdf',
    'file pdf',
    'format pdf'
  ]
}

// ============================================================
// File Extension Mapping
// ============================================================

const EXTENSION_TO_FORMAT: Record<string, DetectedFormat> = {
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.xls': 'xlsx',
  '.xlsm': 'xlsx',
  '.txt': 'txt',
  '.text': 'txt',
  '.json': 'json',
  '.pdf': 'pdf'
}

// ============================================================
// MIME Type Mapping
// ============================================================

const MIME_TO_FORMAT: Record<string, DetectedFormat> = {
  'text/csv': 'csv',
  'application/vnd.ms-excel': 'xlsx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf'
}

// ============================================================
// DETECT FORMAT FROM CONTEXT TEXT
// ============================================================

/**
 * Detect file format from context.text using string matching
 * @param context - The API handler context containing user message
 * @returns 'xlsx' | 'csv' | 'txt' | 'json' | 'pdf' | 'default'
 */
export function detectFormatFromContext(context: any): DetectedFormat {
  if (!context?.text) {
    appLogger.debug('[FormatDetector] No context.text found, using default format')
    return 'default'
  }

  const userText = context.text.toLowerCase().trim()

  // Check for CSV first (more specific)
  const isCsv = FORMAT_KEYWORDS.csv.some(keyword => userText.includes(keyword))

  if (isCsv) {
    appLogger.info('[FormatDetector] Detected CSV format from user text', { userText })
    return 'csv'
  }

  // Check for Excel/XLSX
  const isXlsx = FORMAT_KEYWORDS.xlsx.some(keyword => userText.includes(keyword))

  if (isXlsx) {
    appLogger.info('[FormatDetector] Detected XLSX format from user text', { userText })
    return 'xlsx'
  }

  // Check for TXT
  const isTxt = FORMAT_KEYWORDS.txt.some(keyword => userText.includes(keyword))

  if (isTxt) {
    appLogger.info('[FormatDetector] Detected TXT format from user text', { userText })
    return 'txt'
  }

  // Check for JSON
  const isJson = FORMAT_KEYWORDS.json.some(keyword => userText.includes(keyword))

  if (isJson) {
    appLogger.info('[FormatDetector] Detected JSON format from user text', { userText })
    return 'json'
  }

  // Check for PDF
  const isPdf = FORMAT_KEYWORDS.pdf.some(keyword => userText.includes(keyword))

  if (isPdf) {
    appLogger.info('[FormatDetector] Detected PDF format from user text', { userText })
    return 'pdf'
  }

  // No format specified, will use default
  appLogger.debug('[FormatDetector] No specific format detected, using default', { userText })
  return 'default'
}

// ============================================================
// DETECT FORMAT FROM FILENAME/EXTENSION
// ============================================================

/**
 * Detect file format from filename or extension
 * @param filename - The filename (e.g., 'data.csv', 'report.xlsx')
 * @returns DetectedFormat or 'default' if not recognized
 */
export function detectFormatFromFilename(filename: string): DetectedFormat {
  if (!filename) {
    return 'default'
  }

  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
  
  const format = EXTENSION_TO_FORMAT[ext]
  
  if (format) {
    appLogger.debug('[FormatDetector] Detected format from filename extension', { filename, ext, format })
    return format
  }

  appLogger.debug('[FormatDetector] Unknown filename extension, using default', { filename, ext })
  return 'default'
}

// ============================================================
// DETECT FORMAT FROM MIME TYPE
// ============================================================

/**
 * Detect file format from MIME type
 * @param mimetype - The MIME type (e.g., 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
 * @returns DetectedFormat or 'default' if not recognized
 */
export function detectFormatFromMimeType(mimetype: string): DetectedFormat {
  if (!mimetype) {
    return 'default'
  }

  const format = MIME_TO_FORMAT[mimetype.toLowerCase()]
  
  if (format) {
    appLogger.debug('[FormatDetector] Detected format from MIME type', { mimetype, format })
    return format
  }

  appLogger.debug('[FormatDetector] Unknown MIME type, using default', { mimetype })
  return 'default'
}

// ============================================================
// COMPREHENSIVE FORMAT DETECTION
// ============================================================

/**
 * Detect file format using multiple sources with confidence scoring
 * @param options - Detection options including context, filename, and mimetype
 * @returns FormatDetectionResult with format, confidence level, and detection source
 */
export function detectFormat(options: {
  context?: any
  filename?: string
  mimetype?: string
}): FormatDetectionResult {
  const { context, filename, mimetype } = options

  // Priority 1: MIME type (most reliable)
  if (mimetype) {
    const format = detectFormatFromMimeType(mimetype)
    if (format !== 'default') {
      return {
        format,
        confidence: 'high',
        detectedFrom: 'mimetype',
        message: `Detected ${format.toUpperCase()} format from MIME type: ${mimetype}`
      }
    }
  }

  // Priority 2: Filename extension (very reliable)
  if (filename) {
    const format = detectFormatFromFilename(filename)
    if (format !== 'default') {
      return {
        format,
        confidence: 'high',
        detectedFrom: 'extension',
        message: `Detected ${format.toUpperCase()} format from filename: ${filename}`
      }
    }
  }

  // Priority 3: Context text (user intent)
  if (context) {
    const format = detectFormatFromContext(context)
    if (format !== 'default') {
      return {
        format,
        confidence: 'medium',
        detectedFrom: 'context',
        message: `Detected ${format.toUpperCase()} format from user context`
      }
    }
  }

  // Fallback: Default
  return {
    format: 'default',
    confidence: 'low',
    detectedFrom: 'context',
    message: 'No specific format detected, using default'
  }
}

// ============================================================
// FORMAT UTILITIES
// ============================================================

/**
 * Get file extension for a given format
 * @param format - The detected format
 * @returns File extension (e.g., '.csv', '.xlsx')
 */
export function getExtensionForFormat(format: DetectedFormat | string): string {
  switch (format) {
    case 'csv':
      return '.csv'
    case 'xlsx':
      return '.xlsx'
    case 'txt':
      return '.txt'
    case 'json':
      return '.json'
    case 'pdf':
      return '.pdf'
    default:
      return '.xlsx' // Default to Excel
  }
}

/**
 * Get MIME type for a given format
 * @param format - The detected format
 * @returns MIME type string
 */
export function getMimeTypeForFormat(format: DetectedFormat | string): string {
  switch (format) {
    case 'csv':
      return 'text/csv'
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case 'txt':
      return 'text/plain'
    case 'json':
      return 'application/json'
    case 'pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

/**
 * Check if a format is supported for export
 * @param format - The format to check
 * @returns true if supported
 */
export function isFormatSupported(format: string): boolean {
  const supportedFormats = ['xlsx', 'csv', 'txt', 'json', 'pdf']
  return supportedFormats.includes(format.toLowerCase())
}
