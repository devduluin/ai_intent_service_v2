// src/utils/timezone.utils.ts

/**
 * Mapping lokasi/daerah ke timezone IANA
 * Bisa ditambah sesuai kebutuhan
 */
const TIMEZONE_MAP: Record<string, string> = {
  // Indonesia - WIB (UTC+7)
  'jakarta': 'Asia/Jakarta',
  'jkt': 'Asia/Jakarta',
  'wib': 'Asia/Jakarta',
  'medan': 'Asia/Jakarta',
  'surabaya': 'Asia/Jakarta',
  'bandung': 'Asia/Jakarta',
  'semarang': 'Asia/Jakarta',
  'yogyakarta': 'Asia/Jakarta',
  'jogja': 'Asia/Jakarta',
  'palembang': 'Asia/Jakarta',
  'pekanbaru': 'Asia/Jakarta',
  'padang': 'Asia/Jakarta',
  'lampung': 'Asia/Jakarta',
  'banten': 'Asia/Jakarta',
  'bekasi': 'Asia/Jakarta',
  'depok': 'Asia/Jakarta',
  'tangerang': 'Asia/Jakarta',
  'bogor': 'Asia/Jakarta',
  
  // Indonesia - WITA (UTC+8)
  'bali': 'Asia/Makassar',
  'makassar': 'Asia/Makassar',
  'wita': 'Asia/Makassar',
  'manado': 'Asia/Makassar',
  'kendari': 'Asia/Makassar',
  'mataram': 'Asia/Makassar',
  'kupang': 'Asia/Makassar',
  'balikpapan': 'Asia/Makassar',
  'samarinda': 'Asia/Makassar',
  'banjarmasin': 'Asia/Makassar',
  'palangkaraya': 'Asia/Makassar',
  'gorontalo': 'Asia/Makassar',
  'palu': 'Asia/Makassar',
  
  // Indonesia - WIT (UTC+9)
  'papua': 'Asia/Jayapura',
  'jayapura': 'Asia/Jayapura',
  'wit': 'Asia/Jayapura',
  'ambon': 'Asia/Jayapura',
  'ternate': 'Asia/Jayapura',
  'tidore': 'Asia/Jayapura',
  'manokwari': 'Asia/Jayapura',
  'sorong': 'Asia/Jayapura',
  'merauke': 'Asia/Jayapura',
  'timika': 'Asia/Jayapura',
  'wamena': 'Asia/Jayapura',
  'biak': 'Asia/Jayapura',
  
  // International - Asia
  'tokyo': 'Asia/Tokyo',
  'japan': 'Asia/Tokyo',
  'singapore': 'Asia/Singapore',
  'singapura': 'Asia/Singapore',
  'kuala lumpur': 'Asia/Kuala_Lumpur',
  'malaysia': 'Asia/Kuala_Lumpur',
  'bangkok': 'Asia/Bangkok',
  'thailand': 'Asia/Bangkok',
  'dubai': 'Asia/Dubai',
  'uae': 'Asia/Dubai',
  'hongkong': 'Asia/Hong_Kong',
  'hong kong': 'Asia/Hong_Kong',
  'seoul': 'Asia/Seoul',
  'korea': 'Asia/Seoul',
  'shanghai': 'Asia/Shanghai',
  'beijing': 'Asia/Shanghai',
  'china': 'Asia/Shanghai',
  'taipei': 'Asia/Taipei',
  'taiwan': 'Asia/Taipei',
  
  // International - America
  'new york': 'America/New_York',
  'nyc': 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  'la': 'America/Los_Angeles',
  'chicago': 'America/Chicago',
  'houston': 'America/Chicago',
  'denver': 'America/Denver',
  'phoenix': 'America/Phoenix',
  'seattle': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles',
  'miami': 'America/New_York',
  'boston': 'America/New_York',
  'washington': 'America/New_York',
  'us': 'America/New_York',
  'america': 'America/New_York',
  'canada': 'America/Toronto',
  'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver',
  'montreal': 'America/Toronto',
  
  // International - Europe
  'london': 'Europe/London',
  'uk': 'Europe/London',
  'inggris': 'Europe/London',
  'paris': 'Europe/Paris',
  'france': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'germany': 'Europe/Berlin',
  'jerman': 'Europe/Berlin',
  'amsterdam': 'Europe/Amsterdam',
  'netherlands': 'Europe/Amsterdam',
  'belanda': 'Europe/Amsterdam',
  'rome': 'Europe/Rome',
  'italy': 'Europe/Rome',
  'italia': 'Europe/Rome',
  'madrid': 'Europe/Madrid',
  'spain': 'Europe/Madrid',
  'spanyol': 'Europe/Madrid',
  'moscow': 'Europe/Moscow',
  'russia': 'Europe/Moscow',
  'rusia': 'Europe/Moscow',
  
  // International - Australia
  'sydney': 'Australia/Sydney',
  'melbourne': 'Australia/Melbourne',
  'brisbane': 'Australia/Brisbane',
  'perth': 'Australia/Perth',
  'adelaide': 'Australia/Adelaide',
  'canberra': 'Australia/Sydney',
  'australia': 'Australia/Sydney',
};

