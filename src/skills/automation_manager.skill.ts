// ============================================================
// AUTOMATION MANAGER SKILL
// ============================================================
// Creates future-work drafts for reminders, schedules, and monitoring.
// Persistence and scheduler execution are implemented in later phases.
// ============================================================

import type { PipelineInput } from '../types';
import type { AutomationJobDraft, AutomationJobType, AutomationManagerResult } from '../types/automation.types';
import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import { triggerNormalizerService } from '../services/automation/trigger-normalizer.service';
import { automationJobRepository } from '../repositories/automation-job.repository';
import { calculateNextRunFromCron } from '../utils/cron.util';
import { isGenericAutomationGoal, normalizeAutomationTypeLabel } from '../utils/automation-param.util';
import { toolService } from '../services/tools.service';
import { clarificationService } from '../services/clarification.service';
import { paramExtractorService } from '../services/paramExtractor.service';
import { openAiService } from '../services/openAi.service';
import { ollamaService } from '../services/ollama.service';
import { config } from '../config';

export const automationManagerSkill: InternalSkillMetadata = {
  name: 'Automation Manager',
  slug: 'automation_manager',
  description: 'Membuat dan mengelola pekerjaan masa depan seperti reminder, workflow terjadwal, dan monitoring berbasis kondisi.',
  handlerKey: 'handleAutomationManager',
  version: '0.1.0',
  tags: ['automation', 'schedule', 'reminder', 'monitoring', 'future_task'],
  category: 'automation',
  isHidden: false,
  capabilities: {
    actionTypes: ['automation', 'schedule', 'reminder', 'monitor'],
    outputFormats: ['automation_job'],
    triggers: [
      'ingatkan',
      'pengingat',
      'buat pengingat',
      'reminder',
      'buat reminder',
      'set alarm',
      'alarm',
      'tolong ingatkan',
      'jangan lupa',
      'jadwalkan',
      'setiap',
      'pantau',
      'monitor',
      'kalau',
      'jika',
      'kabari saya',
      'beri tahu saya',
      'remind me',
      'schedule',
      'notify me if',
      'monitor if',
      // ✅ ADDED: Report/automation reference triggers
      'laporkan',
      'laporkan ini',
      'kirim laporan',
      'kirim data',
      'kirim data ini',
      'kirim data di atas',
      'report this',
      'kirim dataa',
      'schedule this report'
    ],
    context: ['future_task', 'scheduled_workflow', 'conditional_alert'],
    priority: 10,
    requiresData: false
  },
  paramSchema: [
    {
      name: 'automation_type',
      type: 'select',
      description: 'Jenis automation: reminder, scheduled_workflow, atau conditional_alert.',
      isRequired: true,
      label: 'Jenis Automation',
      order: 1,
      config: {
        options: [
          { label: 'Reminder', value: 'reminder' },
          { label: 'Scheduled Workflow', value: 'scheduled_workflow' },
          { label: 'Conditional Alert', value: 'conditional_alert' }
        ]
      }
    },
    {
      name: 'goal',
      type: 'text',
      description: 'Tujuan automation dalam bahasa user.',
      isRequired: true,
      label: 'Tujuan',
      order: 2
    },
    {
      name: 'schedule',
      type: 'string',
      description: 'Waktu atau pola jadwal eksplisit, misalnya besok jam 7 pagi, setiap hari jam 5 sore, atau setiap Senin jam 9 pagi.',
      isRequired: false,
      label: 'Jadwal',
      order: 3
    },
    {
      name: 'condition',
      type: 'text',
      description: 'Kondisi pemicu, misalnya profit turun lebih dari 20%.',
      isRequired: false,
      label: 'Kondisi',
      order: 4
    },
    {
      name: 'notification_target',
      type: 'string',
      description: 'Target notifikasi jika disebutkan user.',
      isRequired: false,
      label: 'Target Notifikasi',
      order: 5
    }
  ]
};

function hasTemporalTriggerText(text: string | undefined): boolean {
  const normalized = String(text || '').toLowerCase();
  return /\b(jam|pukul|besok|hari ini|nanti|setiap|tiap|harian|mingguan|bulanan|daily|weekly|monthly|every)\b/.test(normalized) ||
    /\b\d{1,2}[:.]\d{2}\b/.test(normalized);
}

function buildReferencedQueryFromMemory(workingMemory: any): string {
  const activeTool = String(workingMemory?.activeTool || '').trim();
  const params = workingMemory?.metadata?.lastExecution?.params || workingMemory?.activeEntities || {};

  if (!activeTool) return '';

  const readableParts = Object.entries(params)
    .filter(([key, value]) => value !== undefined && value !== null && value !== '' && !String(key).startsWith('__'))
    .map(([key, value]) => `${key} ${value}`);

  return ['cek', activeTool.replace(/_/g, ' '), ...readableParts].join(' ').trim();
}

