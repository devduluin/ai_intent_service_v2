import { PlannerOutput } from "../types/planner.types"

export interface ConfidenceDecision {
  confidence: number
  action: 'execute_tools' | 'execute_handler' | 'clarify' | 'chat'
}

class ConfidenceDecisionService {

  evaluate(plan: PlannerOutput, userText: string): ConfidenceDecision {

    const text = userText.toLowerCase().trim()

    // ======================================================
    // 1️⃣ DETERMINISTIC HANDLER LANE (NO SCORING)
    // ======================================================
    const hasOnlyHandlers = 
      plan.tasks.length > 0 && 
      plan.tasks.every(task => task.resource === 'handler') &&
      plan.chat === false

    if (hasOnlyHandlers) {
      return {
        confidence: 0.95,
        action: 'execute_handler'
      }
    }

    // ======================================================
    // 2️⃣ PURE CHAT (NO PLAN OR chat = true)
    // ======================================================
    if (
      plan.tasks.length === 0 ||
      plan.chat === true
    ) {
      console.log('No tools/knowledge detected or chat flag is true → defaulting to chat', plan.tasks)
      return {
        confidence: 0.3,
        action: 'chat'
      }
    }

    // ======================================================
    // 3️⃣ SCORING ENGINE (TOOLS / KNOWLEDGE)
    // ======================================================
    const intentScore = this.intentScore(plan)
    const executionScore = this.executionScore(plan)
    const languageScore = this.languageScore(text)
    const ambiguityPenalty = this.ambiguityPenalty(plan)
    const shortTextPenalty = this.shortTextPenalty(text)

    let confidence =
      intentScore * 0.35 +
      executionScore * 0.25 +
      languageScore * 0.15 -
      ambiguityPenalty -
      shortTextPenalty

    confidence = Math.max(0, Math.min(1, confidence))

    // ======================================================
    // 4️⃣ FINAL DECISION
    // ======================================================
    let action: ConfidenceDecision['action']

    if (confidence >= 0.70) action = 'execute_tools'
    else if (confidence >= 0.45) action = 'clarify'
    else action = 'chat'

    return {
      confidence: Number(confidence.toFixed(2)),
      action
    }
  }

  // ======================================================
  // SIGNALS
  // ======================================================

  private intentScore(plan: PlannerOutput): number {
    const hasToolsOrKnowledge = plan.tasks.some(
      task => task.resource === 'tool' || task.resource === 'knowledge'
    )
    if (hasToolsOrKnowledge) return 1
    return 0.5
  }

  private executionScore(plan: PlannerOutput): number {
    const hasTools = plan.tasks.some(task => task.resource === 'tool')
    const hasKnowledge = plan.tasks.some(task => task.resource === 'knowledge')
    
    if (hasTools) return 1        // strongest signal
    if (hasKnowledge) return 0.75 // medium
    return 0.4
  }

  private languageScore(text: string): number {
    const strong = [
      'ajukan','buat','proses','tolong buatkan','cek','hitung','generate','kirim'
    ]

    const unsure = [
      'mungkin','kayaknya','gimana','bisa','apakah','kira kira'
    ]

    if (strong.some(w => text.includes(w))) return 1
    if (unsure.some(w => text.includes(w))) return 0.6
    return 0.8
  }

  // penalize too many candidates → ambiguous intent
  private ambiguityPenalty(plan: PlannerOutput): number {
    const totalCandidates = plan.tasks.length

    if (totalCandidates >= 4) return 0.15
    if (totalCandidates >= 2) return 0.08
    return 0
  }

  // short messages are usually unclear
  private shortTextPenalty(text: string): number {
    const wordCount = text.split(' ').length

    if (wordCount <= 2) return 0.10
    if (wordCount <= 4) return 0.05
    return 0
  }
}

export const confidenceDecisionService = new ConfidenceDecisionService()