// ============================================================
// PerceptionStage — V1 Deterministic Intent Frame Detection
// ============================================================
// Interprets user query + decomposition signals into a structured
// PerceptionFrame before the planner runs.
//
// V1 is rule-based / deterministic. LLM will be added later for
// ambiguous or low-confidence frames.
// ============================================================

import { greetingDetector } from '../../../utils/greeting-detector.util';
import { skillsRegistry } from '../../skills-registry.service';
import { appLogger } from '../../../utils/logger.util';
import { classifyDeterministicOfferResponse } from '../../../utils/offer-response-classifier.util';
import { detectEmotion } from '../../../utils/emotion-detector.util';
import type {
  PerceptionFrame,
  PerceptionIntentType,
  PerceptionOperation,
  PerceptionStageInput,
  PerceptionStageResult
} from '../../../types/perception.types';
import type { UserMessageSignals } from '../../query-decomposition.service';
import type { WorkingMemoryData } from '../../../types/working-memory.type';

// ============================================================
// Constants
// ============================================================

/** Below this confidence, frame defaults to unknown */
const MIN_CONFIDENCE_THRESHOLD = 0.50;

/** Confidence for perfect pattern matches */
const HIGH_CONFIDENCE = 0.92;

/** Confidence for partial / single-signal matches */
const MEDIUM_CONFIDENCE = 0.80;

/** Confidence for weak / heuristic matches */
const LOW_CONFIDENCE = 0.65;

/** Whether to skip embedding for high-confidence orchestration frames */
const SKIP_EMBEDDING_CONFIDENCE_THRESHOLD = 0.85;

// ============================================================
// Trigger Detection Helpers
// ============================================================

function normalizeForMatch(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\/_-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase || phrase.length < 3) return false;
  const normalizedText = normalizeForMatch(text);
  const normalizedPhrase = normalizeForMatch(phrase);

  // For multi-word phrases: substring match (e.g. "apa yang saya tanyakan" in text)
  if (normalizedPhrase.includes(' ')) {
    return normalizedText.includes(normalizedPhrase);
  }

  // For single-word triggers: word-boundary match to prevent substring false positives
  // e.g. "ingat" should match "saya ingat" but NOT "ingatkan"
  return containsWord(normalizedText, normalizedPhrase);
}

function containsWord(text: string, word: string): boolean {
  if (!text || !word || word.length < 3) return false;
  const pattern = new RegExp(
    `(^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`,
    'i'
  );
  return pattern.test(text);
}

// ============================================================
// Skill Trigger Helpers (runtime, prevents drift — BUG-002)
// ============================================================

function getSkillTriggers(slug: string): string[] {
  const skill = skillsRegistry.getSkillBySlug(slug);
  return skill?.capabilities?.triggers ?? [];
}

function matchSkillTriggers(text: string, slug: string): string[] {
  const triggers = getSkillTriggers(slug);
  return triggers.filter(t => containsPhrase(text, t));
}

// ============================================================
// Temporal Parsing Helpers
// ============================================================

function extractRelativeOffset(signals: UserMessageSignals): number | undefined {
  const details = signals.temporalDetails;
  if (!details || details.length === 0) return undefined;

  for (const detail of details) {
    if (detail.type === 'relative' && detail.normalizedValue) {
      const match = detail.normalizedValue.match(/^(-?\d+)\s*(day|hari|minggu|week|bulan|month)/i);
      if (match) {
        const num = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        if (unit === 'hari' || unit === 'day') return Math.abs(num);
        if (unit === 'minggu' || unit === 'week') return Math.abs(num) * 7;
        if (unit === 'bulan' || unit === 'month') return Math.abs(num) * 30;
      }
    }
  }

  return undefined;
}

function extractTemporalScope(signals: UserMessageSignals): PerceptionFrame['temporalScope'] | undefined {
  const details = signals.temporalDetails;
  if (!details || details.length === 0) {
    // Check temporal hints as fallback
    if (signals.temporalHints.length > 0) {
      return {
        raw: signals.temporalHints.join(', ')
      };
    }
    return undefined;
  }

  const detail = details[0];
  return {
    raw: detail.value,
    normalized: detail.normalizedValue,
    relativeOffsetDays: extractRelativeOffset(signals)
  };
}

