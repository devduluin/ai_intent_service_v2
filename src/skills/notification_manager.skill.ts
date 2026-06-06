// ============================================================
// NOTIFICATION MANAGER SKILL
// ============================================================
// Minimal internal notification actuator. Automation owns future
// scheduling; this skill only represents a notification delivery result.
// ============================================================

import type { PipelineInput } from '../types';
import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';

export const notificationManagerSkill: InternalSkillMetadata = {
  name: 'Notification Manager',
  slug: 'notification_manager',
  description: 'Mengirim atau menyiapkan notifikasi internal saat ini. Untuk reminder masa depan gunakan automation_manager.',
  handlerKey: 'handleNotificationManager',
  version: '0.1.0',
  tags: ['notification', 'internal_chat', 'actuator'],
  category: 'automation',
  isHidden: false,
  capabilities: {
    actionTypes: ['notify', 'send_notification'],
    outputFormats: ['notification_result'],
    triggers: [
      'kirim notifikasi sekarang',
      'beri tahu sekarang',
      'kabari sekarang',
      'send notification now',
      'notify now'
    ],
    context: ['immediate_notification'],
    priority: 8,
    requiresData: false
  },
  paramSchema: [
    {
      name: 'message',
      type: 'text',
      description: 'Isi pesan notifikasi.',
      isRequired: true,
      label: 'Pesan',
      order: 1
    },
    {
      name: 'target',
      type: 'string',
      description: 'Target penerima notifikasi. Kosong berarti user saat ini.',
      isRequired: false,
      label: 'Target',
      order: 2
    },
    {
      name: 'channel',
      type: 'select',
      description: 'Channel notifikasi. V1 hanya mendukung internal chat.',
      isRequired: false,
      label: 'Channel',
      order: 3,
      config: {
        options: [
          { label: 'Internal Chat', value: 'chat' }
        ]
      }
    }
  ]
};

export const handleNotificationManager: ApiHandlerFn = async (
  params: Record<string, any>,
  context?: PipelineInput
) => {
  const message = String(params.message || '').trim();
  const target = String(params.target || context?.user_id || 'current_user').trim();
  const channel = String(params.channel || 'chat').trim();

  if (!message) {
    return {
      kind: 'notification_clarification_required',
      missing: ['message'],
      recommendation: {
        messageHints: ['Minta isi pesan notifikasi sebelum mengirim.'],
        nextActions: ['Isi parameter message.']
      }
    };
  }

  if (channel !== 'chat') {
    return {
      kind: 'notification_channel_unsupported',
      channel,
      message,
      target,
      recommendation: {
        messageHints: ['Jelaskan bahwa V1 hanya mendukung internal chat.'],
        nextActions: ['Gunakan channel chat atau aktifkan policy channel eksternal.']
      }
    };
  }

  return {
    kind: 'notification_sent',
    channel: 'chat',
    target,
    message,
    deliveredAt: new Date().toISOString(),
    recommendation: {
      messageHints: [
        'Konfirmasi bahwa notifikasi internal sudah dicatat/dikirim.',
        'Jangan mengklaim email/webhook terkirim.'
      ],
      nextActions: []
    }
  };
};

export default {
  metadata: notificationManagerSkill,
  handler: handleNotificationManager
} as InternalSkillModule;
