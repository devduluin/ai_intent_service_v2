// ============================================================
// Shared Pattern Definitions for Continuation Detection
// ============================================================
// Extracted from query-decomposition.service.ts and continuation.resolver.ts
// for reuse across continuation analyzers
// ============================================================

// ============================================================
// ENTITY PATTERNS - For entity-only query detection
// ============================================================

export const CITY_NAMES = [
  'jakarta', 'bandung', 'surabaya', 'medan', 'semarang', 'makassar',
  'palembang', 'denpasar', 'yogyakarta', 'lombok', 'batam', 'malang',
  'padang', 'manado', 'pontianak', 'balikpapan', 'samarinda', 'jambi',
  'pekanbaru', 'mataram', 'kupang', 'ambon', 'jayapura', 'gorontalo',
  'kendari', 'ternate', 'palu', 'tasikmalaya', 'cirebon', 'banjarmasin',
  'singkawang', 'bali'
];

export const CITY_PATTERN = new RegExp(
  `\\b(${CITY_NAMES.join('|')})\\b`,
  'i'
);

export const DATE_EXPRESSIONS = [
  // Indonesian
  'hari ini', 'besok', 'lusa', 'kemarin', 'kemarin lusa',
  'minggu ini', 'minggu depan', 'minggu lalu', 'minggu kemarin',
  'bulan ini', 'bulan depan', 'bulan lalu', 'bulan kemarin',
  'tahun ini', 'tahun depan', 'tahun lalu',
  // English
  'today', 'tomorrow', 'yesterday', 'day after tomorrow',
  'this week', 'next week', 'last week',
  'this month', 'next month', 'last month',
  'this year', 'next year', 'last year'
];

export const DATE_PATTERN = new RegExp(
  `\\b(${DATE_EXPRESSIONS.join('|')})\\b`,
  'i'
);

export const EXPORT_FORMATS = [
  'pdf', 'excel', 'xlsx', 'xls', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'json'
];

export const EXPORT_PATTERN = new RegExp(
  `\\b(${EXPORT_FORMATS.join('|')})\\b`,
  'i'
);

export const PERSON_ROLES = [
  'ceo', 'hr', 'manager', 'direktur', 'karyawan', 'staff',
  'atasan', 'bawahan', 'supervisor', 'team lead'
];

export const PERSON_PATTERN = new RegExp(
  `\\b(${PERSON_ROLES.join('|')})\\b`,
  'i'
);

// ============================================================
// CONTEXT REFERENCE PATTERNS
// ============================================================

export const ANAPHORA_PATTERNS = [
  /\byang tadi\b/i,
  /\byang barusan\b/i,
  /\byang sebelumnya\b/i,
  /\byang pertama\b/i,
  /\byang kedua\b/i,
  /\byang terakhir\b/i,
  /\bitu\b/i,
  /\bini\b/i,
  /\bdia\b/i,
  /\bmereka\b/i,
];

export const ELABORATION_PATTERNS = [
  /\blebih.*detail/i,
  /\blebih.*jelas/i,
  /\blebih.*lanjut/i,
  /\btampilkan.*semua/i,
  /\bshow.*all/i,
  /\bapa.*saja/i,
  /\bcoba.*lagi/i,
  /\bulangi/i,
];

export const COMPARISON_PATTERNS = [
  /\bkalau\b/i,
  /\bbagaimana.*dengan\b/i,
  /\bgimana.*dengan\b/i,
  /\bwhat.*about\b/i,
  /\band.*for\b/i,
  /\bfor.*instead/i,
];

export const WORKFLOW_PATTERNS = [
  /\blalu\b/i,
  /\bkemudian\b/i,
  /\bsetelah.*itu/i,
  /\bdan\b/i,
  /\bsetelah.*selesai/i,
  /\btahap.*berikut/i,
  /\bselanjutnya\b/i,
  /\bhabis.*itu/i,
];

// ============================================================
// ACTION PATTERNS (from query-decomposition.service.ts)
// ============================================================