function extractInlineReferencedQuery(text: string): string {
  const normalized = String(text || '').trim();
  const match = normalized.match(/^(.*?)(?:\s+(?:dan|lalu|kemudian|terus)\s+)?(?:tolong\s+)?(?:laporkan|kirimkan|kirim|report|schedule)\s+(?:ini|this|itu|tersebut)\b/i);
  return match?.[1]?.trim() || '';
}

export const handleAutomationManager: ApiHandlerFn = async (
  params: Record<string, any>,
  context?: PipelineInput,
  agent?: any,
  input?: PipelineInput
): Promise<AutomationManagerResult> => {
  if (params._confirmed === true && params._draft) {
    const draft = params._draft as AutomationJobDraft;
    try {
      const created = await automationJobRepository.create({
        ...draft,
        status: 'active'
      });

      return {
        kind: 'automation_job_created',
        job: created,
        recommendation: {
          messageHints: [
            'Konfirmasi bahwa automation berhasil dibuat.',
            'Sebutkan waktu eksekusi berikutnya jika tersedia.'
          ],
          nextActions: [
            'Scheduler akan mengeksekusi job saat trigger jatuh tempo.'
          ]
        }
      };
    } catch (error) {
      return {
        kind: 'automation_job_failed',
        job: draft,
        error: error instanceof Error ? error.message : String(error),
        recommendation: {
          messageHints: [
            'Jelaskan bahwa automation gagal disimpan.',
            'Jangan mengklaim job sudah aktif.'
          ],
          nextActions: [
            'Periksa koneksi database atau migration automation_jobs.'
          ]
        }
      };
    }
  }

  const sourceText = String(context?.text || params.goal || '').trim();
  const automationType = normalizeAutomationType(params.automation_type, sourceText);
  const rawGoal = typeof params.goal === 'string' && !isGenericAutomationGoal(params.goal)
    ? params.goal.trim()
    : '';
  const schedule = typeof params.schedule === 'string' ? params.schedule.trim() : undefined;
  const condition = typeof params.condition === 'string' ? params.condition.trim() : undefined;
  const notificationTarget = typeof params.notification_target === 'string'
    ? params.notification_target.trim()
    : undefined;

  // ✅ PHASE 2: Detect reference to previous workflow ("ini", "this", "tersebut")
  const refersToPrevious = /\b(ini|this|tersebut|itu|terakhir)\b/i.test(sourceText);
  let referencedTool: string | null = null;
  let referencedParams: Record<string, unknown> = {};
  let referencedSourceText = '';
  let referencedAt: number | undefined;

  if (refersToPrevious && context?.attributes?.workingMemory) {
    const workingMemory = context.attributes.workingMemory as any;
    const lastExecution = workingMemory?.metadata?.lastExecution;
    
    // ✅ RESOLVE "ini" to previous tool execution
    referencedTool = lastExecution?.results ? Object.keys(lastExecution.results)[0] : null;
    referencedParams = lastExecution?.params || {};
    referencedSourceText = typeof lastExecution?.sourceText === 'string'
      ? lastExecution.sourceText.trim()
      : buildReferencedQueryFromMemory(workingMemory);
    referencedAt = typeof lastExecution?.timestamp === 'number' ? lastExecution.timestamp : undefined;
    
    console.log('[AutomationManager] Resolved "ini" to previous execution', {
      referencedTool,
      referencedSourceText,
      referencedParams: Object.keys(referencedParams),
      executedAt: lastExecution?.timestamp
    });
  }

  if (refersToPrevious && !referencedSourceText) {
    referencedSourceText = extractInlineReferencedQuery(sourceText);
  }

  const goal = refersToPrevious && referencedSourceText
    ? referencedSourceText
    : rawGoal;
  const scheduleSource = hasTemporalTriggerText(sourceText)
    ? sourceText
    : schedule;
  const triggerNormalization = scheduleSource && hasTemporalTriggerText(scheduleSource)
    ? triggerNormalizerService.normalize(scheduleSource)
    : undefined;
  const resolvedSchedule = triggerNormalization?.trigger?.sourceText || schedule;

  const missing = collectMissingFields(automationType, goal, resolvedSchedule, condition);
  for (const missingPart of triggerNormalization?.missing || []) {
    if (!missing.includes(missingPart)) missing.push(missingPart);
  }

  const job = await buildDraftJob({
    userId: context?.user_id,
    appName: context?.app_name,
    type: automationType,
    goal,
    sourceText,
    schedule: resolvedSchedule,
    condition,
    notificationTarget,
    trigger: triggerNormalization?.trigger,
    nextRunAt: resolveNextRunAt(triggerNormalization?.trigger),
    workflowParams: context?.attributes?.params as Record<string, unknown> | undefined,
    // ✅ Pass referenced tool and params in workflow
    workflow: {
      referencedTool: referencedTool,
      referencedParams: referencedParams,
      referencedAt,
      referencedSourceText,
      scheduleInstruction: resolvedSchedule
    }
  });

  // ✅ PHASE 4: Check for missing params from referenced tool
  if (refersToPrevious && referencedTool) {
    const tools = await toolService.getToolsBySlugs([referencedTool]);
    
    if (tools.length > 0) {
      const tool = tools[0];
      
      // ✅ USE EXISTING FUNCTION: toolService.getMissingParamsFromTool()
      const missingFromRef = toolService.getMissingParamsFromTool(tool, referencedParams);
      
      if (missingFromRef.length > 0) {
        // ✅ USE EXISTING FUNCTION: clarificationService.askForMultipleParametersFromTools()
        const question = await clarificationService.askForMultipleParametersFromTools(
          agent!,
          input!,
          [{ tool, missing: missingFromRef }],
          (input?.language || 'Indonesia')
        );
        
        return {
          kind: 'automation_clarification_required',
          job,
          missing: missingFromRef,
          recommendation: {
            messageHints: ['Minta parameter yang missing untuk automation.'],
            nextActions: ['Lanjutkan slot filling untuk parameter yang missing.']
          }
        };
      }
    }
  }

  if (missing.length > 0) {
    return {
      kind: 'automation_clarification_required',
      job,
      missing,
      recommendation: {
        messageHints: [
          'Minta informasi yang belum lengkap sebelum membuat automation.',
          'Jangan mengklaim automation sudah aktif.'
        ],
        nextActions: [
          'Lanjutkan slot filling untuk field yang missing.'
        ]
      }
    };
  }

  if (params._persist === false) {
    return {
      kind: 'automation_job_draft',
      job,
      recommendation: {
        messageHints: [
          'Jelaskan bahwa automation sudah dipahami sebagai draft pekerjaan masa depan.',
          'Jangan mengklaim notifikasi sudah dikirim jika jadwalnya masa depan.'
        ],
        nextActions: [
          'Persist job dengan automation runtime jika user mengonfirmasi.'
        ]
      }
    };
  }

  if (params._confirmed !== true) {
    return {
      kind: 'confirmation_required',
      job,
      confirmation: {
        type: 'automation_job_create',
        editableFields: [
          'goal',
          'schedule',
          'trigger',
          'trigger.runAt',
          'condition',
          'notification',
          'notification.target',
          'notification.channel',
          'notification.offsetMinutes'
        ],
        expiresInMs: 60 * 1000,
        summary: {
          title: job.title,
          goal: job.goal,
          type: job.type,
          runAt: job.trigger.runAt,
          cron: job.trigger.cron,
          notificationTarget: job.notification?.target,
          notificationOffsetMinutes: (job.notification as any)?.offsetMinutes
        }
      },
      recommendation: {
        messageHints: [
          'Kembalikan ringkasan draft automation yang ditangkap sistem.',
          'Minta konfirmasi user sebelum menyimpan.',
          'Sebutkan user masih bisa mengubah waktu atau membatalkan.'
        ],
        nextActions: [
          'Tunggu jawaban user: simpan, ubah, atau batalkan.'
        ]
      }
    };
  }

  try {
    const created = await automationJobRepository.create({
      ...job,
      status: 'active'
    });

    return {
      kind: 'automation_job_created',
      job: created,
      recommendation: {
        messageHints: [
          'Konfirmasi bahwa automation berhasil dibuat.',
          'Sebutkan waktu eksekusi berikutnya jika tersedia.',
          'Jangan mengklaim notifikasi sudah dikirim jika jadwalnya masa depan.'
        ],
        nextActions: [
          'Scheduler akan mengeksekusi job saat trigger jatuh tempo.'
        ]
      }
    };
  } catch (error) {
    return {
      kind: 'automation_job_failed',
      job,
      error: error instanceof Error ? error.message : String(error),
      recommendation: {
        messageHints: [
          'Jelaskan bahwa automation sudah dipahami tetapi gagal disimpan.',
          'Jangan mengklaim job sudah aktif.'
        ],
        nextActions: [
          'Periksa koneksi database atau migration automation_jobs.'
        ]
      }
    };
  }

};

