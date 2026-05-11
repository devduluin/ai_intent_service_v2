// src/utils/location.utils.ts

/**
 * Mapping singkatan/nama alternatif ke nama kota/kabupaten/provinsi standar
 */
const CITY_MAP: Record<string, string> = {
  // Jakarta & Sekitarnya
  'jkt': 'Jakarta',
  'jakarta': 'Jakarta',
  'jakpus': 'Jakarta Pusat',
  'jaksel': 'Jakarta Selatan',
  'jakbar': 'Jakarta Barat',
  'jakut': 'Jakarta Utara',
  'jaktim': 'Jakarta Timur',
  'bekasi': 'Bekasi',
  'tangerang': 'Tangerang',
  'tangsel': 'Tangerang Selatan',
  'depok': 'Depok',
  'bogor': 'Bogor',
  'cibubur': 'Cibubur',
  'ciputat': 'Ciputat',
  
  // Jawa Barat
  'bdg': 'Bandung',
  'bandung': 'Bandung',
  'cimahi': 'Cimahi',
  'cianjur': 'Cianjur',
  'sukabumi': 'Sukabumi',
  'garut': 'Garut',
  'tasikmalaya': 'Tasikmalaya',
  'tasik': 'Tasikmalaya',
  'cirebon': 'Cirebon',
  'purwakarta': 'Purwakarta',
  'karawang': 'Karawang',
  'subang': 'Subang',
  'majalengka': 'Majalengka',
  'sumedang': 'Sumedang',
  'indramayu': 'Indramayu',
  'kuningan': 'Kuningan',
  
  // Jawa Tengah
  'smg': 'Semarang',
  'semarang': 'Semarang',
  'solo': 'Surakarta',
  'surakarta': 'Surakarta',
  'yogya': 'Yogyakarta',
  'jogja': 'Yogyakarta',
  'yogyakarta': 'Yogyakarta',
  'magelang': 'Magelang',
  'salatiga': 'Salatiga',
  'pekalongan': 'Pekalongan',
  'tegal': 'Tegal',
  'bredos': 'Brebes',
  'cilacap': 'Cilacap',
  'purwokerto': 'Purwokerto',
  'kudus': 'Kudus',
  'pati': 'Pati',
  'rembang': 'Rembang',
  'blora': 'Blora',
  'jepara': 'Jepara',
  'demak': 'Demak',
  'kendal': 'Kendal',
  'batang': 'Batang',
  'pemalang': 'Pemalang',
  'kebumen': 'Kebumen',
  'banjarnegara': 'Banjarnegara',
  'wonosobo': 'Wonosobo',
  'temanggung': 'Temanggung',
  
  // Jawa Timur
  'sby': 'Surabaya',
  'surabaya': 'Surabaya',
  'malang': 'Malang',
  'kediri': 'Kediri',
  'blitar': 'Blitar',
  'madiun': 'Madiun',
  'ponorogo': 'Ponorogo',
  'ngawi': 'Ngawi',
  'bojonegoro': 'Bojonegoro',
  'tuban': 'Tuban',
  'lamongan': 'Lamongan',
  'gresik': 'Gresik',
  'sidoarjo': 'Sidoarjo',
  'mojokerto': 'Mojokerto',
  'jombang': 'Jombang',
  'nganjuk': 'Nganjuk',
  'trenggalek': 'Trenggalek',
  'tulungagung': 'Tulungagung',
  'batu': 'Batu',
  'pasuruan': 'Pasuruan',
  'probolinggo': 'Probolinggo',
  'situbondo': 'Situbondo',
  'bondowoso': 'Bondowoso',
  'banyuwangi': 'Banyuwangi',
  'jember': 'Jember',
  'lumajang': 'Lumajang',
  'bangil': 'Pasuruan',
  
  // Sumatera
  'medan': 'Medan',
  'belawan': 'Belawan',
  'binjai': 'Binjai',
  'pematangsiantar': 'Pematangsiantar',
  'tanjungbalai': 'Tanjungbalai',
  'tebingtinggi': 'Tebingtinggi',
  'padang': 'Padang',
  'bukittinggi': 'Bukittinggi',
  'payakumbuh': 'Payakumbuh',
  'padangpanjang': 'Padangpanjang',
  'pekanbaru': 'Pekanbaru',
  'dumai': 'Dumai',
  'bengkalis': 'Bengkalis',
  'jambi': 'Jambi',
  'sungai penuh': 'Sungai Penuh',
  'palembang': 'Palembang',
  'lubuklinggau': 'Lubuklinggau',
  'prabumulih': 'Prabumulih',
  'pageralam': 'Pageralam',
  'bandar lampung': 'Bandar Lampung',
  'metro': 'Metro',
  'pangkalpinang': 'Pangkalpinang',
  'batam': 'Batam',
  'tanjungpinang': 'Tanjungpinang',
  'bintan': 'Bintan',
  
  // Kalimantan
  'pontianak': 'Pontianak',
  'singkawang': 'Singkawang',
  'palangkaraya': 'Palangkaraya',
  'balikpapan': 'Balikpapan',
  'samarinda': 'Samarinda',
  'bontang': 'Bontang',
  'tarakan': 'Tarakan',
  'banjarbaru': 'Banjarbaru',
  'banjarmasin': 'Banjarmasin',
  
  // Sulawesi
  'makassar': 'Makassar',
  'mks': 'Makassar',
  'upg': 'Makassar',
  'parepare': 'Parepare',
  'palopo': 'Palopo',
  'manado': 'Manado',
  'bitung': 'Bitung',
  'tomohon': 'Tomohon',
  'kotamobagu': 'Kotamobagu',
  'palu': 'Palu',
  'kendari': 'Kendari',
  'baubau': 'Baubau',
  'gorontalo': 'Gorontalo',
  
  // Bali & Nusa Tenggara
  'denpasar': 'Denpasar',
  'dps': 'Denpasar',
  'badung': 'Badung',
  'gianyar': 'Gianyar',
  'bangli': 'Bangli',
  'klungkung': 'Klungkung',
  'karangasem': 'Karangasem',
  'buleleng': 'Buleleng',
  'singaraja': 'Singaraja',
  'mataram': 'Mataram',
  'kupang': 'Kupang',
  
  // Maluku & Papua
  'ambon': 'Ambon',
  'ternate': 'Ternate',
  'tidore': 'Tidore',
  'jayapura': 'Jayapura',
  'manokwari': 'Manokwari',
  'sorong': 'Sorong',
  'merauke': 'Merauke',
};

