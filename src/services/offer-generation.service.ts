import { randomUUID } from 'node:crypto';
import type { PipelineExecutedTaskDetail, PipelineInput } from '../types';
import type { PlannerOutput, PlannerTask } from '../types/planner.types';
import type { WorkingMemoryData } from '../types/working-memory.type';
import type { ActiveOffer } from '../types/active-offer.types';
import { skillsRegistry } from './skills-registry.service';
import { toolService } from './tools.service';
import { PipelineValidator } from '../utils/pipeline-validator.util';
import { episodicMemoryService } from './episodic-memory.service';

export interface OfferGenerationContext {
  input: PipelineInput;
  plan: PlannerOutput;
  params: Record<string, unknown>;
  results: Record<string, unknown>;
  executedTasks: PipelineExecutedTaskDetail[];
  workingMemory?: WorkingMemoryData | null;
}

export interface OfferGenerationResult {
  offers: ActiveOffer[];
  selectedOffer?: ActiveOffer;
}

const OFFER_TTL_MS = 2 * 60 * 1000;
const BEHAVIOR_LOOKBACK_DAYS = 30;
const PERSONALIZATION_BOOST = 0.08; // Confidence boost for behavior-matched offers

class OfferGenerationService {
  async generate(context: OfferGenerationContext): Promise<OfferGenerationResult> {
    const candidates: ActiveOffer[] = [];

    candidates.push(...await this.buildSameToolParamOffers(context));
    candidates.push(...await this.buildStringParamPromptOffers(context));
    candidates.push(...this.buildGreetingCapabilityOffer(context));
    candidates.push(...this.buildMemoryRecallRerunOffer(context));
    candidates.push(...this.buildAnalyzeOffer(context));
    candidates.push(...this.buildExportOffer(context));

    // Personalize: boost offers based on user behavior history
    const personalized = await this.applyPersonalization(candidates, context);

    const offers = this.rankCandidates(personalized.filter(candidate => this.validateCandidate(candidate, context)));

    return {
      offers,
      selectedOffer: offers[0]
    };
  }

  private async buildSameToolParamOffers(context: OfferGenerationContext): Promise<ActiveOffer[]> {
    const toolTask = this.getPrimaryToolTask(context.plan);
    if (!toolTask) return [];

    const result = context.results[toolTask.key];
    if (this.isErrorResult(result)) return [];

    const summaryDimensions = this.detectSummaryDimensions(result);
    if (summaryDimensions.length === 0) return [];

    const tools = await toolService.getToolsBySlugs([toolTask.key]);
    const tool = tools[0];
    if (!tool) return [];

    const params = toolService.getToolParams(tool);
    const optionParams = params.filter(param =>
      !param.isHidden &&
      !this.isUnsafeOfferParam(param.name) &&
      ['select', 'multiselect'].includes(param.type) &&
      Array.isArray(param.config?.options) &&
      param.config.options.length > 0
    );

    for (const param of optionParams) {
      const currentValue = String(context.params[param.name] || '').toLowerCase();
      const targetOption = param.config?.options?.find(option => {
        const value = String(option.value || '').toLowerCase();
        return value !== currentValue && summaryDimensions.includes(value);
      });

      if (!targetOption || !PipelineValidator.validateParamValue(param, targetOption.value)) {
        continue;
      }

      const label = param.label || param.name;
      return [
        this.createOffer({
          type: 'refine_param',
          label: `Lihat ${label} ${targetOption.label || targetOption.value}`,
          suggestedText: `Mau saya tampilkan data dengan ${label} ${targetOption.label || targetOption.value}?`,
          reason: `Result memiliki dimensi ${summaryDimensions.join(', ')} dan tool mendukung pilihan ${param.name}.`,
          sourceTask: toolTask,
          targetResource: 'tool',
          targetKey: toolTask.key,
          paramsPatch: { [param.name]: targetOption.value },
          clearParams: ['search'],
          confidence: 0.84
        })
      ];
    }

    return [];
  }

  private buildAnalyzeOffer(context: OfferGenerationContext): ActiveOffer[] {
    const sourceTask = this.getPrimaryResultTask(context.plan);
    if (!sourceTask || !skillsRegistry.hasSkill('data_analyzer')) return [];
    if (!this.canOfferDataSkillFromSource(sourceTask)) return [];

    const result = context.results[sourceTask.key];
    if (this.isErrorResult(result) || this.detectEmptyResult(result)) return [];

    return [
      this.createOffer({
        type: 'analyze_result',
        label: 'Analisis ringkas data ini',
        suggestedText: 'Mau saya bantu analisis ringkas datanya?',
        reason: 'Hasil eksekusi tersedia dan skill data_analyzer mendukung analisis data.',
        sourceTask,
        targetResource: 'skill',
        targetKey: 'data_analyzer',
        paramsPatch: { data: result, userQuery: context.input.text },
        confidence: 0.80
      })
    ];
  }

