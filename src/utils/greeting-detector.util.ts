import { appLogger } from './logger.util';

// ============================================================
// Greeting Patterns
// ============================================================

export const GREETING_PATTERNS = {
  // Indonesian greetings (NOT including yes/no/what_time/who_are_you)
  indonesian: {
    // Simple greetings
    hello: /^(halo|hai|hei|hello|assalamu alaikum|salam)$/i,
    good_morning: /^(pagi|selamat pagi|pagi pak|pagi bu)$/i,
    good_afternoon: /^(siang|selamat siang)$/i,
    good_evening: /^(malam|selamat malam|selamat malam pak|selamat malam bu)$/i,
    good_night: /^(selamat tidur|good night|gn)$/i,
    how_are_you: /^(apa kabar|apa kabar\?|gimana kabar|bagaimana kabar|kabar apa|how are you)$/i,
    thank_you: /^(?:(?:ok|oke|okay|baik)\s+)?(terimakasih|terima kasih|thanks|thankyou|tq|thx|makasih|makasi)$/i,
    goodbye: /^(bye|goodbye|dada|sampai jumpa|sampai ketemu|sampai nanti|see you|see ya|see u)$/i,
    sorry: /^(maaf|sorry|minta maaf|permisi)$/i,
    please: /^(please|silahkan|tolong|mohon|minta)$/i,
  },
  
  // English greetings (NOT including yes/no)
  english: {
    hello: /^(hello|hi|hey|greetings)$/i,
    how_are_you: /^(how are you|how are you\?|how you doing|how's it going|what's up)$/i,
    thank_you: /^(?:(?:ok|okay|alright)\s+)?(thank you|thanks|thankyou|appreciate it)$/i,
    goodbye: /^(bye|goodbye|see you|see ya|farewell|take care)$/i,
    sorry: /^(sorry|apologize|pardon)$/i,
    please: /^(please|kindly)$/i,
  },
  
  // Confirmation answers (separate from greetings, for pending slots/confirmation)
  confirmation: {
    yes: /^(ya|yes|iya|yup|yep|betul|benar|oke|ok|okay|oké|alright|yeah|sure)$/i,
    no: /^(tidak|no|nggak|enggak|gak|nope|nah|not really)$/i,
  }
};

// ============================================================
// Greeting Detector
// ============================================================

export interface GreetingDetectionResult {
  isGreeting: boolean;
  isConfirmation?: boolean;  // ✅ Separate yes/no as confirmation, not greeting
  type?: 'greeting' | 'thanks' | 'farewell' | 'small_talk' | 'confirmation_yes' | 'confirmation_no';
  confidence: number;
  reason: string;
}

class GreetingDetector {
  /**
   * Detect if query is a greeting/small talk
   * 
   * Key rules:
   * - Short sentences only (max 15 words)
   * - Must match greeting patterns (NOT yes/no/time queries)
   * - No complex queries (no "cek", "buat", "analisis", etc.)
   * - Return confidence score
   * - Separate yes/no as confirmation (for pending slots)
   * 
   * ✅ EXCLUDES:
   * - what_time queries ("jam berapa" = tool query)
   * - who_are_you queries ("siapa" = context query)
   * - yes/no answers (confirmation, not greeting)
   */
  detect(query: string): GreetingDetectionResult {
    const normalized = this.normalizeQuery(query);
    
    // ✅ Rule 1: Length check (max 15 words = usually short greeting)
    const wordCount = normalized.split(/\s+/).length;
    if (wordCount > 15) {
      return {
        isGreeting: false,
        confidence: 0,
        reason: `Too long (${wordCount} words > 15 words limit)`
      };
    }
    
    // ✅ Rule 2: Exclude time queries ("jam berapa", "berapa jam")
    if (/jam berapa|berapa jam|what.{0,3}time/.test(normalized)) {
      return {
        isGreeting: false,
        confidence: 0,
        reason: 'Time query, not greeting (use tool/skill instead)'
      };
    }

    if (this.isCapabilityRequest(normalized)) {
      return {
        isGreeting: true,
        type: 'small_talk',
        confidence: 0.95,
        reason: 'Capability request routed to greeting skill'
      };
    }
    
    // ✅ Rule 3: Check for action keywords (sign of real query, not greeting)
    if (this.hasActionKeywords(normalized)) {
      return {
        isGreeting: false,
        confidence: 0,
        reason: 'Contains action keywords (cek, buat, analisis, etc.)'
      };
    }
    
    // ✅ Rule 4: Match against GREETING patterns
    const greetingMatch = this.matchGreetingPatterns(normalized);
    if (greetingMatch.matched) {
      return {
        isGreeting: true,
        type: greetingMatch.type,
        confidence: greetingMatch.confidence,
        reason: `Matched greeting pattern: ${greetingMatch.type}`
      };
    }
    
    // ✅ Rule 5: Check for greeting-like structure (NOT yes/no)
    const structureScore = this.analyzeGreetingStructure(normalized);
    if (structureScore >= 0.7) {
      return {
        isGreeting: true,
        type: 'small_talk',
        confidence: structureScore,
        reason: `Structure analysis: ${(structureScore * 100).toFixed(0)}% confidence`
      };
    }
    
    return {
      isGreeting: false,
      confidence: 0,
      reason: 'No greeting patterns matched'
    };
  }
  
