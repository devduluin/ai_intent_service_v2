// ============================================================
// Emotion Detector — Multi-Language Emotion Classification
// ============================================================
// Detects user emotional state from text input.
// Supports Indonesian (id) and English (en), extensible.
// Regex-based, 0ms latency, no LLM dependency.
//
// States: neutral | frustrated | confused | satisfied | urgent
// ============================================================

// ============================================================
// Types
// ============================================================

export type EmotionState = 'neutral' | 'frustrated' | 'confused' | 'satisfied' | 'urgent';

export interface EmotionResult {
  emotion: EmotionState;
  confidence: number;
  intensity: number;       // 0-1, seberapa kuat emosi
  signals: string[];       // kata/frasa yang terdeteksi
  language: 'id' | 'en';
}

export interface EmotionContext {
  isRetry?: boolean;       // user sudah coba >1x?
  hadError?: boolean;      // response sebelumnya error?
}

// ============================================================
// Multi-Language Emotion Patterns
// ============================================================

interface EmotionPattern {
  regex: RegExp;
  emotion: EmotionState;
  confidence: number;
  intensity: number;
}

const FRUSTRATION_PATTERNS: Record<string, EmotionPattern[]> = {
  id: [
    { regex: /\b(kok|lah|sih|deh|nih)\b.*\b(error|gagal|ga bisa|nggak bisa|tidak bisa|rusak)\b/i, emotion: 'frustrated', confidence: 0.88, intensity: 0.8 },
    { regex: /\b(error|gagal|ga bisa)\b.*\b(lagi|terus|muluk|selalu)\b/i, emotion: 'frustrated', confidence: 0.85, intensity: 0.75 },
    { regex: /\b(sudah|udah)\s+(\d+)\s*(x|kali|kali loh)\b/i, emotion: 'frustrated', confidence: 0.82, intensity: 0.7 },
    { regex: /[!]{2,}/, emotion: 'frustrated', confidence: 0.75, intensity: 0.6 },
    { regex: /\b(kenapa sih|aneh|payah|jelek|buset|ngaco|kacau|cape deh)\b/i, emotion: 'frustrated', confidence: 0.80, intensity: 0.65 },
    { regex: /\b(coba\s+lagi|ulangi|repeat)\b.*\b(gagal|error|ga bisa)\b/i, emotion: 'frustrated', confidence: 0.83, intensity: 0.7 },
  ],
  en: [
    { regex: /\b(why|what)\b.*\b(error|fail|broken|not working|doesn't work)\b.*[!?]/i, emotion: 'frustrated', confidence: 0.88, intensity: 0.8 },
    { regex: /\b(error|fail|bug)\b.*\b(again|still|always|keeps?)\b/i, emotion: 'frustrated', confidence: 0.85, intensity: 0.75 },
    { regex: /\b(tried|trying)\s+(\d+)\s*(times|x)\b/i, emotion: 'frustrated', confidence: 0.82, intensity: 0.7 },
    { regex: /\b(this is|that's?)\s+(stupid|ridiculous|useless|broken|crap)\b/i, emotion: 'frustrated', confidence: 0.80, intensity: 0.8 },
    { regex: /\b(come on|seriously|for real|wtf|omg)\b/i, emotion: 'frustrated', confidence: 0.78, intensity: 0.75 },
  ],
};

const CONFUSION_PATTERNS: Record<string, EmotionPattern[]> = {
  id: [
    { regex: /\b(maksudnya|maksud|gimana|bagaimana|caranya)\b.*\b(sih|ya|yah|nih)\b/i, emotion: 'confused', confidence: 0.85, intensity: 0.6 },
    { regex: /\b(gak ngerti|nggak ngerti|bingung|pusing|ga paham|nggak paham)\b/i, emotion: 'confused', confidence: 0.88, intensity: 0.7 },
    { regex: /\b(apa sih|apaan|hah|huh|loh|lah)\b/i, emotion: 'confused', confidence: 0.75, intensity: 0.5 },
    { regex: /\b(bisa tolong jelaskan|jelasin dong|tolong jelasin)\b/i, emotion: 'confused', confidence: 0.82, intensity: 0.55 },
    { regex: /\b(ko[gk]?|nggak?)\s+(ngerti|paham|tau|tahu)\b/i, emotion: 'confused', confidence: 0.85, intensity: 0.65 },
  ],
  en: [
    { regex: /\b(what do you mean|i don't understand|i'm confused|confused|don't get it)\b/i, emotion: 'confused', confidence: 0.88, intensity: 0.7 },
    { regex: /\b(can you explain|explain that|elaborate|clarify)\b/i, emotion: 'confused', confidence: 0.82, intensity: 0.55 },
    { regex: /\b(huh|what|hmm|um+)\b/i, emotion: 'confused', confidence: 0.72, intensity: 0.45 },
    { regex: /\b(i don't follow|not following|lost me|over my head)\b/i, emotion: 'confused', confidence: 0.85, intensity: 0.6 },
  ],
};

const SATISFACTION_PATTERNS: Record<string, EmotionPattern[]> = {
  id: [
    { regex: /\b(makasih|terima kasih|thanks).*\b(sangat|sekali|banget|good|bagus|keren|mantap|perfect|oke punya|membantu|helpful)\b/i, emotion: 'satisfied', confidence: 0.90, intensity: 0.8 },
    { regex: /\b(kerja bagus|good job|well done|perfect|sempurna|mantap|oke banget)\b/i, emotion: 'satisfied', confidence: 0.88, intensity: 0.85 },
    { regex: /\b(akhirnya|nah gitu dong|baru bener|nah kan|betul)\b/i, emotion: 'satisfied', confidence: 0.80, intensity: 0.7 },
    { regex: /\b(sip|oke|ok|baik|bagus|mantap)\s*(banget|deh|nih|sih)\b/i, emotion: 'satisfied', confidence: 0.78, intensity: 0.6 },
  ],
  en: [
    { regex: /\b(thank you|thanks).*\b(so much|very|really|awesome|great|perfect|amazing)\b/i, emotion: 'satisfied', confidence: 0.90, intensity: 0.8 },
    { regex: /\b(great job|awesome|perfect|excellent|brilliant|love it)\b/i, emotion: 'satisfied', confidence: 0.88, intensity: 0.85 },
    { regex: /\b(finally|at last|that's more like it|now we're talking)\b/i, emotion: 'satisfied', confidence: 0.80, intensity: 0.7 },
    { regex: /\b(nice|sweet|cool|neat)\s*(one|work|job)?\b/i, emotion: 'satisfied', confidence: 0.75, intensity: 0.55 },
  ],
};

const URGENCY_PATTERNS: Record<string, EmotionPattern[]> = {
  id: [
    { regex: /\b(urgent|emergency|darurat|genting|sekarang juga|cepat|buruan|asap|stat|mendesak)\b/i, emotion: 'urgent', confidence: 0.92, intensity: 0.85 },
    { regex: /\b(tolong|help|minta tolong)\b.*\b(sekarang|cepat|urgent|genting)\b/i, emotion: 'urgent', confidence: 0.90, intensity: 0.8 },
    { regex: /\b(jangan\s+lama|nanti\s+telat|kehabisan\s+waktu|deadline)\b/i, emotion: 'urgent', confidence: 0.82, intensity: 0.7 },
  ],
  en: [
    { regex: /\b(urgent|emergency|critical|asap|stat|immediately|right now)\b/i, emotion: 'urgent', confidence: 0.92, intensity: 0.85 },
    { regex: /\b(help|please).*\b(now|quick|fast|immediately|asap)\b/i, emotion: 'urgent', confidence: 0.90, intensity: 0.8 },
    { regex: /\b(running out of time|deadline|no time|hurry)\b/i, emotion: 'urgent', confidence: 0.82, intensity: 0.7 },
    { regex: /\b(don't have time|need this now|drop everything)\b/i, emotion: 'urgent', confidence: 0.85, intensity: 0.75 },
  ],
};

// ============================================================
// Detection
// ============================================================

function detectLanguage(text: string): 'id' | 'en' {
  const normalized = text.toLowerCase();
  const idMarkers = /\b(saya|aku|gua|gue|kamu|anda|ini|itu|yang|dengan|atau|tidak|bisa|ada|sih|deh|kok|lah|dong|kan|ya|nih|makasih|terima kasih|membantu|bingung|maksudnya|gimana|cepat|darurat)\b/i;
  const strongIdMarkers = /\b(makasih|terima kasih|membantu|bingung|maksudnya|gimana|cepat|darurat|sih|dong)\b/i;
  const idCount = (normalized.match(new RegExp(idMarkers.source, 'gi')) || []).length;
  return strongIdMarkers.test(normalized) || idCount >= 2 ? 'id' : 'en';
}

export function detectEmotion(text: string, context?: EmotionContext): EmotionResult {
  const language = detectLanguage(text);
  const urgentUppercase = detectUrgentUppercase(text);

  // Context-based: retry + error → frustration (highest priority)
  if (context?.isRetry && context?.hadError) {
    return {
      emotion: 'frustrated',
      confidence: 0.82,
      intensity: 0.7,
      signals: ['retry_after_error'],
      language,
    };
  }

  if (urgentUppercase) {
    return {
      emotion: 'urgent',
      confidence: 0.88,
      intensity: urgentUppercase.intensity,
      signals: [urgentUppercase.signal],
      language,
    };
  }

  // Check each emotion category in priority order: urgent > frustrated > confused > satisfied
  const categoryPatterns: Array<{ patterns: Record<string, EmotionPattern[]>; overrideIntensity?: boolean }> = [
    { patterns: URGENCY_PATTERNS },
    { patterns: FRUSTRATION_PATTERNS },
    { patterns: CONFUSION_PATTERNS },
    { patterns: SATISFACTION_PATTERNS },
  ];

  for (const category of categoryPatterns) {
    const langPatterns = category.patterns[language] || category.patterns['en'];
    for (const pattern of langPatterns) {
      if (pattern.regex.test(text)) {
        return {
          emotion: pattern.emotion,
          confidence: pattern.confidence,
          intensity: pattern.intensity,
          signals: [text.match(pattern.regex)?.[0] || ''],
          language,
        };
      }
    }
  }

  return { emotion: 'neutral', confidence: 1.0, intensity: 0, signals: [], language };
}

function detectUrgentUppercase(text: string): { signal: string; intensity: number } | null {
  const value = String(text || '');
  const uppercaseWords = value.match(/\b[A-Z]{3,}\b/g) || [];
  if (uppercaseWords.length === 0) return null;

  const operationalAcronyms = new Set([
    'PNL',
    'XLS',
    'XLSX',
    'CSV',
    'PDF',
    'API',
    'HRIS',
    'DB',
    'SQL',
    'JSON',
    'UUID',
  ]);
  const meaningfulUppercase = uppercaseWords.filter(word => !operationalAcronyms.has(word));
  if (meaningfulUppercase.length === 0) return null;

  const hasUrgencyWord = /\b(TOLONG|CEPAT|URGENT|DARURAT|EMERGENCY|ASAP|HELP)\b/i.test(value);
  const hasExclamation = /!{1,}/.test(value);
  const shoutingRatio = uppercaseWords.join('').length / Math.max(1, value.replace(/\s/g, '').length);

  if (!hasUrgencyWord && !hasExclamation && shoutingRatio < 0.55) return null;

  return {
    signal: meaningfulUppercase.slice(0, 3).join(' '),
    intensity: hasUrgencyWord ? 0.9 : 0.75,
  };
}

// ============================================================
// Emotion-Aware Response Templates
// ============================================================

interface EmotionTemplate {
  prefix: string;
  closing: string;
  tone: 'empathetic' | 'simplified' | 'direct' | 'appreciative' | 'neutral';
}

const EMOTION_TEMPLATES: Record<EmotionState, Record<string, EmotionTemplate>> = {
  frustrated: {
    id: {
      prefix: 'Saya paham ini menjengkelkan.',
      closing: 'Sementara itu, ada yang bisa saya bantu dengan cara lain?',
      tone: 'empathetic',
    },
    en: {
      prefix: 'I understand this is frustrating.',
      closing: 'Is there another way I can help in the meantime?',
      tone: 'empathetic',
    },
  },
  confused: {
    id: {
      prefix: 'Saya jelaskan lebih detail ya.',
      closing: 'Kalau masih belum jelas, tanyakan lagi.',
      tone: 'simplified',
    },
    en: {
      prefix: 'Let me explain in more detail.',
      closing: 'Feel free to ask if anything is still unclear.',
      tone: 'simplified',
    },
  },
  satisfied: {
    id: {
      prefix: 'Senang bisa membantu!',
      closing: 'Kalau ada yang lain, saya di sini.',
      tone: 'appreciative',
    },
    en: {
      prefix: 'Happy to help!',
      closing: 'I\'m here if you need anything else.',
      tone: 'appreciative',
    },
  },
  urgent: {
    id: {
      prefix: 'Saya proses secepat mungkin.',
      closing: '',
      tone: 'direct',
    },
    en: {
      prefix: 'Processing this as quickly as possible.',
      closing: '',
      tone: 'direct',
    },
  },
  neutral: {
    id: { prefix: '', closing: '', tone: 'neutral' },
    en: { prefix: '', closing: '', tone: 'neutral' },
  },
};

export function getEmotionTemplate(emotion: EmotionState, language: 'id' | 'en'): EmotionTemplate {
  return EMOTION_TEMPLATES[emotion][language] || EMOTION_TEMPLATES.neutral[language];
}