function normalizeAutomationType(value: unknown, sourceText: string): AutomationJobType {
  const typeFromLabel = normalizeAutomationTypeLabel(value);
  if (typeFromLabel) return typeFromLabel;

  const normalized = String(value || '').toLowerCase().trim();
  if (normalized === 'reminder' || normalized === 'scheduled_workflow' || normalized === 'conditional_alert') {
    return normalized;
  }

  const text = sourceText.toLowerCase();
  if (/\b(kalau|jika|if|when|pantau|monitor)\b/.test(text)) return 'conditional_alert';
  if (/\b(setiap|tiap|harian|mingguan|bulanan|every|daily|weekly|monthly)\b/.test(text)) return 'scheduled_workflow';
  return 'reminder';
}

function collectMissingFields(
  type: AutomationJobType,
  goal: string,
  schedule?: string,
  condition?: string
): string[] {
  const missing: string[] = [];
  if (!goal) missing.push('goal');
  if ((type === 'reminder' || type === 'scheduled_workflow' || type === 'conditional_alert') && !schedule) {
    missing.push('schedule');
  }
  if (type === 'conditional_alert' && !condition) missing.push('condition');
  return missing;
}

function normalizeCondition(sourceText: string): AutomationJobDraft['condition'] {
  const text = String(sourceText || '').toLowerCase();
  const numberMatch = text.match(/\b(\d+(?:[.,]\d+)?)\b/);
  const value = numberMatch ? Number(numberMatch[1].replace(',', '.')) : undefined;
  const metric = extractConditionMetric(text);

  if (/\b(turun|menurun|lebih rendah|decrease|down|drop|decline)\b/i.test(text)) {
    return { kind: 'comparison', sourceText, metric, operator: 'decrease_percent', value };
  }

  if (/\b(naik|meningkat|lebih tinggi|increase|up|rise|growth)\b/i.test(text)) {
    return { kind: 'comparison', sourceText, metric, operator: 'increase_percent', value };
  }

  if (/\b(lebih dari|lebih besar dari|di atas|above|greater than|>)\b/i.test(text)) {
    return { kind: 'threshold', sourceText, metric, operator: 'gt', value };
  }

  if (/\b(minimal|setidaknya|paling sedikit|greater or equal|>=)\b/i.test(text)) {
    return { kind: 'threshold', sourceText, metric, operator: 'gte', value };
  }

  if (/\b(kurang dari|di bawah|below|less than|<)\b/i.test(text)) {
    return { kind: 'threshold', sourceText, metric, operator: 'lt', value };
  }

  if (/\b(maksimal|paling banyak|less or equal|<=)\b/i.test(text)) {
    return { kind: 'threshold', sourceText, metric, operator: 'lte', value };
  }

  if (/\b(sama dengan|equal|=)\b/i.test(text)) {
    return { kind: 'threshold', sourceText, metric, operator: 'eq', value };
  }

  return { kind: 'threshold', sourceText, metric, operator: value !== undefined ? 'gt' : undefined, value };
}

