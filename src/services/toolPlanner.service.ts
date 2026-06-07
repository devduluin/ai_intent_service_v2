import { ollamaService } from './ollama.service'
import { openAiService } from './openAi.service'
import type { PlannerInput, Intent } from '../types'
import type { PlannerOutput } from '../types/planner.types'
import { trimChatHistory } from '../utils/trim-chat';
import { appLogger } from '../utils/logger.util';

// ============================================================
// Confidence Thresholds (shared with PlannerStage)
// ============================================================

const TASK_CONFIDENCE_HIGH = 0.80;
const TASK_CONFIDENCE_MEDIUM = 0.60;

// ============================================================
// Options for planner configuration
// ============================================================

export interface PlannerOptions {
  includeReasoning?: boolean;
  includeConfidence?: boolean;
  includeClarification?: boolean;
  confidenceThreshold?: number;
}

class ToolPlannerService {

  async plan(input: PlannerInput, options?: PlannerOptions): Promise<PlannerOutput> {
    appLogger.debug('[ToolPlanner] Planning started', {
      candidatesCount: {
        skills: input.candidates.skillsDetails?.length || 0,
        tools: input.candidates.toolsDetails?.length || 0,
        knowledge: input.candidates.knowledgeDetails?.length || 0
      },
      options
    });

    const prompt = this.buildPrompt(input, options);
    console.log('[ToolPlanner] Raw prompt received', prompt);
    const raw = await openAiService.generateJson(prompt, { temperature: 0, num_predict: 2048 });

    try {
      const result = this.safeParse(raw, input, options);
      
      appLogger.info('[ToolPlanner] Planning completed', {
        tasksCount: result.tasks.length,
        mode: result.mode,
        confidence: result.confidence,
        needsClarification: result.needsClarification,
        raw
      });
      
      return result;
    } catch (err) {
      appLogger.error('[ToolPlanner] Planning failed', {
        error: err instanceof Error ? err.message : err
      });
      throw err;
    }
  }

  private buildPrompt(input: PlannerInput, options?: PlannerOptions): string {
    const skillsDetails = this.buildSkillsDetails(input.candidates.skillsDetails || []);
    const toolsDetails = this.buildToolsDetails(input.candidates.toolsDetails || []);
    const knowledgeDetails = this.buildKnowledgeDetails(input.candidates.knowledgeDetails || []);
   
    const trimmedHistory = trimChatHistory(input.input.chat_history, {
      maxMessages: 2,
      maxLength: 180,
      filterRole: 'user'
    });

    const recentAssistantMessages = trimChatHistory(input.input.chat_history, {
      maxMessages: 1,
      maxLength: 220,
      filterRole: 'assistant'
    });

    const contextParts: string[] = [];

    if (trimmedHistory?.length) {
      contextParts.push(`recent_user_msgs=${JSON.stringify(trimmedHistory)}`);
    }

    if (recentAssistantMessages?.length) {
      contextParts.push(`recent_assistant_msgs=${JSON.stringify(recentAssistantMessages)}`);
    }

    if (input.recommendedResource) {
      contextParts.push(`recommended_resource=${input.recommendedResource}`);
    }

    if (input.skillSignal?.candidates?.length) {
      contextParts.push(`skill_signal=${JSON.stringify({
        recommendedSkill: input.skillSignal.recommendedSkill,
        hasStrongSignal: input.skillSignal.hasStrongSignal,
        candidates: input.skillSignal.candidates.slice(0, 3)
      })}`);
    }

    if (input.perceptionFrame) {
      contextParts.push(`perception_frame=${JSON.stringify({
        type: input.perceptionFrame.type,
        operations: input.perceptionFrame.operations,
        confidence: input.perceptionFrame.confidence,
        targetResource: input.perceptionFrame.target?.resource,
        targetKind: input.perceptionFrame.target?.kind,
        replayRequested: input.perceptionFrame.replay?.requested,
        automationRequested: input.perceptionFrame.automation?.requested,
        automationKind: input.perceptionFrame.automation?.kind
      })}`);

      // Cognitive guidance: frame-specific imperative instructions
      const frameGuidance = this.buildFrameGuidance(input.perceptionFrame);
      if (frameGuidance) {
        contextParts.push(`cognitive_guidance=${frameGuidance}`);
      }
    }

    return `
Kamu AI Task Planner. Buat graph task paling minimal dan relevan.

Prioritas resource: tool > skill > knowledge > chat.
Mode: single_step (1 task) / multi_step (>1 task atau ada dependency).
Aturan inti:
- Pakai hanya key resource yang tersedia.
- Skill yang butuh output tool harus depends_on task tool.
- Jika skill_signal.hasStrongSignal=true, prioritaskan recommendedSkill sebagai orchestration skill.
- Jika cognitive_guidance ada di CONTEXT, IKUTI panduan tersebut. Itu adalah hasil cognitive perception — bukan saran opsional.
- Untuk automation/monitoring/future task creation, pilih automation orchestration skill saja. Jangan pilih tool dependency.
- Untuk pertanyaan riwayat/memori seperti "apa yang saya tanyakan kemarin" pilih skill memory_recall.
- Jangan pilih memory_recall untuk query operasional historis seperti "cek data operasional kemarin"; itu harus memakai tool yang relevan.
- Jika 1 tool dipakai beberapa task, jalankan tool sekali.
- ID task wajib "1","2",... berurutan.
- Jika tidak ada resource cocok: {"mode":"single_step","chat":true,"tasks":[]}.

RESOURCES
skills:
${skillsDetails}
tools:
${toolsDetails}
knowledge:
${knowledgeDetails}

CONTEXT
${contextParts.length ? contextParts.join('\n') : 'none'}

Pesan User ="${this.compact(input.input.text, 320)}"

OUTPUT JSON ONLY (tanpa markdown):
{
  "mode":"single_step|multi_step",
  "chat":boolean,
  "tasks":[
    {
      "id":"string",
      "resource":"tool|skill|knowledge",
      "key":"string",
      "depends_on":["string"]${options?.includeConfidence ? ',\n      "confidence":0.0' : ''}
    }
  ]${options?.includeReasoning ? ',\n  "reasoning":"string"' : ''}
}
`.trim();
  }