/**
 * Mapping provinsi ke ibukota (untuk resolusi lokasi)
 */
const PROVINCE_CAPITAL_MAP: Record<string, string> = {
  'aceh': 'Banda Aceh',
  'sumatera utara': 'Medan',
  'sumatera barat': 'Padang',
  'riau': 'Pekanbaru',
  'kepulauan riau': 'Tanjungpinang',
  'jambi': 'Jambi',
  'bengkulu': 'Bengkulu',
  'sumatera selatan': 'Palembang',
  'kepulauan bangka belitung': 'Pangkalpinang',
  'lampung': 'Bandar Lampung',
  'banten': 'Serang',
  'dki jakarta': 'Jakarta',
  'jawa barat': 'Bandung',
  'jawa tengah': 'Semarang',
  'di yogyakarta': 'Yogyakarta',
  'jawa timur': 'Surabaya',
  'bali': 'Denpasar',
  'nusa tenggara barat': 'Mataram',
  'nusa tenggara timur': 'Kupang',
  'kalimantan barat': 'Pontianak',
  'kalimantan tengah': 'Palangkaraya',
  'kalimantan selatan': 'Banjarmasin',
  'kalimantan timur': 'Samarinda',
  'kalimantan utara': 'Tanjung Selor',
  'sulawesi utara': 'Manado',
  'sulawesi tengah': 'Palu',
  'sulawesi selatan': 'Makassar',
  'sulawesi tenggara': 'Kendari',
  'gorontalo': 'Gorontalo',
  'sulawesi barat': 'Mamuju',
  'maluku': 'Ambon',
  'maluku utara': 'Sofifi',
  'papua': 'Jayapura',
  'papua barat': 'Manokwari',
  'papua tengah': 'Nabire',
  'papua pegunungan': 'Wamena',
  'papua selatan': 'Merauke',
};

