// ============================================================
// Intent Keyword Resolver
// ============================================================
// Resolves intent keywords from intent metadata (DB)
// Replaces hardcoded keyword mappings
// Features:
// - Lookup from intent metadata
// - Fallback to continuation patterns
// - Fallback to slug extraction
// - Caching for performance
// ============================================================

import { intentRegistry } from '../../intent-registry.service';
import { appLogger } from '../../../utils/logger.util';

// ============================================================
// Types
// ============================================================

export interface IntentKeywordResult {
  intentSlug: string;
  keywords: string[];
  source: 'metadata' | 'patterns' | 'slug' | 'cache';
  confidence: number;
}

export interface IntentKeywordCacheEntry {
  keywords: string[];
  source: string;
  cachedAt: number;
  ttl: number;
}

// ============================================================
// Intent Keyword Resolver
// ============================================================

class IntentKeywordResolver {
  private cache = new Map<string, IntentKeywordCacheEntry>();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 60 minutes

  /**
   * Get keywords for an intent
   * Priority:
   * 1. Keywords from intent metadata (DB)
   * 2. Keywords from continuation patterns
   * 3. Fallback: extract from slug
   */
  async getKeywords(intentSlug: string): Promise<IntentKeywordResult> {
    // Check cache first
    const cached = this.getCached(intentSlug);
    if (cached) {
      return {
        intentSlug,
        keywords: cached,
        source: 'cache',
        confidence: 1.0
      };
    }

    // Try to get intent from registry
    try {
      const intent = await this.getIntentBySlug(intentSlug);
      
      if (intent) {
        // Priority 1: Keywords from metadata
        if (intent.keywords && intent.keywords.length > 0) {
          appLogger.debug('[IntentKeyword] Using metadata keywords', {
            intentSlug,
            keywordCount: intent.keywords.length
          });
          
          this.cacheKeywords(intentSlug, intent.keywords, 'metadata');
          
          return {
            intentSlug,
            keywords: intent.keywords,
            source: 'metadata',
            confidence: 1.0
          };
        }
        
        // Priority 2: Keywords from continuation patterns
        if (intent.continuationPatterns && intent.continuationPatterns.length > 0) {
          appLogger.debug('[IntentKeyword] Using continuation patterns', {
            intentSlug,
            patternCount: intent.continuationPatterns.length
          });
          
          this.cacheKeywords(intentSlug, intent.continuationPatterns, 'patterns');
          
          return {
            intentSlug,
            keywords: intent.continuationPatterns,
            source: 'patterns',
            confidence: 0.8
          };
        }
      }
    } catch (error) {
      appLogger.error('[IntentKeyword] Failed to get intent', {
        intentSlug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Priority 3: Fallback to slug extraction
    const extractedKeywords = this.extractFromSlug(intentSlug);
    
    appLogger.debug('[IntentKeyword] Using slug extraction', {
      intentSlug,
      keywordCount: extractedKeywords.length
    });
    
    this.cacheKeywords(intentSlug, extractedKeywords, 'slug');
    
    return {
      intentSlug,
      keywords: extractedKeywords,
      source: 'slug',
      confidence: 0.5
    };
  }

  /**
   * Get multiple intent keywords in parallel
   */
  async getKeywordsForIntents(intentSlugs: string[]): Promise<Map<string, IntentKeywordResult>> {
    const results = new Map<string, IntentKeywordResult>();
    
    const promises = intentSlugs.map(async (slug) => {
      const result = await this.getKeywords(slug);
      results.set(slug, result);
    });
    
    await Promise.all(promises);
    
    return results;
  }

  /**
   * Clear cache for specific intent
   */
  clearCache(intentSlug: string): void {
    this.cache.delete(intentSlug.toLowerCase());
    appLogger.debug('[IntentKeyword] Cache cleared', {
      intentSlug
    });
  }

  /**
   * Clear all caches
   */
  clearAllCache(): void {
    this.cache.clear();
    appLogger.info('[IntentKeyword] All caches cleared');
  }

  /**
   * Get cached keywords
   */
  private getCached(intentSlug: string): string[] | null {
    const entry = this.cache.get(intentSlug.toLowerCase());
    
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(intentSlug.toLowerCase());
      return null;
    }

    return entry.keywords;
  }

  /**
   * Cache keywords
   */
  private cacheKeywords(intentSlug: string, keywords: string[], source: string): void {
    const entry: IntentKeywordCacheEntry = {
      keywords,
      source,
      cachedAt: Date.now(),
      ttl: this.CACHE_TTL
    };

    this.cache.set(intentSlug.toLowerCase(), entry);
    
    appLogger.debug('[IntentKeyword] Keywords cached', {
      intentSlug,
      source,
      keywordCount: keywords.length,
      ttl: this.CACHE_TTL / 1000 + 's'
    });
  }

  /**
   * Get intent by slug from registry
   */
  private async getIntentBySlug(slug: string): Promise<any> {
    const intents = intentRegistry.getBySlugs([slug]);
    return intents[0] || null;
  }

  /**
   * Extract keywords from intent slug
   * Fallback method when no metadata available
   */
  private extractFromSlug(slug: string): string[] {
    // Split by underscore and filter short words
    const words = slug.split('_').filter(word => word.length > 2);
    
    // Add common variations
    const variations: string[] = [];
    
    for (const word of words) {
      variations.push(word);
      
      // Add English/Indonesian variations for common words
      if (word === 'waktu' || word === 'time') {
        variations.push('jam', 'pukul');
      } else if (word === 'cuaca' || word === 'weather') {
        variations.push('hujan', 'panas', 'cerah');
      } else if (word === 'payroll' || word === 'gaji') {
        variations.push('salary', 'penghasilan');
      } else if (word === 'absen' || word === 'attendance') {
        variations.push('checkin', 'checkout', 'hadir');
      }
    }
    
    // Remove duplicates
    return [...new Set(variations)];
  }
}

// Singleton instance
export const intentKeywordResolver = new IntentKeywordResolver();