  private async buildStringParamPromptOffers(context: OfferGenerationContext): Promise<ActiveOffer[]> {
    const toolTask = this.getPrimaryToolTask(context.plan);
    if (!toolTask) return [];

    const result = context.results[toolTask.key];
    if (this.isErrorResult(result) || this.detectEmptyResult(result)) return [];

    const tools = await toolService.getToolsBySlugs([toolTask.key]);
    const tool = tools[0];
    if (!tool) return [];

    const params = toolService.getToolParams(tool);
    const param = params.find(candidate =>
      !candidate.isHidden &&
      !this.isUnsafeOfferParam(candidate.name) &&
      ['string', 'text'].includes(candidate.type) &&
      !context.params[candidate.name] &&
      this.isSearchLikeParam(candidate.name, candidate.label)
    );

    if (!param) return [];

    const label = param.label || param.name;
    return [
      this.createOffer({
        type: 'refine_param',
        label: `Cari berdasarkan ${label}`,
        suggestedText: `Mau cari berdasarkan ${label}?`,
        reason: `Tool mendukung filter teks ${param.name}, tetapi nilainya harus diisi user.`,
        sourceTask: toolTask,
        targetResource: 'tool',
        targetKey: toolTask.key,
        clearParams: [param.name],
        promptForParam: {
          name: param.name,
          label,
          question: `Silakan masukkan ${label} yang ingin dicari.`
        },
        confidence: 0.72
      })
    ];
  }

  private isSearchLikeParam(name: string, label?: string): boolean {
    const normalized = `${name} ${label || ''}`.toLowerCase();
    return /\b(search|keyword|query|name|nama|employee|driver|plate|phone)\b/.test(normalized);
  }

  private buildExportOffer(context: OfferGenerationContext): ActiveOffer[] {
    const sourceTask = this.getPrimaryResultTask(context.plan);
    if (!sourceTask || !skillsRegistry.hasSkill('xls_generator')) return [];
    if (!this.canOfferDataSkillFromSource(sourceTask)) return [];

    const result = context.results[sourceTask.key];
    if (this.isErrorResult(result) || !this.detectRecordArray(result)) return [];

    return [
      this.createOffer({
        type: 'export_result',
        label: 'Buatkan file Excel',
        suggestedText: 'Mau saya buatkan file Excel dari data ini?',
        reason: 'Hasil berisi record data dan skill xls_generator tersedia.',
        sourceTask,
        targetResource: 'skill',
        targetKey: 'xls_generator',
        paramsPatch: { data: result, format: 'xlsx' },
        confidence: 0.79
      })
    ];
  }

  private buildGreetingCapabilityOffer(context: OfferGenerationContext): ActiveOffer[] {
    const sourceTask = this.getPrimaryResultTask(context.plan);
    if (!sourceTask || sourceTask.resource !== 'skill' || sourceTask.key !== 'greeting') return [];
    if (!skillsRegistry.hasSkill('greeting')) return [];

    const result = context.results[sourceTask.key];
    if (!result || typeof result !== 'object' || this.isErrorResult(result)) return [];

    const recommendation = (result as Record<string, any>).recommendation;
    if (recommendation?.offerCapabilityList !== true) return [];

    return [
      this.createOffer({
        type: 'show_capabilities',
        label: 'Tampilkan kemampuan yang tersedia',
        suggestedText: 'Mau saya tampilkan hal-hal yang bisa saya bantu?',
        reason: 'Greeting skill merekomendasikan daftar kemampuan untuk user.',
        sourceTask,
        targetResource: 'skill',
        targetKey: 'greeting',
        paramsPatch: { show_skills: true },
        confidence: 0.86
      })
    ];
  }