  /**
   * Detect confirmation answers (yes/no)
   * 
   * Use this ONLY when there's a pending slot/confirmation awaiting
   * Do NOT use this in pre-planner gate
   */
  detectConfirmation(query: string): GreetingDetectionResult | null {
    const normalized = this.normalizeQuery(query);
    
    // Check yes answer
    if ((GREETING_PATTERNS.confirmation as any).yes.test(normalized)) {
      return {
        isGreeting: false,
        isConfirmation: true,
        type: 'confirmation_yes',
        confidence: 0.95,
        reason: 'Matched confirmation: YES'
      };
    }
    
    // Check no answer
    if ((GREETING_PATTERNS.confirmation as any).no.test(normalized)) {
      return {
        isGreeting: false,
        isConfirmation: true,
        type: 'confirmation_no',
        confidence: 0.95,
        reason: 'Matched confirmation: NO'
      };
    }
    
    return null;
  }
  
  /**
   * Normalize query for comparison
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/[.!?]+$/, '')  // Remove trailing punctuation
      .replace(/\s+/g, ' ');   // Normalize whitespace
  }
  
  /**
   * Check for action keywords (sign this is NOT a greeting)
   */
  private hasActionKeywords(query: string): boolean {
    // Exception: thank-you words that contain action keywords as substrings
    const THANK_YOU_EXCEPTIONS = ['terimakasih', 'terima kasih', 'makasih', 'makasi', 'thanks', 'thankyou', 'thank you'];
    if (THANK_YOU_EXCEPTIONS.some(w => query === w || query.includes(w))) {
      return false;
    }

    const ACTION_KEYWORDS = [
      // Action verbs
      'cek', 'check', 'lihat', 'lihatkan', 'tampilkan', 'show', 'display',
      'buat', 'make', 'create', 'tulis', 'write', 'bel', 'sms',
      'hubungi', 'call', 'contact', 'email', 'kirim', 'send',
      'analisis', 'analyze', 'hitung', 'calculate', 'count',
      'bandingkan', 'compare', 'versus', 'dibanding',
      'export', 'download', 'unduh', 'simpan', 'save',
      'coba', 'try', 'test', 'jalankan', 'run', 'execute',
      'berikan', 'give', 'berikan', 'provide', 'kasih',
      
      // Tool/skill names
      'laporan', 'report', 'statistik', 'stats', 'grafik', 'chart',
      'data', 'database', 'sql', 'query', 'list', 'daftar',
      
      // Question words (usually action-oriented)
      'berapa', 'how many', 'how much',
      'mana', 'which', 'yang mana',
      'apa yang', 'what is', 'apa itu',
      
      // Context queries (NOT greetings)
      'siapa', 'who are you', 'nama', 'your name',  // ✅ EXCLUDE: siapa standalone
    ];
    
    return ACTION_KEYWORDS.some(keyword => query.includes(keyword));
  }

  private isCapabilityRequest(query: string): boolean {
    return [
      /(kamu|anda|you).{0,24}(bisa apa|bisa ngapain|kemampuan|capabilit|skill|fitur)/,
      /(apa|sebutkan|jelaskan).{0,24}(kemampuan|capabilit|skill|fitur)/,
      /(kemampuan|capabilit|skill|fitur).{0,24}(lengkap|tersedia|apa saja|apa aja)/,
      /^(bisa apa|kemampuanmu|kemampuan lengkapmu|capabilities|what can you do)$/
    ].some(pattern => pattern.test(query));
  }
  
  /**
   * Match against predefined greeting patterns
   */
  private matchGreetingPatterns(query: string): {
    matched: boolean;
    type?: 'greeting' | 'thanks' | 'farewell' | 'small_talk';
    confidence: number;
  } {
    // Check Indonesian patterns
    for (const [type, pattern] of Object.entries(GREETING_PATTERNS.indonesian)) {
      if (pattern.test(query)) {
        return {
          matched: true,
          type: type as 'greeting' | 'thanks' | 'farewell' | 'small_talk',
          confidence: 0.95  // High confidence for exact pattern match
        };
      }
    }
    
    // Check English patterns
    for (const [type, pattern] of Object.entries(GREETING_PATTERNS.english)) {
      if (pattern.test(query)) {
        return {
          matched: true,
          type: type as 'greeting' | 'thanks' | 'farewell' | 'small_talk',
          confidence: 0.95  // High confidence for exact pattern match
        };
      }
    }
    
    return {
      matched: false,
      confidence: 0
    };
  }
  
  /**
   * Analyze greeting structure (heuristic scoring)
   * 
   * High score if:
   * - Very short (2-4 words)
   * - Common greeting words
   * - Question mark at end
   */
  private analyzeGreetingStructure(query: string): number {
    let score = 0.0;
    
    // ✅ Word count analysis
    const words = query.split(/\s+/);
    if (words.length <= 4) {
      score += 0.3;  // Short = likely greeting
    } else if (words.length <= 10) {
      score += 0.15;
    }
    
    // ✅ Common greeting words
    const COMMON_GREETING_WORDS = [
      'halo', 'hai', 'hello', 'pagi', 'siang', 'malam',
      'apa kabar', 'gimana', 'terimakasih', 'terima kasih', 'makasih', 'bye', 'goodbye',
      'how are you', 'thanks', 'thank you', 'sorry', 'please'
    ];
    
    const hasGreetingWord = COMMON_GREETING_WORDS.some(word => 
      query.includes(word)
    );
    
    if (hasGreetingWord) {
      score += 0.4;
    }
    
    // ✅ Question mark (greeting often questions)
    const hasQuestion = query.endsWith('?') || query.includes('?');
    if (hasQuestion) {
      score += 0.2;
    }
    
    // ✅ Punctuation check (greetings simple, no complex punctuation)
    const complexPunctuation = query.split(/[,;:]/).length - 1;
    if (complexPunctuation === 0) {
      score += 0.1;
    }
    
    return Math.min(score, 1.0);  // Cap at 1.0
  }
}

// ============================================================
// Exports
// ============================================================

export const greetingDetector = new GreetingDetector();