// ============================================================
// Detection Rule: Small Talk
// ============================================================

function detectSmallTalk(text: string): PerceptionFrame | null {
  const detection = greetingDetector.detect(text);

  if (detection.isGreeting && detection.confidence >= 0.6) {
    // Map greeting types to operations
    const ops: PerceptionOperation[] = [];
    if (detection.type === 'thanks') ops.push('notify');
    if (detection.type === 'greeting') ops.push('clarify');

    return {
      type: 'small_talk',
      operations: ops.length > 0 ? ops : ['clarify'],
      confidence: detection.confidence,
      reasoning: [`Greeting detected: ${detection.type} (${detection.reason})`]
    };
  }

  // Identity/self-awareness questions — route to greeting skill for VIPER-IDENTITY.md
  if (isIdentityQuestion(text)) {
    return {
      type: 'small_talk',
      operations: ['clarify'],
      confidence: 0.85,
      reasoning: ['Identity question detected — routing to greeting skill for self-awareness']
    };
  }

  return null;
}

function isIdentityQuestion(text: string): boolean {
  const n = normalizeForMatch(text);
  if (!n) return false;

  return (
    /\b(siapa\s+(anda|kamu|ini|lo|elu|gue)|who\s+(are|is)\s+(you|this)|what\s+are\s+you)\b/i.test(n) ||
    /\b(bagaimana|gimana|how)\s+(anda|kamu|you)\s+(didesain|dibangun|dibuat|bekerja|kerja|designed|built|made|work|function|arsitektur|architecture)\b/i.test(n) ||
    /\b(bagaimana|gimana|how)\s+.+\s+(anda|kamu|you)\b/i.test(n) ||
    /\b(jelaskan|jelasin|explain|describe|tell me about)\s+(dirimu|tentang kamu|tentang anda|arsitekturmu|yourself|your architecture)\b/i.test(n) ||
    /\b(apakah\s+(anda|kamu)\s+(manusia|robot|ai|bot|asli|program)|are\s+you\s+(human|real|a robot|ai|a bot))\b/i.test(n) ||
    /\b(apa|apakah)\s+(anda|kamu|you)\s+(punya|bisa|memiliki|have|has|can)\s+(memory|ingatan|konteks|riwayat|sejarah|context|history|kemampuan|capabilit)/i.test(n) ||
    /\b(kamu|anda|you)\s+(punya|bisa|memiliki|have|has|can)\s+(memory|ingatan|konteks|riwayat|sejarah|context|history)\b/i.test(n) ||
    /^(siapa kamu|siapa anda|who are you|kenalan dong|introduce yourself|perkenalkan dirimu)$/i.test(n)
  );
}

function hasOperationalSignal(text: string, signals: UserMessageSignals): boolean {
  const normalized = normalizeForMatch(text);
  const wordCount = normalized ? normalized.split(/\s+/).length : 0;

  return Boolean(
    signals.actionHints?.length ||
    signals.formatHints?.length ||
    signals.temporalHints?.length ||
    signals.temporalDetails?.length ||
    signals.entityHints?.length ||
    signals.asksForFile ||
    signals.asksForRealtimeData ||
    signals.comparison?.isComparison ||
    (wordCount > 4 && (
      signals.actionHints?.length ||
      signals.temporalDetails?.length ||
      signals.entityHints?.length
    ))
  );
}

// ============================================================
// Detection Rule: Offer Response
// ============================================================

