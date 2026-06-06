// ============================================================
// Topic Relevance Service
// ============================================================
// Determines if a user query is relevant to the previous topic
// Uses rule-based scoring (fast path <50ms)
// ============================================================

import { appLogger } from '../../../utils/logger.util';
import { isKnownCity, isKnownDateRef, isKnownTimezone } from '../../../utils/hash.util';

// ============================================================
// Types
// ============================================================

export interface TopicRelevanceCheck {
  isRelevant: boolean;
  score: number;      // 0.0-1.0
  reason: string;
  details: {
    keywordMatch: boolean;
    entityContinuity: boolean;
    semanticScore: number;
  };
}

export interface IntentKeywords {
  [intent: string]: string[];
}

// ============================================================
// Configuration
// ============================================================

const THRESHOLDS = {
  HIGH_RELEVANCE: 0.6,    // Direct continuation (fast path)
  BORDERLINE_LOW: 0.4,    // Below this = not relevant
  BORDERLINE_HIGH: 0.6,   // Between 0.4-0.6 = borderline (future: LLM validation)
};

// Intent keyword mappings for relevance checking
const INTENT_KEYWORDS: IntentKeywords = {
  // Time-related intents
  'get_time': ['jam', 'waktu', 'time', 'pukul', 'tanggal', 'date', 'hari', 'sekarang'],
  
  // Weather-related intents
  'get_weather': ['cuaca', 'weather', 'hujan', 'panas', 'cerah', 'berawan', 'suhu', 'temperatur'],
  
  // Payroll/Finance intents
  'get_payroll': ['payroll', 'gaji', 'salary', 'penghasilan', 'income', 'payslip'],
  
  // Attendance intents
  'attendance': ['absen', 'attendance', 'checkin', 'checkout', 'kehadiran', 'hadir'],
  
  // Leave intents
  'leave': ['cuti', 'leave', 'izin', 'sakit', 'rehat', 'libur'],
  
  // Employee intents
  'employee': ['karyawan', 'employee', 'staff', 'pegawai', 'worker', 'personel'],
  
  // Sales intents
  'sales': ['penjualan', 'sales', 'jualan', 'revenue', 'omzet', 'pendapatan'],
  
  // Generic analysis intents
  'data_analyzer': ['analisa', 'analyze', 'analisis', 'summary', 'ringkas', 'rangkum'],
  
  // Export intents
  'xls_generator': ['export', 'download', 'excel', 'xlsx', 'xls', 'csv', 'pdf'],
};

// ============================================================
// Topic Relevance Service
// ============================================================

class TopicRelevanceService {

  /**
   * Check if current query is relevant to previous topic
   *
   * @param currentQuery - Current user query
   * @param prevIntent - Previous intent slug
   * @param prevEntities - Previous entities from working memory
   * @returns TopicRelevanceCheck result
   */
  async checkTopicRelevance(
    currentQuery: string,
    prevIntent: string,
    prevEntities: Record<string, unknown>
  ): Promise<TopicRelevanceCheck> {
    const normalizedQuery = currentQuery.toLowerCase().trim();

    // 1. Keyword matching with previous intent
    const keywordMatch = this.checkKeywordMatch(normalizedQuery, prevIntent);

    // 2. Entity continuity check
    const entityContinuity = this.checkEntityContinuity(normalizedQuery, prevEntities);

    // 3. Calculate score
    const score = this.calculateScore(keywordMatch, entityContinuity, 0);

    // 4. Determine relevance
    const isRelevant = score >= THRESHOLDS.HIGH_RELEVANCE;

    // 5. Build reason
    const reason = this.buildReason(keywordMatch, entityContinuity, score);

    appLogger.debug('[TopicRelevance] Check completed', {
      query: currentQuery.substring(0, 50),
      prevIntent,
      score,
      isRelevant,
      reason
    });

    return {
      isRelevant,
      score,
      reason,
      details: {
        keywordMatch: keywordMatch.matched,
        entityContinuity: entityContinuity.matched,
        semanticScore: 0  // Reserved for future semantic similarity
      }
    };
  }

  /**
   * Check keyword matching with intent
   */
  private checkKeywordMatch(
    normalizedQuery: string,
    prevIntent: string
  ): { matched: boolean; keywords: string[] } {
    // Get keywords for this intent
    const keywords = this.getIntentKeywords(prevIntent);

    // Check if any keyword appears in query
    const matchedKeywords = keywords.filter(keyword =>
      normalizedQuery.includes(keyword.toLowerCase())
    );

    const matched = matchedKeywords.length > 0;

    return { matched, keywords: matchedKeywords };
  }

  /**
   * Check entity continuity
   * Phase 3 Enhancement: Better detection for "kalau X" pattern even without prevEntities
   */
  private checkEntityContinuity(
    normalizedQuery: string,
    prevEntities: Record<string, unknown>
  ): { matched: boolean; entities: string[] } {
    const matchedEntities: string[] = [];

    // Check for entity value references in prevEntities
    for (const [key, value] of Object.entries(prevEntities)) {
      if (value && typeof value === 'string') {
        const stringValue = value.toLowerCase();
        
        // Check if entity value appears in query
        if (stringValue.length > 2 && normalizedQuery.includes(stringValue)) {
          matchedEntities.push(key);
        }

        // Check for pronoun references
        if (this.hasPronounReference(normalizedQuery)) {
          matchedEntities.push(key);
        }
      }
    }

    // Phase 3 Enhancement: Check for alternative entity patterns ("kalau X", "di X", etc.)
    // Even if prevEntities is empty, detect if query suggests entity substitution
    if (this.hasAlternativeEntity(normalizedQuery, prevEntities)) {
      // Add all existing entity types as matched (we're substituting them)
      matchedEntities.push(...Object.keys(prevEntities));
      
      // If no prevEntities but query has "kalau X" pattern, still mark as continuity
      if (Object.keys(prevEntities).length === 0) {
        matchedEntities.push('entity_substitution');
      }
    }

    const matched = matchedEntities.length > 0;

    return { matched, entities: matchedEntities };
  }