/**
 * Regex untuk mendeteksi format lokasi
 */
const LOCATION_REGEX = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g;

/**
 * Extract lokasi dari text (kota/kabupaten/provinsi)
 * @param text - User input text
 * @returns Nama lokasi yang sudah dinormalisasi atau null
 * 
 * @example
 * extractLocation("cuaca di jkt") // returns "Jakarta"
 * extractLocation("info banjir bandung") // returns "Bandung"
 * extractLocation("jam di papua") // returns null (ini untuk timezone)
 */
export function extractLocation(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lowerText = text.toLowerCase();
  
  // Cek berdasarkan mapping kota (prioritas utama)
  for (const [alias, city] of Object.entries(CITY_MAP)) {
    // Gunakan word boundary agar tidak salah deteksi
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(text)) {
      return city;
    }
    
    // Juga cek tanpa word boundary untuk kasus seperti "jakpus"
    if (lowerText.includes(alias.toLowerCase())) {
      return city;
    }
  }
  
  // Cek apakah user langsung menulis nama kota dengan huruf besar
  const match = text.match(LOCATION_REGEX);
  if (match) {
    // Validasi apakah nama tersebut ada di CITY_MAP
    for (const city of match) {
      const normalized = getCanonicalCityName(city);
      if (normalized) {
        return normalized;
      }
    }
  }
  
  return null;
}

/**
 * Extract provinsi dari text
 * @param text - User input text
 * @returns Nama provinsi yang sudah dinormalisasi atau null
 * 
 * @example
 * extractProvince("jawa barat") // returns "Jawa Barat"
 * extractProvince("Jateng") // returns "Jawa Tengah"
 */
export function extractProvince(text: string): string | null {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  const lowerText = text.toLowerCase();
  
  const provinceMap: Record<string, string> = {
    'aceh': 'Aceh',
    'sumut': 'Sumatera Utara',
    'sumatera utara': 'Sumatera Utara',
    'sumbar': 'Sumatera Barat',
    'sumatera barat': 'Sumatera Barat',
    'riau': 'Riau',
    'kepri': 'Kepulauan Riau',
    'kepulauan riau': 'Kepulauan Riau',
    'jambi': 'Jambi',
    'bengkulu': 'Bengkulu',
    'sumsel': 'Sumatera Selatan',
    'sumatera selatan': 'Sumatera Selatan',
    'babel': 'Kepulauan Bangka Belitung',
    'bangka belitung': 'Kepulauan Bangka Belitung',
    'lampung': 'Lampung',
    'banten': 'Banten',
    'dki': 'DKI Jakarta',
    'jakarta': 'DKI Jakarta',
    'jabar': 'Jawa Barat',
    'jawa barat': 'Jawa Barat',
    'jateng': 'Jawa Tengah',
    'jawa tengah': 'Jawa Tengah',
    'jogja': 'DI Yogyakarta',
    'yogyakarta': 'DI Yogyakarta',
    'jatim': 'Jawa Timur',
    'jawa timur': 'Jawa Timur',
    'bali': 'Bali',
    'ntb': 'Nusa Tenggara Barat',
    'nusa tenggara barat': 'Nusa Tenggara Barat',
    'ntt': 'Nusa Tenggara Timur',
    'nusa tenggara timur': 'Nusa Tenggara Timur',
    'kalbar': 'Kalimantan Barat',
    'kalimantan barat': 'Kalimantan Barat',
    'kalteng': 'Kalimantan Tengah',
    'kalimantan tengah': 'Kalimantan Tengah',
    'kalsel': 'Kalimantan Selatan',
    'kalimantan selatan': 'Kalimantan Selatan',
    'kaltim': 'Kalimantan Timur',
    'kalimantan timur': 'Kalimantan Timur',
    'kalimantan utara': 'Kalimantan Utara',
    'sulut': 'Sulawesi Utara',
    'sulawesi utara': 'Sulawesi Utara',
    'sulteng': 'Sulawesi Tengah',
    'sulawesi tengah': 'Sulawesi Tengah',
    'sulsel': 'Sulawesi Selatan',
    'sulawesi selatan': 'Sulawesi Selatan',
    'sultra': 'Sulawesi Tenggara',
    'sulawesi tenggara': 'Sulawesi Tenggara',
    'gorontalo': 'Gorontalo',
    'sulbar': 'Sulawesi Barat',
    'sulawesi barat': 'Sulawesi Barat',
    'maluku': 'Maluku',
    'malut': 'Maluku Utara',
    'maluku utara': 'Maluku Utara',
    'papua': 'Papua',
    'papua barat': 'Papua Barat',
  };
  
  for (const [alias, province] of Object.entries(provinceMap)) {
    if (lowerText.includes(alias)) {
      return province;
    }
  }
  
  return null;
}