function extractConditionMetric(text: string): string | undefined {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/\b(kalau|jika|if|when|apabila|data|jumlah|total|unit|lebih|dari|besar|kecil|kurang|di|atas|bawah|minimal|maksimal|setidaknya|paling|sedikit|banyak|sama|dengan)\b/gi, ' ')
    .replace(/\b(bandingkan|compare|vs|versus|dibandingkan|turun|menurun|naik|meningkat|percent|persen)\b/gi, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\b/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1] || tokens[0] || undefined;
}

async function buildDraftJob(input: {
  userId?: string;
  appName?: string;
  type: AutomationJobType;
  goal: string;
  sourceText: string;
  schedule?: string;
  condition?: string;
  notificationTarget?: string;
  trigger?: AutomationJobDraft['trigger'];
  nextRunAt?: string | null;
  workflowParams?: Record<string, unknown>;
  workflow?: {
    referencedTool?: string | null;
    referencedParams?: Record<string, unknown>;
    referencedAt?: number;
    referencedSourceText?: string;
    scheduleInstruction?: string;
  };
}): Promise<AutomationJobDraft> {
  const triggerKind = input.type === 'conditional_alert'
    ? 'condition'
    : input.type === 'scheduled_workflow'
      ? 'recurring'
      : 'once';

  return {
    userId: input.userId,
    appName: input.appName,
    title: await buildTitle(input.type, input.goal, input.sourceText),
    goal: input.goal,
    type: input.type,
    trigger: input.trigger || {
      kind: triggerKind,
      sourceText: input.schedule || input.sourceText
    },
    condition: input.condition
      ? normalizeCondition(input.condition)
      : undefined,
    workflow: {
      sourceText: input.goal || input.sourceText,
      reusable: input.type !== 'reminder',
      params: input.workflowParams || {},
      // ✅ ADDED: For "ini" reference resolution
      referencedTool: input.workflow?.referencedTool,
      referencedParams: input.workflow?.referencedParams,
      referencedAt: input.workflow?.referencedAt,
      referencedSourceText: input.workflow?.referencedSourceText,
      scheduleInstruction: input.workflow?.scheduleInstruction
    },
    action: {
      resource: 'skill',
      key: 'notification_manager',
      params: {
        message: input.goal,
        target: input.notificationTarget
      }
    },
    notification: {
      target: input.notificationTarget,
      channel: 'chat',
      messageTemplate: input.goal,
      notifyOnlyOnCondition: input.type === 'conditional_alert'
    },
    status: 'draft',
    safety: {
      requiresConfirmation: input.type !== 'reminder',
      sideEffectLevel: 'none'
    },
    nextRunAt: input.nextRunAt || null
  };
}