  /**
   * Check if query has pronoun references
   */
  private hasPronounReference(query: string): boolean {
    const pronouns = ['itu', 'ini', 'yang tadi', 'yang tadi', 'tersebut', 'dia', 'mereka'];
    return pronouns.some(pronoun => query.includes(pronoun));
  }

  /**
   * Check if query suggests alternative entity
   * Phase 3 Enhancement: Better detection with entity type validation
   * Example: "kalau bandung?", "bagaimana dengan jakarta?"
   */
  private hasAlternativeEntity(
    query: string,
    prevEntities: Record<string, unknown>
  ): boolean {
    const alternativePatterns = [
      { pattern: /\bkalau\s+(\w+)/i, type: 'alternative' },
      { pattern: /\bbagaimana.*dengan\s+(\w+)/i, type: 'alternative' },
      { pattern: /\bgimana.*dengan\s+(\w+)/i, type: 'alternative' },
      { pattern: /\bwhat.*about\s+(\w+)/i, type: 'alternative' },
      { pattern: /\bdi\s+(\w+)/i, type: 'location' },
      { pattern: /\buntuk\s+(\w+)/i, type: 'date' }
    ];

    for (const { pattern, type } of alternativePatterns) {
      const match = query.match(pattern);
      if (match) {
        const entityValue = match[1].toLowerCase().trim();
        
        // Validate entity based on type
        if (type === 'location' || type === 'alternative') {
          // Check if it's a known city
          if (isKnownCity(entityValue)) {
            return true;
          }
        }
        
        if (type === 'date') {
          // Check if it's a known date reference
          if (isKnownDateRef(entityValue)) {
            return true;
          }
        }
        
        // For "kalau" pattern, also check timezone
        if (type === 'alternative' && isKnownTimezone(entityValue)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get keywords for an intent
   */
  private getIntentKeywords(intentSlug: string): string[] {
    // Try exact match first
    if (INTENT_KEYWORDS[intentSlug]) {
      return INTENT_KEYWORDS[intentSlug];
    }

    // Try partial match (e.g., 'get_payroll_report' → 'get_payroll')
    for (const [key, keywords] of Object.entries(INTENT_KEYWORDS)) {
      if (intentSlug.includes(key) || key.includes(intentSlug)) {
        return keywords;
      }
    }

    // Fallback: extract words from intent slug
    return intentSlug.split('_').filter(word => word.length > 2);
  }

  /**
   * Calculate relevance score
   */
  private calculateScore(
    keywordMatch: { matched: boolean; keywords: string[] },
    entityContinuity: { matched: boolean; entities: string[] },
    semanticScore: number
  ): number {
    let score = 0;

    // Keyword match: 40% weight
    if (keywordMatch.matched) {
      score += 0.4;
      
      // Bonus for multiple keyword matches
      if (keywordMatch.keywords.length > 1) {
        score += 0.1;
      }
    }

    // Entity continuity: 40% weight
    if (entityContinuity.matched) {
      score += 0.4;
      
      // Bonus for multiple entity references
      if (entityContinuity.entities.length > 1) {
        score += 0.1;
      }
    }

    // Semantic similarity: 20% weight (reserved for future)
    if (semanticScore > 0) {
      score += semanticScore * 0.2;
    }

    // Cap at 1.0
    return Math.min(1.0, score);
  }

  /**
   * Build human-readable reason
   */
  private buildReason(
    keywordMatch: { matched: boolean; keywords: string[] },
    entityContinuity: { matched: boolean; entities: string[] },
    score: number
  ): string {
    const reasons: string[] = [];

    if (keywordMatch.matched) {
      reasons.push(`Keyword match: ${keywordMatch.keywords.join(', ')}`);
    }

    if (entityContinuity.matched) {
      reasons.push(`Entity continuity: ${entityContinuity.entities.join(', ')}`);
    }

    if (!keywordMatch.matched && !entityContinuity.matched) {
      reasons.push('No clear connection to previous topic');
    }

    if (score >= THRESHOLDS.HIGH_RELEVANCE) {
      reasons.push('High relevance - direct continuation');
    } else if (score >= THRESHOLDS.BORDERLINE_LOW) {
      reasons.push('Borderline relevance - may need validation');
    } else {
      reasons.push('Low relevance - likely new topic');
    }

    return reasons.join('; ');
  }

  /**
   * Get intent keywords (public utility method)
   */
  getKeywordsForIntent(intentSlug: string): string[] {
    return this.getIntentKeywords(intentSlug);
  }

  /**
   * Check if query contains discussion markers
   * Example: "menurutmu", "bagaimana pendapatmu", "apa saranmu"
   */
  isDiscussionQuery(query: string): boolean {
    const discussionPatterns = [
      /\bmenurut(mu|anda|kamu)\b/i,
      /\bbagaimana.*pendapat(mu|anda|kamu)\b/i,
      /\bapa.*saran(mu|anda|kamu)\b/i,
      /\bapa.*rekomendasi(mu|anda|kamu)\b/i,
      /\bsehat.*tidak\b/i,
      /\bbaik.*tidak\b/i,
      /\bagak.*bagaimana\b/i
    ];

    return discussionPatterns.some(pattern => pattern.test(query));
  }

  /**
   * Get discussion turn limit
   */
  getMaxDiscussionTurns(): number {
    return 10;  // Max 10 turns in same topic before reset
  }
}

// Singleton instance
export const topicRelevanceService = new TopicRelevanceService();
