// ============================================================
// MEMORY RECALL SKILL
// ============================================================
// Retrieves grounded episodic memory when user asks about prior context.
// ============================================================

import type { PipelineInput } from '../types';
import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import { memoryRecallService } from '../services/memory-recall.service';

export const memoryRecallSkill: InternalSkillMetadata = {
  name: 'Memory Recall',
  slug: 'memory_recall',
  description: 'Memory untuk mengingat dan merangkum riwayat percakapan atau pertanyaan user sebelumnya',
  handlerKey: 'handleMemoryRecall',
  version: '1.0.0',
  tags: ['memory', 'recall', 'history', 'conversation', 'context', 'riwayat'],
  category: 'memory',
  isHidden: false,
  capabilities: {
    actionTypes: ['recall', 'history', 'context_lookup'],
    outputFormats: ['summary', 'timeline', 'memory_items'],
    triggers: [
      'apa yang saya tanyakan',
      'saya tanya apa',
      'apa yang saya bahas',
      'saya bahas apa',
      'kemarin saya',
      'tadi saya',
      'sebelumnya saya',
      'riwayat',
      'history',
      'ingat',
      'pernah dibahas',
      'topik terakhir',
      'tanyakan',
      'bahas',
      'isi memory',
      'isi ingatan',
      'isi memori',
      'apa yang diingat',
      'apa yang disimpan',
      'memory anda',
      'ingatan anda',
      'memori anda'
    ],
    context: ['memory_retrieval', 'conversation_history'],
    priority: 9,
    requiresData: false
  },
  paramSchema: [
    {
      name: 'recall_mode',
      type: 'select',
      description: 'Mode recall: auto, recent, date, range, intent',
      isRequired: false,
      defaultValue: 'auto',
      label: 'Mode Recall',
      order: 1,
      config: {
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Recent', value: 'recent' },
          { label: 'Date', value: 'date' },
          { label: 'Range', value: 'range' },
          { label: 'Intent', value: 'intent' }
        ]
      }
    },
    {
      name: 'date',
      type: 'string',
      description: 'Tanggal spesifik untuk recall, format YYYY-MM-DD',
      isRequired: false,
      label: 'Tanggal',
      order: 2
    },
    {
      name: 'start_date',
      type: 'string',
      description: 'Awal rentang tanggal, format YYYY-MM-DD',
      isRequired: false,
      label: 'Tanggal Mulai',
      order: 3
    },
    {
      name: 'end_date',
      type: 'string',
      description: 'Akhir rentang tanggal, format YYYY-MM-DD',
      isRequired: false,
      label: 'Tanggal Akhir',
      order: 4
    },
    {
      name: 'limit',
      type: 'number',
      description: 'Jumlah memory item maksimal',
      isRequired: false,
      defaultValue: 3,
      label: 'Limit',
      order: 5
    },
    {
      name: 'topic',
      type: 'string',
      description: 'Topik atau intent yang dicari di memory',
      isRequired: false,
      label: 'Topik',
      order: 6
    }
  ]
};

export const handleMemoryRecall: ApiHandlerFn = async (
  params: Record<string, any>,
  context?: PipelineInput
) => {
  if (!context?.user_id || !context?.app_name) {
    return {
      kind: 'memory_recall',
      query: context?.text || params.query || '',
      source: 'episodic_memory',
      items: [],
      summary: 'Saya tidak bisa membaca memory karena konteks user atau aplikasi tidak tersedia.',
      isEmpty: true,
      metadata: {
        itemCount: 0,
        mode: 'recent'
      }
    };
  }

  return memoryRecallService.recall({
    userId: context.user_id,
    appName: context.app_name,
    query: context.text || params.query || '',
    params,
    timezone: context.attributes?.timezone as string | undefined
  });
};

export default {
  metadata: memoryRecallSkill,
  handler: handleMemoryRecall
} as InternalSkillModule;