/**
 * Regex untuk mendeteksi format timezone IANA (Region/City)
 * Contoh: Asia/Jakarta, America/New_York, Europe/London
 */
const TIMEZONE_REGEX = /[A-Z][a-z]+(?:_[A-Za-z]+)?\/[A-Za-z_]+(?:\/[A-Za-z_]+)?/;

/**
 * Extract timezone dari text berdasarkan mapping lokasi
 * @param text - User input text
 * @returns Timezone string atau null jika tidak ditemukan
 * 
 * @example
 * extractTimezoneFromText("jam berapa di papua?") // returns "Asia/Jayapura"
 * extractTimezoneFromText("waktu di bali") // returns "Asia/Makassar"
 * extractTimezoneFromText("time in Tokyo") // returns "Asia/Tokyo"
 */
export function extractTimezoneFromText(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lowerText = text.toLowerCase();
  
  // Cek berdasarkan mapping lokasi (prioritas utama)
  for (const [location, timezone] of Object.entries(TIMEZONE_MAP)) {
    if (lowerText.includes(location)) {
      return timezone;
    }
  }
  
  // Cek apakah user langsung menulis format timezone (Asia/Jakarta)
  const match = text.match(TIMEZONE_REGEX);
  if (match) {
    return match[0];
  }
  
  return null;
}

/**
 * Extract timezone dengan tambahan default value
 * @param text - User input text
 * @param defaultValue - Default timezone jika tidak ditemukan
 * @returns Timezone string atau default value
 */
export function extractTimezoneWithDefault(text: string, defaultValue: string): string {
  const extracted = extractTimezoneFromText(text);
  return extracted || defaultValue;
}

/**
 * Cek apakah text mengandung informasi timezone
 * @param text - User input text
 * @returns boolean
 */
export function hasTimezoneInfo(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Cek apakah ada lokasi yang dikenal
  for (const location of Object.keys(TIMEZONE_MAP)) {
    if (lowerText.includes(location)) {
      return true;
    }
  }
  
  // Cek format timezone langsung
  return TIMEZONE_REGEX.test(text);
}

/**
 * Get all available locations (untuk keperluan debugging atau autocomplete)
 */
export function getAvailableLocations(): string[] {
  return Object.keys(TIMEZONE_MAP);
}

/**
 * Get timezone by location name (exact match)
 * @param location - Nama lokasi (case insensitive)
 * @returns Timezone atau null
 */
export function getTimezoneByLocation(location: string): string | null {
  const lowerLocation = location.toLowerCase();
  return TIMEZONE_MAP[lowerLocation] || null;
}