function detectOfferResponse(
  text: string,
  workingMemory?: WorkingMemoryData | null
): PerceptionFrame | null {
  if (!workingMemory?.activeOffer) return null;

  const decision = classifyDeterministicOfferResponse(text, workingMemory.activeOffer);
  if (decision === true) {
    return {
      type: 'offer_response',
      operations: ['execute'],
      confidence: HIGH_CONFIDENCE,
      reasoning: ['Active offer exists', 'Shared deterministic classifier detected acceptance'],
      safety: { requiresConfirmation: false, sideEffectLevel: 'none' }
    };
  }

  if (decision === false) {
    return {
      type: 'offer_response',
      operations: ['clarify'],
      confidence: HIGH_CONFIDENCE,
      reasoning: ['Active offer exists', 'Shared deterministic classifier detected rejection']
    };
  }

  return null;
}

// ============================================================
// Detection Rule: Continuation / Refine
// ============================================================

// Quick heuristic check for continuation signals when workingMemory
// has active state (activePlan, activeTool, activeSkill, continuationHints).
// The full ContinuationResolver handles deep detection; this is a fast gate.
function detectContinuationRefine(
  text: string,
  workingMemory?: WorkingMemoryData | null
): PerceptionFrame | null {
  if (!workingMemory) return null;

  // Must have active state to qualify as continuation
  const hasActiveState =
    workingMemory.activePlan ||
    workingMemory.activeTool ||
    workingMemory.activeSkill ||
    workingMemory.activeIntent;

  if (!hasActiveState) return null;

  // Guard: if text matches memory or automation triggers, it's NOT continuation.
  // The user is starting a new request, not refining the previous one.
  const memoryTriggers = getSkillTriggers('memory_recall');
  const automationTriggers = getSkillTriggers('automation_manager');
  const hasMemorySignal = memoryTriggers.some(t => containsPhrase(text, t));
  const hasAutomationSignal = automationTriggers.some(t => containsPhrase(text, t));
  if (hasMemorySignal || hasAutomationSignal) {
    return null; // Let memory/automation detection handle it
  }

  const normalized = normalizeForMatch(text);
  const wordCount = normalized.split(/\s+/).length;

  // Very short text after tool execution → likely continuation
  const refineWords = [
    'lebih detail', 'jelaskan', 'maksudnya', 'bisa tolong',
    'lanjut', 'teruskan', 'detail', 'rinci', 'perjelas',
    'expand', 'elaborate', 'explain more', 'more detail',
    'ringkas', 'summary', 'simpulkan', 'kesimpulan',
    'format', 'export', 'simpan', 'download'
  ];

  const matchedRefine = refineWords.filter(w => containsPhrase(normalized, w));

  // Refine word match: must be clearly a continuation (short query with explicit refine signal)
  if (matchedRefine.length > 0 && wordCount <= 5) {
    return {
      type: 'continuation_refine',
      operations: ['analyze', 'export'],
      confidence: matchedRefine.length >= 2 ? MEDIUM_CONFIDENCE : LOW_CONFIDENCE,
      reasoning: [
        'Working memory has active state',
        `Refine signals matched: ${matchedRefine.join(', ')}`
      ],
      target: {
        resource: workingMemory.activeSkill ? 'skill' : 'tool',
        kind: 'current_context'
      }
    };
  }

  // Very short text (1-2 words) with active state → likely continuation
  if (wordCount <= 2 && hasActiveState) {
    return {
      type: 'continuation_refine',
      operations: ['analyze'],
      confidence: LOW_CONFIDENCE - 0.05, // Slightly below threshold, planner decides
      reasoning: ['Working memory has active state', 'Very short query suggests continuation'],
      target: { kind: 'current_context' }
    };
  }

  return null;
}

// ============================================================
// Detection Rule: Memory Task Replay
// ============================================================

