import type { PipelineInput } from '../types';
import type { ApiHandlerFn, InternalSkillMetadata, InternalSkillModule } from '../types/internal-skill.types';
import { userProfileRecallService } from '../services/user-profile-recall.service';

export const userProfileRecallSkill: InternalSkillMetadata = {
  name: 'User Profile Recall',
  slug: 'user_profile_recall',
  description: 'Membaca fakta dan preferensi yang tersimpan di profil user, seperti nama, email, bahasa, pasangan, atau preferensi laporan.',
  handlerKey: 'handleUserProfileRecall',
  version: '1.0.0',
  tags: ['profile', 'user', 'me', 'personal', 'preference', 'profil', 'saya'],
  category: 'memory',
  isHidden: false,
  capabilities: {
    actionTypes: ['profile_recall', 'user_profile_lookup', 'personal_fact_lookup'],
    outputFormats: ['summary', 'facts'],
    triggers: [
      'siapa nama saya',
      'email saya apa',
      'nomor saya apa',
      'company_id saya apa',
      'apakah anda tahu company_id saya',
      'siapa pacar saya',
      'siapa pasangan saya',
      'berapa lama saya pacaran',
      'musik favorit saya',
      'hobi saya apa',
      'hoby saya apa',
      'preferensi saya',
      'profil saya',
      'data saya',
      'what is my email',
      'who is my partner',
      'my profile'
    ],
    context: ['user_profile', 'personal_memory', 'profile_recall'],
    priority: 9,
    requiresData: false
  },
  paramSchema: [
    {
      name: 'requested_key',
      type: 'string',
      description: 'Profile key yang ingin diambil jika user menyebutkan spesifik.',
      isRequired: false,
      label: 'Profile Key',
      order: 1
    }
  ]
};

export const handleUserProfileRecall: ApiHandlerFn = async (
  params: Record<string, any>,
  context?: PipelineInput
) => {
  if (!context?.user_id || !context?.app_name) {
    return {
      kind: 'user_profile_recall',
      success: false,
      summary: 'Saya tidak bisa membaca profil karena konteks user atau aplikasi tidak tersedia.',
      facts: []
    };
  }

  const requestedKeys = params.requested_key ? [String(params.requested_key)] : undefined;
  const result = await userProfileRecallService.recall(context.user_id, context.app_name, {
    userText: context.text || '',
    requestedKeys
  });

  return {
    kind: 'user_profile_recall',
    success: result.found,
    answerable: result.answerable,
    summary: userProfileRecallService.format(result),
    facts: result.facts.map(fact => ({
      key: fact.profileKey,
      label: fact.valueLabel,
      value: fact.profileValue,
      confidence: fact.confidence,
      source: fact.source,
      validFrom: fact.validFrom,
      validTo: fact.validTo
    })),
    missingReason: result.missingReason
  };
};

export default {
  metadata: userProfileRecallSkill,
  handler: handleUserProfileRecall
} as InternalSkillModule;
