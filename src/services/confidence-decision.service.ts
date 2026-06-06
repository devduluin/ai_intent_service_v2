import { PlannerOutput } from "../types/planner.types"
import { UserMessageSignals } from "../services/query-decomposition.service"

export interface ConfidenceDecision {
  confidence: number
  action: 'execute_tools' | 'execute_skill' | 'clarify' | 'chat'
  // C-009 FIX: Resource type breakdown for planner feedback
  resourceBreakdown: {
    tools: number
    skills: number
    knowledge: number
  }
  // Recommended primary resource type based on confidence analysis
  recommendedResource?: 'tool' | 'skill' | 'knowledge'
}

export interface ConfidenceDecisionInput {
  plan: PlannerOutput
  userText: string
  signals?: UserMessageSignals
}

class ConfidenceDecisionService {

  evaluate(input: ConfidenceDecisionInput | PlannerOutput, userText?: string, signals?: UserMessageSignals): ConfidenceDecision {
    // Support both old and new signature
    let plan: PlannerOutput
    let text: string
    let sigs: UserMessageSignals | undefined

    if (typeof input === 'object' && 'plan' in input) {
      // New signature: evaluate({ plan, userText, signals })
      plan = input.plan
      text = input.userText
      sigs = input.signals
    } else {
      // Old signature: evaluate(plan, userText)
      plan = input as PlannerOutput
      text = userText || ''
      sigs = signals
    }

    text = text.toLowerCase().trim()

    // ======================================================
    // 1️⃣ DETERMINISTIC HANDLER LANE (NO SCORING)
    // ======================================================
    const hasOnlySkills =
      plan.tasks.length > 0 &&
      plan.tasks.every(task => task.resource === 'skill') &&
      plan.chat === false

    if (hasOnlySkills) {
      return {
        confidence: 0.95,
        action: 'execute_skill',
        resourceBreakdown: {
          tools: 0,
          skills: plan.tasks.length,
          knowledge: 0
        },
        recommendedResource: 'skill'
      }
    }

    // ======================================================
    // 2️⃣ PURE CHAT (NO PLAN OR chat = true)
    // ======================================================
    if (
      plan.tasks.length === 0 ||
      plan.chat === true
    ) {
      // SPECIAL CASE: If user asks for realtime data but no tasks detected
      // This indicates a potential planner failure, not a chat intent
      if (sigs?.asksForRealtimeData || (sigs?.actionHints && sigs.actionHints.length > 0)) {
        console.log('User requested realtime data/action but no tasks detected → forcing chat with warning', {
          asksForRealtimeData: sigs?.asksForRealtimeData,
          actionHints: sigs?.actionHints
        })
        return {
          confidence: 0.5,  // Higher confidence to indicate this is NOT a normal chat
          action: 'chat',
          resourceBreakdown: {
            tools: 0,
            skills: 0,
            knowledge: 0
          },
          recommendedResource: undefined
        }
      }

      console.log('No tools/knowledge detected or chat flag is true → defaulting to chat', plan.tasks)
      return {
        confidence: 0.3,
        action: 'chat',
        resourceBreakdown: {
          tools: 0,
          skills: 0,
          knowledge: 0
        },
        recommendedResource: undefined
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
    
    // NEW: Signal-based bonus/penalty
    const signalBonus = sigs ? this.signalBonus(sigs, plan) : 0

    let confidence =
      intentScore * 0.35 +
      executionScore * 0.25 +
      languageScore * 0.15 -
      ambiguityPenalty -
      shortTextPenalty +
      signalBonus

    confidence = Math.max(0, Math.min(1, confidence))

    // ======================================================
    // 4️⃣ FINAL DECISION
    // ======================================================
    let action: ConfidenceDecision['action']

    if (confidence >= 0.70) action = 'execute_tools'
    else if (confidence >= 0.45) action = 'clarify'
    else action = 'chat'

    // C-009 FIX: Resource type breakdown for planner feedback
    const resourceBreakdown = {
      tools: plan.tasks.filter(t => t.resource === 'tool').length,
      skills: plan.tasks.filter(t => t.resource === 'skill').length,
      knowledge: plan.tasks.filter(t => t.resource === 'knowledge').length
    }

    // Recommend primary resource type based on confidence and resource breakdown
    let recommendedResource: ConfidenceDecision['recommendedResource']
    
    // If plan has only skills, recommend skill
    if (resourceBreakdown.skills > 0 && resourceBreakdown.tools === 0 && resourceBreakdown.knowledge === 0) {
      recommendedResource = 'skill'
    } else if (resourceBreakdown.tools > 0 && confidence >= 0.70) {
      recommendedResource = 'tool'  // High confidence + tools = tool is primary
    } else if (resourceBreakdown.knowledge > 0 && confidence >= 0.60) {
      recommendedResource = 'knowledge'
    } else if (resourceBreakdown.tools > 0) {
      recommendedResource = 'tool'
    } else if (resourceBreakdown.skills > 0) {
      recommendedResource = 'skill'
    } else if (resourceBreakdown.knowledge > 0) {
      recommendedResource = 'knowledge'
    }

    return {
      confidence: Number(confidence.toFixed(2)),
      action,
      resourceBreakdown,
      recommendedResource
    }
  }

  // ======================================================
  // SIGNALS
  // ======================================================

  /**
   * Signal-based bonus/penalty
   * - Bonus if user asks for realtime data AND we have tasks
   * - Penalty if user asks for action but we're falling back to chat
   */
  private signalBonus(signals: UserMessageSignals, plan: PlannerOutput): number {
    let bonus = 0

    // Bonus: User asks for realtime data (weather, time, price, etc.)
    // This should boost confidence to execute, not chat
    if (signals.asksForRealtimeData && plan.tasks.length > 0) {
      bonus += 0.15  // Significant boost for realtime requests
    }

    // Bonus: User has clear action hints AND we have matching tasks
    if (signals.actionHints && signals.actionHints.length > 0 && plan.tasks.length > 0) {
      bonus += 0.10  // Boost for action-oriented queries
    }

    // Penalty: User asks for file/export but no export tasks detected
    if (signals.asksForFile && !plan.tasks.some(t => 
      t.key.includes('export') || t.key.includes('generate') || t.key.includes('xls') || t.key.includes('pdf')
    )) {
      bonus -= 0.10  // Penalty for missing expected export functionality
    }

    return bonus
  }

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