function detectMemoryTaskReplay(text: string): PerceptionFrame | null {
  const normalized = normalizeForMatch(text);

  // Get memory trigger phrases from memory_recall skill at runtime (prevents drift)
  const memoryTriggers = getSkillTriggers('memory_recall');
  const matchedMemory = memoryTriggers.filter(t => containsPhrase(normalized, normalizeForMatch(t)));

  if (matchedMemory.length === 0) return null;

  // Replay words (hardcoded — these are language-agnostic operational commands)
  const replayWords = [
    'jalankan ulang', 'run ulang', 'lakukan lagi', 'ulangi',
    'rerun', 'execute again', 'jalanin lagi', 'coba lagi',
    'eksekusi lagi', 'jalankan kembali', 'run lagi'
  ];
  const matchedReplay = replayWords.filter(w => containsPhrase(normalized, normalizeForMatch(w)));

  if (matchedReplay.length === 0) return null; // memory words but no replay → memory_question

  return {
    type: 'memory_task_replay',
    operations: ['recall', 'select', 'execute'],
    confidence: matchedReplay.length >= 1 && matchedMemory.length >= 1
      ? HIGH_CONFIDENCE
      : MEDIUM_CONFIDENCE,
    reasoning: [
      `Memory triggers matched: ${matchedMemory.join(', ')}`,
      `Replay signals matched: ${matchedReplay.join(', ')}`
    ],
    target: {
      resource: 'memory',
      kind: 'previous_task'
    },
    replay: {
      requested: true,
      source: 'memory',
      autoExecuteIfSingle: true,
      clarifyIfMultiple: true
    }
  };
}

// ============================================================
// Detection Rule: Memory Question
// ============================================================

function detectMemoryQuestion(text: string): PerceptionFrame | null {
  const normalized = normalizeForMatch(text);

  const memoryTriggers = getSkillTriggers('memory_recall');
  const matchedMemory = memoryTriggers.filter(t => containsPhrase(normalized, normalizeForMatch(t)));

  if (matchedMemory.length === 0) return null;

  // Check that this is NOT also a replay (handled by detectMemoryTaskReplay first)
  const replayWords = [
    'jalankan ulang', 'run ulang', 'lakukan lagi', 'ulangi',
    'rerun', 'execute again', 'jalanin lagi', 'coba lagi'
  ];
  const hasReplay = replayWords.some(w => containsPhrase(normalized, normalizeForMatch(w)));
  if (hasReplay) return null;

  return {
    type: 'memory_question',
    operations: ['recall'],
    confidence: MEDIUM_CONFIDENCE,
    reasoning: [`Memory triggers matched (no replay): ${matchedMemory.join(', ')}`],
    target: {
      resource: 'memory',
      kind: 'previous_topic'
    }
  };
}

// ============================================================
// Detection Rule: Automation Request
// ============================================================

function detectAutomationRequest(text: string): PerceptionFrame | null {
  const normalized = normalizeForMatch(text);

  // Get automation triggers from automation_manager skill at runtime
  const automationTriggers = getSkillTriggers('automation_manager');
  const matchedAutomation = automationTriggers.filter(t => containsPhrase(normalized, normalizeForMatch(t)));

  if (matchedAutomation.length === 0) return null;

  // Determine automation kind from text patterns
  // Order: conditional first (kalau/jika/pantau/monitor), then scheduled, then reminder (default)
  let kind: 'reminder' | 'scheduled_workflow' | 'conditional_alert' | undefined;
  if (containsPhrase(normalized, 'kalau') || containsPhrase(normalized, 'jika') || containsPhrase(normalized, 'pantau') || containsPhrase(normalized, 'monitor')) {
    kind = 'conditional_alert';
  } else if (containsPhrase(normalized, 'setiap') || containsPhrase(normalized, 'jadwalkan') || containsPhrase(normalized, 'schedule')) {
    kind = 'scheduled_workflow';
  } else if (
    containsPhrase(normalized, 'ingatkan') || containsPhrase(normalized, 'pengingat') ||
    containsPhrase(normalized, 'remind') || containsPhrase(normalized, 'reminder') ||
    containsPhrase(normalized, 'kabari') || containsPhrase(normalized, 'alarm') ||
    containsPhrase(normalized, 'jangan lupa') || containsPhrase(normalized, 'tolong ingatkan')
  ) {
    kind = 'reminder';
  }

  return {
    type: 'automation_request',
    operations: kind === 'conditional_alert'
      ? ['monitor', 'notify']
      : ['schedule', 'notify'],
    confidence: matchedAutomation.length >= 2 ? HIGH_CONFIDENCE : MEDIUM_CONFIDENCE,
    reasoning: [`Automation triggers matched: ${matchedAutomation.join(', ')}`],
    target: {
      resource: 'automation',
      kind: 'future_task'
    },
    automation: {
      requested: true,
      kind,
      futureTask: true
    },
    safety: { requiresConfirmation: true, sideEffectLevel: 'write' }
  };
}