/**
 * Extract ibukota provinsi dari nama provinsi
 * @param province - Nama provinsi
 * @returns Nama ibukota atau null
 * 
 * @example
 * getProvinceCapital("Jawa Barat") // returns "Bandung"
 */
export function getProvinceCapital(province: string): string | null {
  const lowerProvince = province.toLowerCase();
  for (const [prov, capital] of Object.entries(PROVINCE_CAPITAL_MAP)) {
    if (lowerProvince.includes(prov)) {
      return capital;
    }
  }
  return null;
}

/**
 * Resolve lokasi ke bentuk kanonik (bisa kota atau provinsi)
 * @param text - User input text
 * @returns Objek berisi tipe dan nama lokasi
 * 
 * @example
 * resolveLocation("bandung") // returns { type: 'city', name: 'Bandung' }
 */
export function resolveLocation(text: string): { type: 'city' | 'province' | 'country'; name: string } | null {
  // Cek kota dulu
  const city = extractLocation(text);
  if (city) {
    return { type: 'city', name: city };
  }
  
  // Cek provinsi
  const province = extractProvince(text);
  if (province) {
    return { type: 'province', name: province };
  }
  
  // Cek negara (bisa ditambahkan nanti)
  // const country = extractCountry(text);
  // if (country) return { type: 'country', name: country };
  
  return null;
}

/**
 * Dapatkan nama kota kanonik dari berbagai variasi
 * @param name - Nama kota yang mungkin tidak standar
 * @returns Nama kota standar atau null
 */
export function getCanonicalCityName(name: string): string | null {
  const lowerName = name.toLowerCase();
  
  // Langsung cek di CITY_MAP
  for (const [alias, city] of Object.entries(CITY_MAP)) {
    if (lowerName === alias.toLowerCase() || lowerName.includes(alias.toLowerCase())) {
      return city;
    }
  }
  
  // Jika nama sudah standar, return as-is
  if (Object.values(CITY_MAP).some(city => city.toLowerCase() === lowerName)) {
    return name;
  }
  
  return null;
}

/**
 * Cek apakah text mengandung informasi lokasi
 * @param text - User input text
 * @returns boolean
 */
export function hasLocationInfo(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // Cek city mapping
  for (const alias of Object.keys(CITY_MAP)) {
    if (lowerText.includes(alias)) {
      return true;
    }
  }
  
  // Cek province mapping  
  const provinceAliases = ['jabar', 'jateng', 'jatim', 'sumut', 'sumbar', 'sumsel'];
  for (const alias of provinceAliases) {
    if (lowerText.includes(alias)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get all available cities (untuk keperluan debugging atau autocomplete)
 */
export function getAllCities(): string[] {
  return [...new Set(Object.values(CITY_MAP))];
}

/**
 * Get all available provinces
 */
export function getAllProvinces(): string[] {
  return [...new Set(Object.keys(PROVINCE_CAPITAL_MAP).map(p => {
    return p.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }))];
}

/**
 * Normalisasi jarak antar lokasi (dummy untuk sekarang, bisa diintegrasi dengan API distance matrix)
 */
export function getDistance(from: string, to: string): number | null {
  // Ini bisa diimplementasikan dengan Google Maps API atau lainnya
  // Sementara return null
  return null;
}