function resolveNextRunAt(trigger?: AutomationJobDraft['trigger']): string | null {
  if (!trigger) return null;
  if (trigger.runAt) return trigger.runAt;
  if (trigger.cron) {
    return calculateNextRunFromCron(trigger.cron)?.toISOString() || null;
  }
  return null;
}

/**
 * Build automation job title with Hybrid approach (Rule + LLM Fallback)
 */
async function buildTitle(
  type: AutomationJobType,
  goal: string,
  userQuery: string
): Promise<string> {
  const prefix = type === 'reminder'
    ? 'Reminder'
    : type === 'scheduled_workflow'
      ? 'Scheduled Workflow'
      : 'Conditional Alert';

  // ✅ STEP 1: Try rule-based extraction (fast)
  const ruleBasedTitle = `${prefix}: ${goal.slice(0, 60)}`;

  // ✅ STEP 2: Check if too generic
  if (!isTooGeneric(ruleBasedTitle)) {
    return ruleBasedTitle;
  }

  // ✅ STEP 3: Too generic, use LLM to extract better title
  try {
    const provider = config.default?.provider || 'ollama';
    const llmModel = provider === 'qwen'
      ? config.alibaba?.llmModel
      : config.ollama?.llmModel;

    const prompt = `
Extract concise title for automation job:

User Query: "${userQuery}"
Type: ${type}
Goal: ${goal}

Rules:
- Max 60 characters
- Include key entities (who, what, when)
- Natural and descriptive
- Indonesian language
- Format: "${prefix}: [title]"

Examples:
- "Reminder: Meeting dengan client jam 14:00"
- "Alert: Stok barang menipis"
- "Workflow: Laporan harian attendance"

Title:`;

    let title: string;

    if (provider === 'qwen') {
      title = await openAiService.chatMessage(
        [{ role: 'user' as const, content: prompt }],
        llmModel,
        { temperature: 0.3, num_predict: 30 }
      );
    } else {
      title = await ollamaService.chatMessage(
        [{ role: 'user' as const, content: prompt }],
        llmModel,
        { temperature: 0.3, num_predict: 30 }
      );
    }

    // Clean and validate
    title = title.trim().replace(/^["']|["']$/g, '');

    // Ensure starts with prefix
    if (!title.startsWith(prefix)) {
      title = `${prefix}: ${title}`;
    }

    // Truncate if too long
    if (title.length > 60) {
      title = title.slice(0, 57) + '...';
    }

    return title || ruleBasedTitle;

  } catch (error) {
    // Fallback to rule-based if LLM fails
    console.warn('[AutomationManager] LLM title extraction failed, using rule-based', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return ruleBasedTitle;
  }
}

/**
 * Check if title is too generic
 */
function isTooGeneric(title: string): boolean {
  const genericPatterns = [
    /^(Reminder|Alert|Scheduled Workflow|Conditional Alert):\s*$/i,
    /^(Reminder|Alert|Scheduled Workflow|Conditional Alert):\s*ada\s+/i,
    /^(Reminder|Alert|Scheduled Workflow|Conditional Alert):\s*ini\s+/i,
    /^(Reminder|Alert|Scheduled Workflow|Conditional Alert):\s*pekerjaan ini\s*$/i,
    /^(Reminder|Alert|Scheduled Workflow|Conditional Alert):\s*\.\.\.\s*$/i,
  ];

  return genericPatterns.some(pattern => pattern.test(title));
}

export default {
  metadata: automationManagerSkill,
  handler: handleAutomationManager
} as InternalSkillModule;