  private buildSkillsDetails(skills: any[]): string {
    if (!skills.length) return "- none"
    return skills
      .slice(0, 30)
      .map(skill => {
        const triggers = skill.capabilities?.triggers || []
        return `- ${skill.slug}: ${this.compact(skill.description || '-', 96)} | tags=${this.compactList(skill.tags || [], 4)} | triggers=${this.compactList(triggers, 5)}`
      })
      .join('\n')
  }

  private buildToolsDetails(tools: any[]): string {
    if (!tools.length) return "- none"
    return tools
      .slice(0, 40)
      .map(tool => `- ${tool.slug}: ${this.compact(tool.description || '-', 100)}`)
      .join('\n')
  }

  private buildKnowledgeDetails(knowledge: any[]): string {
    if (!knowledge.length) return "- none"
    return knowledge
      .slice(0, 30)
      .map(k => `- ${k.slug}: ${this.compact(k.description || '-', 100)}`)
      .join('\n')
  }

  private compact(value: string, maxLen: number): string {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLen) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
  }

  private compactList(values: string[], maxItems: number): string {
    if (!Array.isArray(values) || values.length === 0) return '-';
    return values.slice(0, maxItems).join(',');
  }

  // ===============================
  // SAFE JSON PARSING
  // ===============================
private safeParse(raw: string, input?: PlannerInput, options?: PlannerOptions): PlannerOutput {
  const debugMeta = {
    repaired: false,
    removedInvalidTasks: 0,
    removedDependencies: 0,
    deduplicatedTasks: 0
  }

  // 1. STRIP MARKDOWN
  const clean = raw.replace(/```json|```/g, '').trim()
  const match = clean.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("Planner JSON not found")

  let parsed: any
  try {
    parsed = JSON.parse(match[0])
  } catch {
    throw new Error("Planner invalid JSON")
  }

  // 2. VALID RESOURCE KEYS
  const validSkillKeys = new Set(input?.candidates.skillsDetails?.map(s => s.slug))
  const validToolKeys = new Set(input?.candidates.toolsDetails?.map(t => t.slug))
  const validKnowledgeKeys = new Set(input?.candidates.knowledgeDetails?.map(k => k.slug))

  const isValidKey = (resource: string, key: string) => {
    if (!key) return false
    // NOTE: Tool & knowledge keys are dynamic, validated at runtime by execution layer
    if (resource === "tool") return true
    if (resource === "skill") return validSkillKeys.has(key)
    if (resource === "knowledge") return true
    return false
  }

  // 3. VALIDATE TASK STRUCTURE
  if (!Array.isArray(parsed.tasks)) parsed.tasks = []

  let tasks = parsed.tasks
    .filter((t: any) => t && typeof t === "object")
    .map((t: any, i: number) => {
      const key = String(t.key ?? "").trim()
      let resource = ["tool","skill","knowledge"].includes(t.resource) ? t.resource : "tool"

      return {
        id: String(t.id ?? i + 1),
        resource,
        key,
        depends_on: Array.isArray(t.depends_on) ? t.depends_on.map((d: any) => String(d)) : [],
        confidence: typeof t.confidence === 'number'
          ? Math.max(0, Math.min(1, t.confidence))
          : undefined
      }
    })

  // 4. REMOVE INVALID KEYS
  const beforeFilter = tasks.length
  tasks = tasks.filter((t: any) => isValidKey(t.resource, t.key))
  debugMeta.removedInvalidTasks += beforeFilter - tasks.length

  // 5. DEDUPLICATE TASKS
  const seen = new Set<string>()
  tasks = tasks.filter((t: any) => {
    const hash = `${t.resource}:${t.key}`
    if (seen.has(hash)) {
      debugMeta.deduplicatedTasks++
      return false
    }
    seen.add(hash)
    return true
  })

  // 6. BUSINESS RULES
  const hasTool = tasks.some((t: any) => t.resource === "tool")
  const hasXlsGenerator = tasks.some(
    (t: any) => (t.resource === "skill") && t.key === "xls_generator"
  )
  if (hasXlsGenerator && !hasTool) {
    const before = tasks.length
    tasks = tasks.filter(
      (t: any) => !((t.resource === "skill") && t.key === "xls_generator")
    )
    debugMeta.removedInvalidTasks += before - tasks.length
  }

  // 7. IF EMPTY → CHAT MODE
  if (tasks.length === 0) {
    return {
      mode: "single_step",
      chat: true,
      tasks: [],
      meta: debugMeta
    }
  }

  // 8. REPAIR CYCLES (MUST BE BEFORE DEPENDENCY VALIDATION & PROPAGATION)
  const { tasks: repairedTasks, removedDependencies: cycleRemoved } = this.repairCycles(tasks)
  tasks = repairedTasks
  debugMeta.removedDependencies += cycleRemoved
  if (cycleRemoved > 0) debugMeta.repaired = true

  // 9. NORMALIZE IDs
  const { tasks: normalizedTasks } = this.normalizeTaskIds(tasks)
  tasks = normalizedTasks

  // 10. VALIDATE DEPENDENCIES (after cycle repair & ID normalization)
  const taskIds = new Set(tasks.map((t: any) => t.id))
  tasks.forEach((task: any) => {
    const before = task.depends_on.length
    task.depends_on = task.depends_on.filter((dep: string) => taskIds.has(dep))
    debugMeta.removedDependencies += before - task.depends_on.length
  })

  // 11. PROPAGATE CONFIDENCE (safe now - no cycles, valid IDs)
  const prePropagationConfidence = this.calculateGlobalConfidence(tasks)
  tasks = this.propagateDependencyConfidence(tasks)
  const postPropagationConfidence = this.calculateGlobalConfidence(tasks)

  // 12. DETERMINE MODE
  const isMultiStep = tasks.length > 1 || tasks.some((t: any) => t.depends_on.length > 0)

  // 13. DETECT AMBIGUITY
  const ambiguity = this.detectAmbiguity(parsed, tasks, input)

  // 14. BUILD RESULT
  const result: PlannerOutput = {
    mode: isMultiStep ? "multi_step" : "single_step",
    chat: false,
    tasks,
    meta: {
      ...debugMeta,
      preFilterConfidence: prePropagationConfidence,
      postFilterConfidence: postPropagationConfidence
    }
  }

  // 15. ADD OPTIONAL FIELDS
  if (options?.includeReasoning) {
    result.reasoning = parsed.reasoning || parsed.explanation || ''
  }

  if (options?.includeConfidence) {
    result.confidence = postPropagationConfidence
  }

  if (options?.includeClarification) {
      result.needsClarification = ambiguity.isAmbiguous;
      if (result.meta) {
        (result.meta as any).ambiguityScore = ambiguity.ambiguityScore;
        (result.meta as any).ambiguityReasons = ambiguity.reasons;
      }
  }

  if (result.meta) {
    (result.meta as any).workflowConfidence = postPropagationConfidence
  }

  return result
}

  // ===============================
  // HELPER METHODS
  // ===============================

  /**
   * ✅ Calculate global confidence with weighted penalty
   */
  private calculateGlobalConfidence(tasks: any[]): number {
    if (tasks.length === 0) return 0.0;

    const confidences = tasks.map(t => t.confidence ?? TASK_CONFIDENCE_MEDIUM);
    const avg = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    const min = Math.min(...confidences);

    // Weighted penalty: (average * 0.7) + (minimum * 0.3)
    return avg * 0.7 + min * 0.3;
  }

  /**
   * ✅ Propagate dependency confidence (weakest link)
   */
  private propagateDependencyConfidence(tasks: any[]): any[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    
    // Topological sort to process dependencies first
    const sorted = this.topologicalSort(tasks);
    
    // Propagate confidence through dependencies
    return sorted.map(task => {
      if (!task.depends_on || task.depends_on.length === 0) {
        return task;  // No dependencies
      }
      
      // Get all dependency confidences
      const dependencyConfidences = task.depends_on
        .map((depId: string) => taskMap.get(depId)?.confidence ?? TASK_CONFIDENCE_MEDIUM)
        .filter((c: number) => c !== undefined);
      
      if (dependencyConfidences.length === 0) {
        return task;
      }
      
      // Weakest link: minimum of task and all dependencies
      const minDependencyConfidence = Math.min(...dependencyConfidences);
      const effectiveConfidence = Math.min(
        task.confidence ?? TASK_CONFIDENCE_MEDIUM,
        minDependencyConfidence
      );
      
      return {
        ...task,
        confidence: effectiveConfidence,
      };
    });
  }

  /**
   * ✅ Topological sort for dependency processing
   */
  private topologicalSort(tasks: any[]): any[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set<string>();
    const result: any[] = [];
    
    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      visited.add(taskId);
      
      const task = taskMap.get(taskId);
      if (!task) return;
      
      // Visit dependencies first
      for (const depId of task.depends_on || []) {
        visit(depId);
      }
      
      result.push(task);
    };
    
    tasks.forEach(t => visit(t.id));
    return result;
  }

  /**
   * ✅ Detect ambiguity with improved heuristics
   * ✅ ISSUE #5: Better ambiguity detection (not just topDiff)
   * ✅ SIMPLIFIED: Removed async repository lookups for better performance
   */
  private detectAmbiguity(parsed: any, tasks: any[], input?: any): {
    isAmbiguous: boolean;
    ambiguityScore: number;
    reasons: string[];
  } {
    const reasons: string[] = [];
    let ambiguityScore = 0.0;

    // Guard against null/undefined
    if (!tasks || tasks.length === 0) {
      return { isAmbiguous: true, ambiguityScore: 1.0, reasons: ['No tasks generated'] };
    }

    const confidences = tasks.map(t => t.confidence ?? TASK_CONFIDENCE_MEDIUM);
    
    // Heuristic 1: ALL low confidence
    const allLowConfidence = confidences.every(c => c < TASK_CONFIDENCE_MEDIUM);
    if (allLowConfidence) {
      reasons.push('All candidates have low confidence');
      ambiguityScore += 0.4;
    }

    // Heuristic 2: Multiple HIGH confidence INDEPENDENT tasks with similar scores
    if (tasks.length >= 2) {
      const sorted = [...confidences].sort((a, b) => b - a);
      const topDiff = sorted[0] - sorted[1];
      
      if (sorted[0] >= TASK_CONFIDENCE_HIGH && 
          sorted[1] >= TASK_CONFIDENCE_HIGH && 
          topDiff < 0.05) {
        const topTasks = tasks.filter(t => t.confidence >= TASK_CONFIDENCE_HIGH);
        const hasNoDeps = topTasks.every(t => !t.depends_on || t.depends_on.length === 0);
        
        if (hasNoDeps) {
          reasons.push('Multiple high-confidence independent tasks with similar scores');
          ambiguityScore += 0.3;
        }
      }
    }

    // Heuristic 3: All tasks use completely different resource types
    const uniqueResources = new Set(tasks.map(t => t.resource));
    if (uniqueResources.size === tasks.length && tasks.length > 1) {
      reasons.push('All tasks use different resource types with no clear pattern');
      ambiguityScore += 0.2;
    }

    // Heuristic 4: LLM marked as uncertain
    if (parsed.uncertain || parsed.needsClarification) {
      reasons.push('LLM marked as uncertain');
      ambiguityScore += 0.3;
    }

    return {
      isAmbiguous: ambiguityScore >= 0.5,
      ambiguityScore: Math.min(ambiguityScore, 1.0),
      reasons
    };
  }

  /**
   * ✅ Normalize task IDs to sequential numbers
   */
  private normalizeTaskIds(tasks: any[]): { tasks: any[]; idMapping: Map<string, string> } {
    const idMapping = new Map<string, string>();
    
    const normalizedTasks = tasks.map((task, index) => {
      const newId = String(index + 1);
      idMapping.set(task.id, newId);
      
      return {
        ...task,
        id: newId
      };
    });
    
    // Remap dependencies to use new IDs
    return {
      tasks: normalizedTasks.map(task => ({
        ...task,
        depends_on: task.depends_on.map((depId: string) => idMapping.get(depId) || depId)
      })),
      idMapping
    };
  }

  /**
   * ✅ Repair cycles by removing only weakest edge
   */
  private repairCycles(tasks: any[]): { tasks: any[]; removedDependencies: number } {
    const taskMap = new Map(tasks.map(t => [t.id, { ...t }]));  // Clone for immutability
    let removedDependencies = 0;
    
    // Find cycles using DFS
    const cycles = this.findAllCycles(tasks);
    
    // For each cycle, remove only the weakest edge
    for (const cycle of cycles) {
      if (cycle.length < 2) continue;
      
      // Find the weakest edge in the cycle
      let weakestEdge = { from: null as string | null, to: null as string | null, confidence: 1.0 };
      
      for (let i = 0; i < cycle.length; i++) {
        const fromTask = taskMap.get(cycle[i]);
        const toTaskId = cycle[(i + 1) % cycle.length];
        const toTask = taskMap.get(toTaskId);
        
        if (!fromTask || !toTask) continue;
        
        // Edge confidence = minimum of both tasks
        const edgeConfidence = Math.min(
          fromTask.confidence ?? TASK_CONFIDENCE_MEDIUM,
          toTask.confidence ?? TASK_CONFIDENCE_MEDIUM
        );
        
        if (edgeConfidence < weakestEdge.confidence) {
          weakestEdge = { from: fromTask.id, to: toTaskId, confidence: edgeConfidence };
        }
      }
      
      // Remove only the weakest edge
      if (weakestEdge.from) {
        const fromTask = taskMap.get(weakestEdge.from);
        if (fromTask) {
          const before = fromTask.depends_on.length;
          fromTask.depends_on = fromTask.depends_on.filter((dep: string) => dep !== weakestEdge.to);
          removedDependencies += before - fromTask.depends_on.length;
        }
      }
    }
    
    return { 
      tasks: Array.from(taskMap.values()), 
      removedDependencies 
    };
  }

  /**
   * ✅ Find all cycles in task graph
   */
  private findAllCycles(tasks: any[]): string[][] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];
    
    const dfs = (taskId: string) => {
      if (recursionStack.has(taskId)) {
        // Found cycle - extract it
        const cycleStart = path.indexOf(taskId);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      
      if (visited.has(taskId)) return;
      
      visited.add(taskId);
      recursionStack.add(taskId);
      path.push(taskId);

      const task = taskMap.get(taskId);
      if (task) {
        for (const depId of task.depends_on || []) {
          dfs(depId);
        }
      }

      path.pop();
      recursionStack.delete(taskId);
    };

    tasks.forEach(t => dfs(t.id));
    return cycles;
  }

  private buildFrameGuidance(frame: any): string | null {
    if (!frame) return null;
    switch (frame.type) {
      case 'direct_task':
        return 'USER INGIN MENJALANKAN TUGAS LANGSUNG. Prioritaskan TOOL yang relevan (Jika ada). JANGAN pilih memory_recall, automation_manager';
      case 'comparison':
        return 'USER INGIN MEMBANDINGKAN DATA. Pilih TOOL yang relevan dengan query untuk mengambil data. JANGAN pilih skill analisis atau trend_analyzer — perbandingan akan ditangani otomatis oleh sistem setelah tool mengambil data.';
      case 'memory_question':
        return 'USER INGIN MENGINGAT RIWAYAT. Pilih skill memory_recall. JANGAN pilih automation_manager.';
      case 'memory_task_replay':
        return 'USER INGIN MENJALANKAN ULANG TUGAS LAMA. Memory recall dulu sebelum execution.';
      case 'automation_request':
        return 'USER INGIN MEMBUAT OTOMATISASI. Pilih automation_manager. JANGAN pilih tool.';
      case 'small_talk':
        return 'USER HANYA BERBICARA RINGAN. Pilih greeting skill.';
      case 'continuation_refine':
        return 'USER MELANJUTKAN PERCAKAPAN SEBELUMNYA.';
      default:
        return null;
    }
  }
}

export const toolPlannerService = new ToolPlannerService()