  private buildMemoryRecallRerunOffer(context: OfferGenerationContext): ActiveOffer[] {
    const sourceTask = this.getPrimaryResultTask(context.plan);
    if (!sourceTask || sourceTask.resource !== 'skill' || sourceTask.key !== 'memory_recall') return [];

    const result = context.results[sourceTask.key] as any;
    if (!result || typeof result !== 'object' || this.isErrorResult(result) || result.isEmpty === true) {
      return [];
    }

    const items = Array.isArray(result.items) ? result.items : [];
    const executable = items
      .map((item: any) => this.extractExecutableMemoryTask(item))
      .find(Boolean);

    if (!executable) return [];

    return [
      this.createOffer({
        type: 'rerun_memory_task',
        label: `Jalankan ulang ${executable.key}`,
        suggestedText: 'Mau saya tampilkan kembali data dari pembahasan itu?',
        reason: 'Memory recall menemukan task plan lama yang dapat dijalankan ulang secara aman.',
        sourceTask,
        targetResource: executable.resource,
        targetKey: executable.key,
        paramsPatch: executable.params,
        confidence: 0.82
      })
    ];
  }

  private extractExecutableMemoryTask(item: any): {
    resource: 'tool' | 'skill';
    key: string;
    params: Record<string, unknown>;
  } | null {
    const tasks = item?.taskPlan?.tasks;
    if (!Array.isArray(tasks)) return null;

    const task = tasks.find((candidate: any) => candidate?.resource === 'tool')
      || tasks.find((candidate: any) => candidate?.resource === 'skill' && candidate.key !== 'memory_recall');

    if (!task?.key || (task.resource !== 'tool' && task.resource !== 'skill')) {
      return null;
    }

    const traceItems = Array.isArray(item?.flowTrace) ? item.flowTrace : [];
    const matchedTrace = traceItems.find((trace: any) => trace?.key === task.key && trace?.params && typeof trace.params === 'object');
    const params = this.cleanOfferParams(matchedTrace?.params || {});

    return {
      resource: task.resource,
      key: task.key,
      params
    };
  }

  private cleanOfferParams(params: Record<string, unknown>): Record<string, unknown> {
    const blocked = new Set([
      '__dateBlind',
      '__temporalQuestionType',
      '__clearedTemporalFilters'
    ]);

    return Object.fromEntries(
      Object.entries(params).filter(([key, value]) =>
        !blocked.has(key) &&
        value !== undefined &&
        value !== null &&
        value !== ''
      )
    );
  }

  private createOffer(input: {
    type: ActiveOffer['type'];
    label: string;
    suggestedText?: string;
    reason: string;
    sourceTask: PlannerTask;
    targetResource: 'tool' | 'skill';
    targetKey: string;
    paramsPatch?: Record<string, unknown>;
    clearParams?: string[];
    promptForParam?: ActiveOffer['target']['promptForParam'];
    confidence: number;
  }): ActiveOffer {
    const now = Date.now();

    return {
      id: `offer_${randomUUID()}`,
      status: 'active',
      type: input.type,
      label: input.label,
      suggestedText: input.suggestedText,
      reason: input.reason,
      source: {
        resource: input.sourceTask.resource,
        key: input.sourceTask.key,
        planTaskId: input.sourceTask.id
      },
      target: {
        resource: input.targetResource,
        key: input.targetKey,
        paramsPatch: input.paramsPatch,
        clearParams: input.clearParams,
        promptForParam: input.promptForParam,
        inheritParams: true,
        dependsOnLastResult: input.targetResource === 'skill'
      },
      expectedAnswer: 'boolean',
      confidence: input.confidence,
      safety: {
        requiresConfirmation: true,
        sideEffectLevel: 'none'
      },
      expiresAt: now + OFFER_TTL_MS,
      createdAt: now
    };
  }

  private async applyPersonalization(
    candidates: ActiveOffer[],
    context: OfferGenerationContext
  ): Promise<ActiveOffer[]> {
    if (candidates.length <= 1) return candidates;

    try {
      const { user_id, app_name } = context.input;
      if (!user_id || !app_name) return candidates;

      // Fetch recent behavior from episodic memory
      const recentContext = await episodicMemoryService.getRecentContext(
        user_id,
        app_name,
        BEHAVIOR_LOOKBACK_DAYS
      );

      if (!recentContext) return candidates;

      const recentText = String(recentContext || '').toLowerCase();

      // Detect behavior patterns from recent history
      const behaviorHints = this.detectBehaviorHints(recentText);

      if (behaviorHints.length === 0) return candidates;

      // Boost matching offers
      return candidates.map(candidate => {
        const boost = this.calculateBoost(candidate, behaviorHints);
        if (boost > 0) {
          return {
            ...candidate,
            confidence: Math.min(candidate.confidence + boost, 0.98),
            reason: `${candidate.reason} (Dipersonalisasi: user sering ${behaviorHints.join(', ')})`
          };
        }
        return candidate;
      });
    } catch {
      return candidates; // Never block offer generation on error
    }
  }

