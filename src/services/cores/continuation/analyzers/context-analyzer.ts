// ============================================================
// Context Analyzer - Detects context references
// ============================================================
// Detects: "yang tadi", "itu", "kalau X?", "lebih detail"
// ============================================================

import {
  ANAPHORA_PATTERNS,
  ELABORATION_PATTERNS,
  COMPARISON_PATTERNS,
  WORKFLOW_PATTERNS,
  matchesAnyPattern,
  CITY_PATTERN,
  getPatternConfidence,
} from '../../../../utils/patterns';

// ============================================================
// Types
// ============================================================

export type ReferenceType = 'anaphora' | 'elaboration' | 'comparison' | 'workflow' | 'unknown';

export interface ContextDetection {
  hasReference: boolean;
  referenceType?: ReferenceType;
  confidence: number;
  targetEntity?: string;  // Extracted entity from comparison (e.g., "bandung" from "kalau bandung?")
  matchedPattern?: string;  // The actual pattern that matched
}

export interface ContextAnalysisResult {
  detection: ContextDetection;
  memoryScore: number;  // 0-1 confidence score
}

// ============================================================
// Context Analyzer
// ============================================================

/**
 * ContextAnalyzer - Detects context references in user input
 *
 * Examples:
 * - "yang tadi mana?" → anaphora reference
 * - "lebih detail" → elaboration request
 * - "kalau bandung?" → comparison with entity
 * - "lalu kirim email" → workflow continuation
 */
export class ContextAnalyzer {
  /**
   * Analyze user input for context references
   */
  analyze(userInput: string): ContextAnalysisResult {
    const detection = this.detectReference(userInput);
    const memoryScore = detection.hasReference ? detection.confidence : 0;

    return {
      detection,
      memoryScore
    };
  }

  /**
   * Detect context reference type
   */
  private detectReference(userInput: string): ContextDetection {
    const lowerInput = userInput.toLowerCase();

    // Check anaphoric references ("yang tadi", "itu", etc.)
    if (matchesAnyPattern(userInput, ANAPHORA_PATTERNS)) {
      const matchedPattern = this.findMatchingPattern(userInput, ANAPHORA_PATTERNS);
      return {
        hasReference: true,
        referenceType: 'anaphora',
        confidence: getPatternConfidence('exact'),
        matchedPattern
      };
    }

    // Check elaboration requests ("lebih detail", "tampilkan semua")
    if (matchesAnyPattern(userInput, ELABORATION_PATTERNS)) {
      const matchedPattern = this.findMatchingPattern(userInput, ELABORATION_PATTERNS);
      return {
        hasReference: true,
        referenceType: 'elaboration',
        confidence: getPatternConfidence('partial'),
        matchedPattern
      };
    }

    // Check comparison/alternative ("kalau X?", "bagaimana dengan Y")
    if (matchesAnyPattern(userInput, COMPARISON_PATTERNS)) {
      const matchedPattern = this.findMatchingPattern(userInput, COMPARISON_PATTERNS);
      
      // Extract entity after "kalau"
      let targetEntity: string | undefined;
      if (/\bkalau\b/i.test(userInput)) {
        const entityMatch = /kalau\s+(\w+)/i.exec(userInput);
        targetEntity = entityMatch ? entityMatch[1] : undefined;
        
        // Also check if it's a city name
        if (!targetEntity) {
          const cityMatch = CITY_PATTERN.exec(userInput);
          targetEntity = cityMatch ? cityMatch[0] : undefined;
        }
      }
      
      return {
        hasReference: true,
        referenceType: 'comparison',
        confidence: getPatternConfidence(targetEntity ? 'exact' : 'partial'),
        targetEntity,
        matchedPattern
      };
    }

    // Check workflow continuation ("lalu", "kemudian", "setelah itu")
    if (matchesAnyPattern(userInput, WORKFLOW_PATTERNS)) {
      const matchedPattern = this.findMatchingPattern(userInput, WORKFLOW_PATTERNS);
      return {
        hasReference: true,
        referenceType: 'workflow',
        confidence: getPatternConfidence('partial'),
        matchedPattern
      };
    }

    // No reference detected
    return {
      hasReference: false,
      confidence: 0
    };
  }

  /**
   * Find which pattern matched
   */
  private findMatchingPattern(
    userInput: string,
    patterns: RegExp[]
  ): string | undefined {
    const lowerInput = userInput.toLowerCase();
    for (const pattern of patterns) {
      if (pattern.test(lowerInput)) {
        return pattern.source;
      }
    }
    return undefined;
  }

  /**
   * Check if input is a pure context reference (no new content)
   */
  isPureContextReference(userInput: string): boolean {
    const normalized = userInput.trim().toLowerCase();
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    
    // Pure context references are typically 1-3 words
    // "yang tadi", "itu aja", "lebih detail", "kalau bandung"
    if (wordCount > 3) {
      return false;
    }
    
    const detection = this.detectReference(userInput);
    return detection.hasReference && detection.confidence >= 0.8;
  }

  /**
   * Extract comparison entity from input
   */
  extractComparisonEntity(userInput: string): string | null {
    // "kalau X?" pattern
    const kalauMatch = /kalau\s+([^\?]+)\??/i.exec(userInput);
    if (kalauMatch) {
      return kalauMatch[1].trim();
    }

    // "bagaimana dengan X?" pattern
    const bagaimanaMatch = /bagaimana\s+dengan\s+([^\?]+)\??/i.exec(userInput);
    if (bagaimanaMatch) {
      return bagaimanaMatch[1].trim();
    }

    // "what about X?" pattern
    const whatMatch = /what\s+about\s+([^\?]+)\??/i.exec(userInput);
    if (whatMatch) {
      return whatMatch[1].trim();
    }

    return null;
  }

  /**
   * Determine if reference implies entity substitution
   */
  impliesEntitySubstitution(detection: ContextDetection): boolean {
    if (!detection.hasReference) {
      return false;
    }

    // Comparison with entity definitely implies substitution
    if (detection.referenceType === 'comparison' && detection.targetEntity) {
      return true;
    }

    // Anaphora might imply looking back at previous entity
    if (detection.referenceType === 'anaphora') {
      return true;
    }

    return false;
  }
}

// Singleton instance
export const contextAnalyzer = new ContextAnalyzer();