export const ACTION_PATTERNS = [
  /\bcek\b/i,
  /\bcheck\b/i,
  /\bcari\b/i,
  /\bsearch\b/i,
  /\bambil\b/i,
  /\bget\b/i,
  /\btampilkan\b/i,
  /\bshow\b/i,
  /\bbuat(?:kan)?\b/i,
  /\bgenerate\b/i,
  /\bexport\b/i,
  /\bkirim\b/i,
  /\bsend\b/i,
  /\bhitung\b/i,
  /\bcalculate\b/i,
  /\bringkas\b/i,
  /\bsummarize\b/i,
  /\bbandingkan\b/i,
  /\bcompare\b/i,
  /\bubah\b/i,
  /\bconvert\b/i,
  /\btambah(?:kan)?\b/i,
  /\badd\b/i,
];

// ============================================================
// FORMAT PATTERNS (from query-decomposition.service.ts)
// ============================================================

export const FORMAT_PATTERNS: Array<{ key: string; pattern: RegExp }> = [
  { key: 'xlsx', pattern: /\b(excel|xlsx|xls|spreadsheet)\b/i },
  { key: 'csv', pattern: /\b(csv|comma separated)\b/i },
  { key: 'pdf', pattern: /\b(pdf)\b/i },
  { key: 'json', pattern: /\b(json)\b/i },
  { key: 'txt', pattern: /\b(txt|text|plain text)\b/i },
];

// ============================================================
// CONTINUATION TYPE PATTERNS (from continuation.resolver.ts)
// ============================================================

export const CONTINUATION_EXPORT_PATTERNS = [
  /export/i, /download/i, /unduh/i, /save.*excel/i, /save.*pdf/i,
  /simpan.*excel/i, /buat.*file/i, /download.*xlsx/i, /export.*csv/i,
  /export.*excel/i, /jadi.*excel/i, /simpan.*xlsx/i, /buat.*excel/i,
  /xls/i, /xlsx/i, /excel/i, /pdf/i,
];

export const CONTINUATION_REFINE_PATTERNS = [
  /ubah/i, /ganti/i, /modify/i, /update/i, /revisi/i, /edit/i,
  /ganti.*yang.*baru/i,
  /kalau/i,  // "kalau bandung?" pattern
];

export const CONTINUATION_DETAIL_PATTERNS = [
  /detail/i, /lebih.*lanjut/i, /lebih.*jelas/i, /tampilkan.*semua/i,
  /show.*all/i, /apa.*saja/i,
];

export const CONTINUATION_ACTION_PATTERNS = [
  /lanjut/i, /proses/i, /submit/i, /konfirmasi/i, /setuju/i,
  /approve/i, /send/i, /kirim/i,
];

export const CONTINUATION_CLARIFY_PATTERNS = [
  /kenapa/i, /mengapa/i, /bagaimana/i, /apa.*arti/i, /maksudnya/i, /explain/i,
];

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if input matches any of the patterns
 */
export function matchesAnyPattern(
  input: string,
  patterns: RegExp[]
): boolean {
  const lowerInput = input.toLowerCase();
  return patterns.some(pattern => pattern.test(lowerInput));
}

/**
 * Find which pattern matched
 */
export function findMatchingPattern(
  input: string,
  patterns: Array<{ key: string; pattern: RegExp }>
): string | null {
  const lowerInput = input.toLowerCase();
  for (const { key, pattern } of patterns) {
    if (pattern.test(lowerInput)) {
      return key;
    }
  }
  return null;
}

/**
 * Extract entity from input using pattern
 */
export function extractEntity(
  input: string,
  pattern: RegExp
): string | null {
  const match = pattern.exec(input);
  return match ? match[0] : null;
}

/**
 * Count how many patterns matched
 */
export function countPatternMatches(
  input: string,
  patterns: RegExp[]
): number {
  const lowerInput = input.toLowerCase();
  return patterns.filter(pattern => pattern.test(lowerInput)).length;
}

/**
 * Check if query is entity-only (1-2 words)
 */
export function isEntityOnlyQuery(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount <= 2;
}

/**
 * Get pattern confidence based on match type
 */
export function getPatternConfidence(
  matchType: 'exact' | 'partial' | 'weak'
): number {
  switch (matchType) {
    case 'exact':
      return 0.95;
    case 'partial':
      return 0.75;
    case 'weak':
      return 0.50;
    default:
      return 0;
  }
}
