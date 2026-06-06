const GENERIC_DESIRE_WORDS = [
  'ingin',
  'mau',
  'pengen',
  'butuh',
  'perlu',
  'want',
  'wanna',
  'need'
];

const TEMPORAL_PHRASES = [
  'hari ini',
  'kemarin',
  'besok',
  'lusa',
  'minggu ini',
  'minggu lalu',
  'minggu depan',
  'bulan ini',
  'bulan lalu',
  'bulan depan',
  'tahun ini',
  'tahun lalu',
  'tahun depan',
  'today',
  'yesterday',
  'tomorrow',
  'this week',
  'last week',
  'next week',
  'this month',
  'last month',
  'next month',
  'this year',
  'last year',
  'next year'
];

const TEMPORAL_FOLLOW_UP_FILLERS = [
  'saya',
  'aku',
  'ingin',
  'mau',
  'pengen',
  'butuh',
  'perlu',
  'lihat',
  'tampilkan',
  'cek',
  'data',
  'yang',
  'untuk',
  'di',
  'pada',
  'kalau',
  'coba',
  'dong',
  'aja',
  'saja',
  'status',
  'dengan',
  'lagi',
  'sebelumnya',
  'berikutnya',
  'i',
  'me',
  'want',
  'wanna',
  'need',
  'check',
  'show',
  'see',
  'view',
  'display',
  'please',
  'the',
  'same',
  'data',
  'status',
  'now'
];

const CANCELLATION_WORDS = [
  'batal',
  'batalkan',
  'jangan',
  'hapus',
  'cancel',
  'tidak',
  'nggak',
  'gak',
  'ga',
  'no'
];

const CANCELLATION_QUALIFIERS = [
  'saja',
  'aja',
  'draft',
  'itu',
  'sebelumnya'
];

const CONFIRM_DELETE_WORDS = [
  'hapus',
  'ya hapus',
  'iya hapus',
  'ok hapus',
  'oke hapus',
  'lanjut hapus'
];

const EXIT_MODE_WORDS = [
  'exit',
  'keluar',
  'kluar',
  'close',
  'tutup'
];

export function normalizeIntentText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s/.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripGenericDesireWords(value: unknown): string {
  const desirePattern = new RegExp(`\\b(${GENERIC_DESIRE_WORDS.join('|')})\\b`, 'gi');
  return String(value || '')
    .replace(desirePattern, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGenericDesireText(value: unknown): boolean {
  const normalized = normalizeIntentText(value);
  if (!normalized) return true;

  const desirePattern = `(?:${GENERIC_DESIRE_WORDS.join('|')})`;
  return new RegExp(`^(?:saya\\s+|aku\\s+|i\\s+)?${desirePattern}$`, 'i').test(normalized);
}

export function buildTemporalFollowUpResidue(value: unknown): string {
  let text = normalizeIntentText(value);

  for (const phrase of TEMPORAL_PHRASES) {
    text = text.replace(new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi'), ' ');
  }

  text = text
    .replace(/\b(?:tanggal|tgl|date)\s+\d{1,2}\b/gi, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[.-]\d{1,2}[.-]\d{2,4}\b/g, ' ');

  const fillerPattern = new RegExp(`\\b(${TEMPORAL_FOLLOW_UP_FILLERS.map(escapeRegex).join('|')})\\b`, 'gi');
  return text
    .replace(fillerPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCancellationText(value: unknown): boolean {
  const normalized = normalizeIntentText(value).replace(/[/.:-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const cancelPattern = CANCELLATION_WORDS.map(escapeRegex).join('|');
  const qualifierPattern = CANCELLATION_QUALIFIERS.map(escapeRegex).join('|');
  return new RegExp(`^(?:${cancelPattern})(?:\\s+(?:${qualifierPattern}))?$`, 'i').test(normalized);
}

export function isConfirmDeleteText(value: unknown): boolean {
  const normalized = normalizeIntentText(value).replace(/[/.:-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  return CONFIRM_DELETE_WORDS.some(word => normalized === word);
}

export function isExitModeText(value: unknown, modeNames: string[] = []): boolean {
  const normalized = normalizeIntentText(value).replace(/[/.:-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const exitPattern = EXIT_MODE_WORDS.map(escapeRegex).join('|');
  const modePattern = ['mode', ...modeNames]
    .filter(Boolean)
    .map(item => escapeRegex(normalizeIntentText(item).replace(/[/.:-]+/g, ' ').trim()))
    .join('|');

  return new RegExp(`^(?:${exitPattern})(?:\\s+(?:${modePattern}))?$`, 'i').test(normalized);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