// ============================================================
// Detection Rule: Comparison
// ============================================================

function detectComparison(signals: UserMessageSignals): PerceptionFrame | null {
  if (!signals.comparison?.isComparison) return null;

  return {
    type: 'comparison',
    operations: ['compare', 'analyze'],
    confidence: MEDIUM_CONFIDENCE,
    reasoning: [`Comparison signal detected from decomposition: operator=${signals.comparison.operator}`],
    target: {
      resource: 'tool',
      kind: 'current_context'
    }
  };
}

// ============================================================
// PerceptionStage
// ============================================================

export class PerceptionStage {
  /**
   * Execute perception on input text and decomposition signals.
   *
   * Detection priority (actual execution order):
   * 1. small_talk (greeting/thanks)
   * 2. offer_response (active offer + confirmation)
   * 3. continuation_refine (active working memory state)
   * 4. comparison (decomposition signal — more specific than word matching)
   * 5. memory_task_replay (memory + replay signals)
   * 6. memory_question (memory without replay)
   * 7. automation_request (future/schedule/monitor signals)
   * 8. direct_task (default)
   *
   * Comparison is placed before memory detection because it uses a
   * decomposition signal (isComparison) which is more reliable than
   * trigger phrase matching.
   *
   * @param input - Perception stage input
   * @returns PerceptionStageResult with classified frame
   */
  async execute(input: PerceptionStageInput): Promise<PerceptionStageResult> {
    const { text, decomposition, workingMemory, episodicMemory } = input;
    const signals = decomposition.signals;
    const emotion = detectEmotion(text);

    appLogger.debug('[PerceptionStage] Starting perception', {
      text: text.substring(0, 80),
      hasWorkingMemory: !!workingMemory,
      hasEpisodicMemory: !!episodicMemory,
      signalKeys: Object.keys(signals).filter(k => {
        const val = (signals as any)[k];
        if (Array.isArray(val)) return val.length > 0;
        if (typeof val === 'object' && val !== null) return true;
        return !!val;
      }),
      emotion: emotion.emotion,
      emotionIntensity: emotion.intensity
    });

    // ---- 1. Small Talk ----
    const smallTalkFrame = detectSmallTalk(text);
    if (smallTalkFrame && smallTalkFrame.confidence >= 0.6 && !hasOperationalSignal(text, signals)) {
      appLogger.debug('[PerceptionStage] → small_talk', { confidence: smallTalkFrame.confidence });
      return {
        frame: { ...smallTalkFrame, temporalScope: extractTemporalScope(signals), emotion },
        skipEmbedding: true  // small_talk always skips embedding
      };
    } else if (smallTalkFrame) {
      appLogger.debug('[PerceptionStage] Small talk signal ignored because query has operational signals', {
        confidence: smallTalkFrame.confidence,
        actionHints: signals.actionHints?.length || 0,
        temporalHints: signals.temporalHints?.length || 0,
        entityHints: signals.entityHints?.length || 0
      });
    }

    // ---- 2. Offer Response (active offer must exist) ----
    const offerResponseFrame = detectOfferResponse(text, workingMemory);
    if (offerResponseFrame) {
      appLogger.debug('[PerceptionStage] → offer_response', { confidence: offerResponseFrame.confidence });
      return { frame: { ...offerResponseFrame, emotion } };
    }

    // ---- 3. Continuation / Refine ----
    const continuationFrame = detectContinuationRefine(text, workingMemory);
    if (continuationFrame) {
      appLogger.debug('[PerceptionStage] → continuation_refine', { confidence: continuationFrame.confidence });
      return { frame: { ...continuationFrame, temporalScope: extractTemporalScope(signals), emotion } };
    }

    // ---- 4-N. Competitive Matchers (best confidence wins) ----
    // Matchers below detect independent frame types from query text alone.
    // Instead of first-match-wins, we evaluate ALL candidates and pick the
    // highest-confidence frame. Priority is only used as tiebreaker when
    // confidence gap ≤ 0.05.
    type Candidate = {
      frame: PerceptionFrame
      priority: number
      skipEmbedding?: boolean
    }

    const candidates: Candidate[] = []

    // 4. Comparison (decomposition signal)
    const comparisonFrame = detectComparison(signals)
    if (comparisonFrame) {
      candidates.push({ frame: comparisonFrame, priority: 4 })
    }

    // 5. Memory Task Replay
    const memoryReplayFrame = detectMemoryTaskReplay(text)
    if (memoryReplayFrame) {
      candidates.push({
        frame: { ...memoryReplayFrame, temporalScope: extractTemporalScope(signals), emotion },
        priority: 5,
        skipEmbedding: memoryReplayFrame.confidence >= SKIP_EMBEDDING_CONFIDENCE_THRESHOLD
      })
    }

    // 6. Memory Question
    const memoryQuestionFrame = detectMemoryQuestion(text)
    if (memoryQuestionFrame) {
      candidates.push({
        frame: { ...memoryQuestionFrame, temporalScope: extractTemporalScope(signals), emotion },
        priority: 6,
        skipEmbedding: memoryQuestionFrame.confidence >= SKIP_EMBEDDING_CONFIDENCE_THRESHOLD
      })
    }

    // 7. Automation Request
    const automationFrame = detectAutomationRequest(text)
    if (automationFrame) {
      candidates.push({
        frame: { ...automationFrame, temporalScope: extractTemporalScope(signals), emotion },
        priority: 7,
        skipEmbedding: automationFrame.confidence >= SKIP_EMBEDDING_CONFIDENCE_THRESHOLD
      })
    }

    // 8. Direct Task (fallback, only if nothing else matched)
    if (candidates.length === 0) {
      appLogger.debug('[PerceptionStage] → direct_task (default)')
      return {
        frame: {
          type: 'direct_task',
          operations: ['execute'],
          confidence: LOW_CONFIDENCE,
          reasoning: ['No specific frame pattern matched, defaulting to direct_task'],
          temporalScope: extractTemporalScope(signals),
          emotion
        },
        skipEmbedding: false
      }
    }

    // Best-match: highest confidence, priority as tiebreaker (gap ≤ 0.05)
    const best = candidates.reduce((a, b) => {
      const gap = Math.abs(a.frame.confidence - b.frame.confidence)
      if (gap <= 0.05) {
        return a.priority > b.priority ? a : b
      }
      return a.frame.confidence > b.frame.confidence ? a : b
    })

    if (best.frame.confidence < MIN_CONFIDENCE_THRESHOLD) {
      appLogger.debug('[PerceptionStage] Best-match below threshold, defaulting to direct_task', {
        type: best.frame.type,
        confidence: best.frame.confidence,
        threshold: MIN_CONFIDENCE_THRESHOLD
      })

      return {
        frame: {
          type: 'direct_task',
          operations: ['execute'],
          confidence: LOW_CONFIDENCE,
          reasoning: ['Best perception candidate was below minimum confidence threshold'],
          temporalScope: extractTemporalScope(signals),
          emotion
        },
        skipEmbedding: false
      }
    }

    appLogger.debug('[PerceptionStage] Best-match selected', {
      type: best.frame.type,
      confidence: best.frame.confidence,
      totalCandidates: candidates.length,
      candidateTypes: candidates.map(c => c.frame.type)
    })

    return {
      frame: best.frame,
      skipEmbedding: best.skipEmbedding ?? (best.frame.confidence >= SKIP_EMBEDDING_CONFIDENCE_THRESHOLD)
    }
  }
}