  /**
   * Detect behavior hints from recent episodic memory text.
   * "export, excel, download" → export behavior
   * "analisis, bandingkan" → analyze behavior
   * "active, leave" → specific status interest
   */
  private detectBehaviorHints(recentText: string): string[] {
    const hints: string[] = [];

    const exportSignals = /\b(export|excel|download|simpan|xlsx|csv|file)\b/gi;
    const analyzeSignals = /\b(analisis|analisa|bandingkan|compare|trend|insight|ringkas)\b/gi;
    const statusSignals = /\bstatus\s+(active|leave|exit)\b/gi;

    if ((recentText.match(exportSignals) || []).length >= 2) {
      hints.push('export data');
    }
    if ((recentText.match(analyzeSignals) || []).length >= 2) {
      hints.push('analisis data');
    }

    const statusMatches = [...recentText.matchAll(statusSignals)];
    if (statusMatches.length >= 2) {
      const statuses = [...new Set(statusMatches.map(m => m[1].toLowerCase()))];
      if (statuses.length === 1) {
        hints.push(`cek status ${statuses[0]}`);
      }
    }

    return hints;
  }

  /**
   * Calculate confidence boost based on behavior match.
   */
  private calculateBoost(candidate: ActiveOffer, behaviorHints: string[]): number {
    let boost = 0;

    for (const hint of behaviorHints) {
      if (hint === 'export data' && candidate.type === 'export_result') {
        boost += PERSONALIZATION_BOOST;
      }
      if (hint === 'analisis data' && candidate.type === 'analyze_result') {
        boost += PERSONALIZATION_BOOST;
      }
      if (hint.startsWith('cek status') && candidate.type === 'refine_param') {
        const targetStatus = hint.replace('cek status ', '');
        if (candidate.label.toLowerCase().includes(targetStatus)) {
          boost += PERSONALIZATION_BOOST;
        }
      }
    }

    return boost;
  }

  private rankCandidates(candidates: ActiveOffer[]): ActiveOffer[] {
    return candidates
      .filter(candidate => candidate.confidence >= 0.70)
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 1);
  }

  private validateCandidate(candidate: ActiveOffer, context: OfferGenerationContext): boolean {
    if (candidate.status !== 'active') return false;
    if (candidate.expiresAt <= Date.now()) return false;
    if (candidate.safety.sideEffectLevel !== 'none') return false;
    if (!candidate.target.key) return false;
    if (!context.results[candidate.source.key]) return false;
    return true;
  }

  private getPrimaryToolTask(plan: PlannerOutput): PlannerTask | undefined {
    return plan.tasks.find(task => task.resource === 'tool');
  }

  private getPrimaryResultTask(plan: PlannerOutput): PlannerTask | undefined {
    return plan.tasks.find(task => task.resource === 'tool')
      || plan.tasks.find(task => task.resource === 'skill');
  }

  private canOfferDataSkillFromSource(sourceTask: PlannerTask): boolean {
    if (sourceTask.resource === 'tool') {
      return true;
    }

    if (sourceTask.resource !== 'skill') {
      return false;
    }

    const sourceSkill = skillsRegistry.getSkillBySlug(sourceTask.key);
    return sourceSkill?.capabilities?.requiresData === true;
  }

  detectEmptyResult(result: unknown): boolean {
    if (Array.isArray(result)) return result.length === 0;
    if (!result || typeof result !== 'object') return false;

    const record = result as Record<string, unknown>;
    for (const value of Object.values(record)) {
      if (Array.isArray(value) && value.length === 0) return true;
    }
    return record.total === 0 || record.count === 0;
  }

  detectSummaryDimensions(result: unknown): string[] {
    if (!result || typeof result !== 'object') return [];
    const summary = (result as Record<string, unknown>).summary;
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return [];

    return Object.entries(summary as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'number' && value > 0)
      .map(([key]) => key);
  }

  detectRecordArray(result: unknown): boolean {
    if (Array.isArray(result)) return result.length > 0;
    if (!result || typeof result !== 'object') return false;

    const record = result as Record<string, unknown>;
    return Object.values(record).some(value => Array.isArray(value) && value.length > 0);
  }

  private isErrorResult(result: unknown): boolean {
    return !!result && typeof result === 'object' && 'error' in (result as Record<string, unknown>);
  }

  private isUnsafeOfferParam(name: string): boolean {
    const normalized = String(name || '').toLowerCase();
    return normalized === 'id' || normalized.endsWith('_id') || normalized.includes('password') || normalized.includes('token');
  }
}

export const offerGenerationService = new OfferGenerationService();
